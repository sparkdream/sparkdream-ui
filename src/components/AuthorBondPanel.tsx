"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAuthorBond,
  contentChallengeByTarget,
  getRepParams,
  getLatestBlockHeight,
} from "@/lib/api";
import type { AuthorBondResponse, ContentChallenge } from "@/types/rep";
import { ContentChallengeStatus, CONTENT_CHALLENGE_STATUS_LABELS } from "@/types/rep";
import { RepMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseDreamToUdream } from "@/lib/utils";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { useSessionPermits } from "@/hooks/useSessionPermits";
import CopyableAddress from "./CopyableAddress";
import NumberInput from "./NumberInput";

// StakeTargetType numeric value for x/blog author bonds (Imaginarium posts).
const BLOG_AUTHOR_BOND = 7;

/**
 * Author bond strip for a content detail view. Hidden when the content
 * carries no bond. Shows the bonded amount to everyone; lets the author
 * withdraw the bond (MsgUnstake) when no challenge is pending, lets other
 * members open a content challenge (MsgChallengeContent), and lets the
 * author respond to an active challenge (MsgRespondToContentChallenge).
 *
 * Works for any author-bond target: blog posts (7, default) and forum
 * posts/replies (8). `noun` labels the content in copy ("dream" / "spark").
 */
