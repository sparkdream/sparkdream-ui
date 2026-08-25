"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import {
  challengesByInitiative,
  getLatestBlockHeight,
  getRepChallenge,
  getRepParams,
  listRepChallenges,
} from "@/lib/api";
import { RepMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseDreamToUdream, truncateAddress } from "@/lib/utils";
import { isMissingEndpoint } from "@/lib/errors";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import BlockTime from "@/components/BlockTime";
import type { Challenge, Initiative } from "@/types/rep";
import {
  CHALLENGE_STATUS_LABELS,
  ChallengeStatus,
  InitiativeStatus,
} from "@/types/rep";

interface Props {
  initiative: Initiative;
  /** Re-reads the initiative list: a filed challenge flips it to CHALLENGED. */
  onChanged: () => void;
}

// How far back the paged scan looks. The by-initiative query returns only the
// oldest match, so this page plus that one backstop covers both ends of a
// history that in practice holds one or two entries — an initiative can only be
// challenged again after a previous challenge resolves it back into review.
const CHALLENGE_SCAN_LIMIT = "200";

function ChallengerName({ address }: { address: string }) {
  const { name } = useDisplayName(address);
  return <>{name || truncateAddress(address)}</>;
}

function statusColor(status: string): string {
  switch (status) {
    case ChallengeStatus.ACTIVE:
      return "bg-amber-900/30 text-amber-300";
    case ChallengeStatus.IN_JURY_REVIEW:
      return "bg-indigo-900/30 text-indigo-300";
    case ChallengeStatus.UPHELD:
      return "bg-red-900/30 text-red-300";
    case ChallengeStatus.REJECTED:
      return "bg-emerald-900/30 text-emerald-400";
    default:
      return "bg-zinc-800 text-zinc-400";
  }
}

/**
 * Disputes over whether submitted work is actually done.
 *
 * The challenger locks DREAM that burns if a jury disagrees with them, which is
 * what makes the claim cost something. The assignee answers or the challenge
 * auto-upholds at its deadline; a contested answer goes to a lot-drawn jury.
 * An upheld challenge rejects the initiative, slashes the assignee's reputation
 * and burns any self-assign bond, so both sides of this panel say what the
 * action costs before offering the button.
 */
export default function InitiativeChallengePanel({ initiative, onChanged }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [height, setHeight] = useState<bigint | null>(null);
  const [minStakeMicro, setMinStakeMicro] = useState<bigint | null>(null);
  const [rewardRate, setRewardRate] = useState<number | null>(null);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [criteriaId, setCriteriaId] = useState("");
  const [evidence, setEvidence] = useState("");
  const [stake, setStake] = useState("");

  const [respondTo, setRespondTo] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [responseEvidence, setResponseEvidence] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const id = initiative.id;

  const load = useCallback(async () => {
    setLoading(true);
    const [listRes, firstRes, heightRes, paramsRes] = await Promise.allSettled([
      listRepChallenges({ limit: CHALLENGE_SCAN_LIMIT, reverse: true }),
      challengesByInitiative(id),
      getLatestBlockHeight(),
      getRepParams(),
    ]);

    if (listRes.status === "rejected" && isMissingEndpoint(listRes.reason)) {
      setSupported(false);
    }

    const found =
      listRes.status === "fulfilled"
        ? (listRes.value.challenge ?? []).filter((c) => c.initiative_id === id)
        : [];
    // The oldest challenge falls off the end of a reverse-ordered page; the
    // by-initiative query returns exactly that one, so fetch it when the scan
    // missed it.
    const firstId =
      firstRes.status === "fulfilled" ? firstRes.value.challenge_id : undefined;
    if (firstId && firstId !== "0" && !found.some((c) => c.id === firstId)) {
      const extra = await getRepChallenge(firstId).catch(() => null);
      if (extra?.challenge) found.push(extra.challenge);
    }
    found.sort((a, b) => Number(a.id) - Number(b.id));
    setChallenges(found);

    setHeight(
      heightRes.status === "fulfilled" && /^\d+$/.test(heightRes.value)
        ? BigInt(heightRes.value)
        : null,
    );
    if (paramsRes.status === "fulfilled") {
      const p = (paramsRes.value.params as Record<string, unknown>) || {};
      const min = p.min_challenge_stake;
      if (typeof min === "string" && /^\d+$/.test(min)) setMinStakeMicro(BigInt(min));
      const rate = Number(p.challenger_reward_rate);
      if (Number.isFinite(rate) && rate > 0) setRewardRate(rate);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    await load();
    onChanged();
  };

  // Evidence is a repeated string on both messages: one URI per line, empties
  // dropped. An empty array is omitted by the amino converter, matching the
  // chain, so "no evidence" signs cleanly.
  const evidenceLines = (raw: string) =>
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const handleChallenge = async () => {
    if (!address) return;
    const micro = parseDreamToUdream(stake);
    if (!micro || micro === "0") {
      setError("Enter the DREAM you are staking on this claim");
      return;
    }
    if (minStakeMicro !== null && BigInt(micro) < minStakeMicro) {
      setError(`The minimum stake is ${formatSpark(minStakeMicro.toString())} DREAM`);
      return;
    }
    if (!reason.trim()) {
      setError("Say what is wrong with the work");
      return;
    }
    try {
      setBusy("challenge");
      setError(null);
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.CreateChallenge,
          value: {
            challenger: address,
            // uint64: BigInt keeps the amino converter's omit-zero check honest.
            initiativeId: BigInt(id),
            reason: reason.trim(),
            evidence: evidenceLines(evidence),
            stakedDream: micro,
            criteriaId,
          },
        },
      ]);
      setFormOpen(false);
      setReason("");
      setCriteriaId("");
      setEvidence("");
      setStake("");
      await refresh();
    } catch (err) {
      console.error("Create challenge failed:", err);
      setError(err instanceof Error ? err.message : "Failed to file the challenge");
    } finally {
      setBusy(null);
    }
  };

  const handleRespond = async (challengeId: string) => {
    if (!address || !response.trim()) return;
    try {
      setBusy(`respond-${challengeId}`);
      setError(null);
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.RespondToChallenge,
          value: {
            assignee: address,
            challengeId: BigInt(challengeId),
            response: response.trim(),
            evidence: evidenceLines(responseEvidence),
          },
        },
      ]);
      setRespondTo(null);
      setResponse("");
      setResponseEvidence("");
      await refresh();
    } catch (err) {
      console.error("Respond to challenge failed:", err);
      setError(err instanceof Error ? err.message : "Failed to answer the challenge");
    } finally {
      setBusy(null);
    }
  };

  const criteria = initiative.acceptance_criteria ?? [];
  const criteriaQuestion = (cid: string) =>
    criteria.find((c) => c.id === cid)?.question ?? cid;

  const openToChallenge =
    initiative.status === InitiativeStatus.SUBMITTED ||
    initiative.status === InitiativeStatus.IN_REVIEW;
  const isAssignee = !!address && address === initiative.assignee;
  // Membership is the real gate: the stake is locked on the member record, so a
  // non-member's challenge fails at LockDREAM. The assignee is left out because
  // disputing your own submission only costs you the stake or your own payout,
  // not because the chain refuses it.
  const canChallenge = openToChallenge && !!address && isMember === true && !isAssignee;
  const activeChallenge = challenges.find((c) => c.status === ChallengeStatus.ACTIVE);

  // Nothing to show on a chain without the challenge queries, and nothing to
  // show a reader who cannot file one against work nobody has disputed.
  if (!supported) return null;
  if (challenges.length === 0 && !canChallenge) return null;

  const minStakeLabel =
    minStakeMicro !== null ? `${formatSpark(minStakeMicro.toString())} DREAM` : null;
  const rewardLabel =
    rewardRate !== null && initiative.budget
      ? formatSpark(
          ((BigInt(initiative.budget || "0") * BigInt(Math.round(rewardRate * 1e6))) /
            BigInt(1e6)).toString(),
        )
      : null;

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Challenges
        </h4>
        {challenges.length === 0 && (
          <span className="text-xs text-zinc-500">None filed</span>
        )}
        {/* Held back until the read lands: filing against an initiative that
            already carries an active challenge just errors, and until the
            challenges load we don't know that it doesn't. */}
        {canChallenge && !formOpen && !activeChallenge && !loading && (
          <button
            type="button"
            onClick={() => {
              setFormOpen(true);
              setError(null);
              if (!stake && minStakeMicro !== null) {
                setStake(formatSpark(minStakeMicro.toString()).replace(/,/g, ""));
              }
            }}
            className="sd-btn sd-btn-secondary ml-auto"
          >
            Dispute this work
          </button>
        )}
      </div>

      {challenges.length > 0 && (
        <ul className="mt-2 space-y-2">
          {challenges.map((c) => {
            const overdue =
              height !== null &&
              c.status === ChallengeStatus.ACTIVE &&
              c.response_deadline !== "0" &&
              height >= BigInt(c.response_deadline || "0");
            return (
              <li
                key={c.id}
                className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 ${statusColor(c.status)}`}>
                    {CHALLENGE_STATUS_LABELS[c.status] ?? c.status}
                  </span>
                  <span className="text-zinc-400">
                    <ChallengerName address={c.challenger} />
                  </span>
                  <span style={{ color: "var(--amber)" }}>
                    {formatSpark(c.staked_dream)} DREAM staked
                  </span>
                </div>
                {c.reason && <p className="mt-1 text-zinc-300">{c.reason}</p>}
                {c.criteria_id && (
                  <p className="mt-1 text-zinc-500">
                    Cites <span className="text-zinc-400">{c.criteria_id}</span>:{" "}
                    {criteriaQuestion(c.criteria_id)}
                  </p>
                )}
                {(c.evidence ?? []).length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {c.evidence.map((e) => (
                      <li key={e} className="truncate text-zinc-500">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
                {c.status === ChallengeStatus.ACTIVE &&
                  c.response_deadline &&
                  c.response_deadline !== "0" &&
                  (overdue ? (
                    <p className="mt-1 text-red-400">
                      Past the deadline. The next block upholds this challenge unanswered.
                    </p>
                  ) : (
                    <p className="mt-1 text-zinc-500">
                      Unanswered by block {c.response_deadline} (
                      <BlockTime height={c.response_deadline} />) and it is upheld without a
                      jury.
                    </p>
                  ))}
                {c.status === ChallengeStatus.UPHELD && (
                  <p className="mt-1 text-zinc-500">
                    The work was rejected, its budget returned, and the challenger paid from
                    the initiative&apos;s budget.
                  </p>
                )}
                {c.status === ChallengeStatus.REJECTED && (
                  <p className="mt-1 text-zinc-500">
                    The claim did not hold and the challenger&apos;s stake was burned.
                  </p>
                )}

                {isAssignee && c.status === ChallengeStatus.ACTIVE && respondTo !== c.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setRespondTo(c.id);
                      setError(null);
                    }}
                    className="sd-btn sd-btn-primary mt-2"
                  >
                    Answer this
                  </button>
                )}

                {isAssignee && respondTo === c.id && (
                  <div className="mt-2 border-t border-zinc-800 pt-2">
                    <textarea
                      placeholder="Answer the claim. What did you deliver, and where does it meet the standard?"
                      value={response}
                      onChange={(e) => setResponse(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <textarea
                      placeholder="Evidence, one link per line (optional)"
                      value={responseEvidence}
                      onChange={(e) => setResponseEvidence(e.target.value)}
                      rows={2}
                      className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <p className="mt-2 leading-relaxed text-zinc-500">
                      Answering sends the dispute to a jury drawn by lot. Saying nothing
                      before the deadline upholds the challenge outright: the initiative is
                      rejected, your reputation is slashed and any self-assign bond burns.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleRespond(c.id)}
                        disabled={busy === `respond-${c.id}` || !response.trim()}
                        className="sd-btn sd-btn-primary"
                      >
                        {busy === `respond-${c.id}` ? "Sending..." : "Send to a jury"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRespondTo(null);
                          setResponse("");
                          setResponseEvidence("");
                        }}
                        className="sd-btn sd-btn-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {formOpen && (
        <div className="mt-2.5 border-t border-zinc-800 pt-2.5">
          <textarea
            placeholder="What is wrong with this work?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />

          {/* Citing a criterion is optional but changes what the jury is asked:
              a named criterion is a standard the author pre-committed to, not
              one reader's opinion of the result. */}
          {criteria.length > 0 && (
            <label className="mt-2 block">
              <span className="mb-1 block text-xs text-zinc-400">
                Criterion the work fails (optional)
              </span>
              <select
                value={criteriaId}
                onChange={(e) => setCriteriaId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">No specific criterion</option>
                {criteria.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.question}
                  </option>
                ))}
              </select>
            </label>
          )}

          <textarea
            placeholder="Evidence, one link per line (optional)"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Stake (DREAM)"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="w-32 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
            {minStakeLabel && (
              <span className="text-xs text-zinc-500">minimum {minStakeLabel}</span>
            )}
          </div>

          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Your stake is locked while the dispute runs. If a jury upholds you it comes back
            {rewardLabel ? ` with about ${rewardLabel} DREAM` : " with a reward"} and the work
            is rejected. If the jury sides with the assignee, the stake is burned. Filing also
            pauses completion: the initiative moves to challenged until this resolves.
          </p>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={handleChallenge}
              disabled={busy === "challenge" || !reason.trim() || !stake.trim()}
              className="rounded-lg border border-red-700 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-50"
            >
              {busy === "challenge" ? "Filing..." : "File challenge"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setError(null);
              }}
              className="sd-btn sd-btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && !formOpen && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