export default function AuthorBondPanel({
  postId,
  targetType = BLOG_AUTHOR_BOND,
  noun = "dream",
}: {
  postId: string;
  targetType?: number;
  noun?: string;
}) {
  const { address, connected, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const permits = useSessionPermits();

  const [bond, setBond] = useState<AuthorBondResponse | null>(null);
  const [challenge, setChallenge] = useState<ContentChallenge | null>(null);
  const [minChallengeStake, setMinChallengeStake] = useState<string | null>(null);
  const [currentHeight, setCurrentHeight] = useState<string | null>(null);

  const [showChallengeForm, setShowChallengeForm] = useState(false);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [stakeDream, setStakeDream] = useState("");

  const [showRespondForm, setShowRespondForm] = useState(false);
  const [response, setResponse] = useState("");
  const [responseEvidence, setResponseEvidence] = useState("");

  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [bondRes, challengeRes] = await Promise.all([
        getAuthorBond(targetType, postId),
        contentChallengeByTarget(targetType, postId),
      ]);
      setBond(bondRes);
      setChallenge(challengeRes);
    } catch {
      setBond(null);
      setChallenge(null);
    }
  }, [postId, targetType]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getRepParams()
      .then((res) => {
        const raw = (res.params as Record<string, unknown>)?.min_challenge_stake;
        if (typeof raw === "string" && raw) setMinChallengeStake(raw);
      })
      .catch(() => {});
    getLatestBlockHeight()
      .then(setCurrentHeight)
      .catch(() => {});
  }, []);

  const hasBond = bond !== null && bond.bond_amount !== "0" && bond.bond_amount !== "";
  // A resolved challenge (upheld/rejected) is history; only ACTIVE and
  // IN_JURY_REVIEW lock the bond and block new challenges.
  const activeChallenge =
    challenge &&
    (challenge.status === ContentChallengeStatus.ACTIVE ||
      challenge.status === ContentChallengeStatus.IN_JURY_REVIEW)
      ? challenge
      : null;

  if (!hasBond && !activeChallenge) return null;

  const isAuthor = connected && address === bond?.author;
  const canWithdraw =
    isAuthor && hasBond && !activeChallenge && permits(RepMsgTypeUrls.Unstake);
  const canChallenge =
    connected &&
    isMember === true &&
    !isAuthor &&
    hasBond &&
    !activeChallenge &&
    permits(RepMsgTypeUrls.ChallengeContent);
  const canRespond =
    isAuthor &&
    activeChallenge !== null &&
    activeChallenge.status === ContentChallengeStatus.ACTIVE &&
    !activeChallenge.author_response &&
    permits(RepMsgTypeUrls.RespondToContentChallenge);

  const handleWithdraw = async () => {
    if (!bond) return;
    if (!confirm(`Withdraw the author bond from this ${noun}? It cannot be re-added later.`)) return;
    setActionLoading(true);
    setError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.Unstake,
          // stake id is uint64; pass BigInt so the amino override's
          // `!== BigInt(0)` comparison emits/omits the field the same way
          // the chain's aminojson does.
          value: { staker: address, stakeId: BigInt(bond.stake_id), amount: bond.bond_amount },
        },
      ]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    const stakeUdream = parseDreamToUdream(stakeDream);
    if (!reason.trim() || !stakeUdream || stakeUdream === "0") return;
    setActionLoading(true);
    setError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.ChallengeContent,
          // target_type / target_id are uint64 — BigInt for the amino
          // override (see Withdraw above). staked_dream is a nullable
          // math.Int carried as a string.
          value: {
            challenger: address,
            targetType: BigInt(targetType),
            targetId: BigInt(postId),
            reason: reason.trim(),
            evidence: evidence
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
            stakedDream: stakeUdream,
          },
        },
      ]);
      setShowChallengeForm(false);
      setReason("");
      setEvidence("");
      setStakeDream("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Challenge failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRespond = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChallenge || !response.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.RespondToContentChallenge,
          value: {
            author: address,
            contentChallengeId: BigInt(activeChallenge.id),
            response: response.trim(),
            evidence: responseEvidence
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
          },
        },
      ]);
      setShowRespondForm(false);
      setResponse("");
      setResponseEvidence("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Response failed");
    } finally {
      setActionLoading(false);
    }
  };

  const deadlinePassed =
    activeChallenge && currentHeight
      ? parseInt(currentHeight, 10) > parseInt(activeChallenge.response_deadline, 10)
      : false;

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--amber)" }}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z" />
          </svg>
          Author bond: {formatSpark(bond?.bond_amount ?? "0")} DREAM
        </span>
        {activeChallenge && (
          <span className="rounded bg-amber-900/30 px-2 py-0.5 text-xs text-amber-400">
            Challenged. {CONTENT_CHALLENGE_STATUS_LABELS[activeChallenge.status] || activeChallenge.status}
          </span>
        )}
        {challenge && !activeChallenge && (
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            Past challenge: {CONTENT_CHALLENGE_STATUS_LABELS[challenge.status] || challenge.status}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {canWithdraw && (
            <button
              onClick={handleWithdraw}
              disabled={actionLoading}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              title="MsgUnstake"
            >
              Withdraw bond
            </button>
          )}
          {canChallenge && !showChallengeForm && (
            <button
              onClick={() => setShowChallengeForm(true)}
              disabled={actionLoading}
              className="rounded-lg bg-rose-600/20 px-3 py-1.5 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-600/30 disabled:opacity-50"
              title="MsgChallengeContent"
            >
              Challenge
            </button>
          )}
        </span>
      </div>

      <p className="mt-1.5 text-xs text-zinc-600">
        The author locked DREAM behind this {noun}. The bond is burned if the content is
        moderated, and any member can challenge it by staking DREAM of their own.
      </p>

      {activeChallenge && (
        <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>Challenged by</span>
            <CopyableAddress className="font-mono" address={activeChallenge.challenger} resolveName />
            <span>&middot;</span>
            <span>{formatSpark(activeChallenge.staked_dream)} DREAM staked</span>
            {activeChallenge.status === ContentChallengeStatus.ACTIVE && (
              <>
                <span>&middot;</span>
                <span>
                  Response deadline: block {Number(activeChallenge.response_deadline).toLocaleString("en-US")}
                  {deadlinePassed ? " (passed)" : ""}
                </span>
              </>
            )}
          </div>
          <p className="mt-2 text-zinc-300">{activeChallenge.reason}</p>
          {activeChallenge.evidence?.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-zinc-500">
              {activeChallenge.evidence.map((ev, i) => (
                <li key={i} className="break-all">{ev}</li>
              ))}
            </ul>
          )}
          {activeChallenge.author_response && (
            <div className="mt-3 border-t border-zinc-800 pt-2">
              <div className="text-xs text-zinc-500">Author response</div>
              <p className="mt-1 text-zinc-300">{activeChallenge.author_response}</p>
              {activeChallenge.author_evidence?.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs text-zinc-500">
                  {activeChallenge.author_evidence.map((ev, i) => (
                    <li key={i} className="break-all">{ev}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {canRespond && !showRespondForm && (
            <button
              onClick={() => setShowRespondForm(true)}
              disabled={actionLoading}
              className="mt-3 rounded-lg bg-indigo-600/20 px-3 py-1.5 text-xs font-medium text-indigo-400 transition-colors hover:bg-indigo-600/30 disabled:opacity-50"
              title="MsgRespondToContentChallenge"
            >
              Respond to challenge
            </button>
          )}
        </div>
      )}

      {showChallengeForm && (
        <form onSubmit={handleChallenge} className="mt-3 space-y-3">
          <div>
            <label htmlFor="challengeReason" className="mb-1 block text-xs font-medium text-zinc-400">
              Reason
            </label>
            <textarea
              id="challengeReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              placeholder="Why this content should not stand"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-rose-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="challengeEvidence" className="mb-1 block text-xs font-medium text-zinc-400">
              Evidence (optional, one link per line)
            </label>
            <textarea
              id="challengeEvidence"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={2}
              placeholder="https://…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-rose-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="challengeStake" className="mb-1 block text-xs font-medium text-zinc-400">
              Stake (DREAM)
            </label>
            <NumberInput
              id="challengeStake"
              min="0"
              value={stakeDream}
              onChange={(e) => setStakeDream(e.target.value)}
              placeholder="0"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-rose-500 focus:outline-none"
            />
            {minChallengeStake && (
              <p className="mt-1 text-xs text-zinc-600">
                Minimum {formatSpark(minChallengeStake)} DREAM. Lost if the challenge is
                rejected, rewarded from the bond if upheld.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={actionLoading}
              className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
            >
              {actionLoading ? "Submitting…" : "Submit challenge"}
            </button>
            <button
              type="button"
              onClick={() => setShowChallengeForm(false)}
              disabled={actionLoading}
              className="rounded-lg px-4 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {showRespondForm && canRespond && (
        <form onSubmit={handleRespond} className="mt-3 space-y-3">
          <div>
            <label htmlFor="challengeResponse" className="mb-1 block text-xs font-medium text-zinc-400">
              Your response
            </label>
            <textarea
              id="challengeResponse"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={3}
              required
              placeholder="Address the challenge"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="responseEvidence" className="mb-1 block text-xs font-medium text-zinc-400">
              Evidence (optional, one link per line)
            </label>
            <textarea
              id="responseEvidence"
              value={responseEvidence}
              onChange={(e) => setResponseEvidence(e.target.value)}
              rows={2}
              placeholder="https://…"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={actionLoading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {actionLoading ? "Submitting…" : "Submit response"}
            </button>
            <button
              type="button"
              onClick={() => setShowRespondForm(false)}
              disabled={actionLoading}
              className="rounded-lg px-4 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="mt-2 text-xs text-rose-400">{error}</p>
      )}
    </div>
  );
}
