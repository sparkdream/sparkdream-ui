"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getRepInitiative, juryReviewsByJuror } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { RepMsgTypeUrls } from "@/lib/tx";
import BlockTime from "@/components/BlockTime";
import { isMissingEndpoint } from "@/lib/errors";
import { VERDICT_LABELS, Verdict } from "@/types/rep";
import type { Initiative, JuryReview } from "@/types/rep";

// Numeric values for MsgSubmitJurorVote.verdict. PENDING (0) is not a vote.
const VerdictValue = {
  UPHOLD_CHALLENGE: 1,
  REJECT_CHALLENGE: 2,
  INCONCLUSIVE: 3,
} as const;

// LegacyDec on the wire is always an 18-decimal string, and amino sign bytes
// are compared against exactly what the chain renders. Parsed from the text
// rather than through Number.toFixed, which turns "0.1" into
// "0.100000000000000006" and fails sigverify.
function decString(input: string, max?: number): string {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(input.trim());
  if (!m) return "0.000000000000000000";
  if (max !== undefined && Number(input) > max) return decString(String(max));
  const whole = m[1] || "0";
  const frac = (m[2] || "").slice(0, 18).padEnd(18, "0");
  return `${whole}.${frac}`;
}

/**
 * A juror's outstanding summons.
 *
 * Jurors are drawn by lot, so a seat is not a commitment until it is accepted
 * (chain commit 70dce72): accepting is what makes the abandoned-seat penalty
 * fair, and declining is free and immediate so the seat can be redrawn while
 * there is still time to read the work. Ignoring a summons costs the seat and
 * counts against the responsiveness weight that decides how often you are drawn
 * again.
 */
export default function JuryDutyPanel() {
  const { address, signAndBroadcast } = useWallet();
  const [reviews, setReviews] = useState<JuryReview[]>([]);
  const [initiatives, setInitiatives] = useState<Record<string, Initiative>>({});
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Vote form, one summons at a time.
  const [voteFor, setVoteFor] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<number>(VerdictValue.REJECT_CHALLENGE);
  const [confidence, setConfidence] = useState("0.8");
  const [reasoning, setReasoning] = useState("");

  const fetchSummons = useCallback(async () => {
    if (!address) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await juryReviewsByJuror(address, true, { limit: "50" });
      const list = res.jury_review ?? [];
      setReviews(list);
      const ids = Array.from(
        new Set(list.map((r) => r.initiative_id).filter((id) => id && id !== "0")),
      );
      const entries = await Promise.all(
        ids.map(async (id) => {
          const ini = await getRepInitiative(id).catch(() => null);
          return [id, ini?.initiative] as const;
        }),
      );
      setInitiatives(
        Object.fromEntries(entries.filter((e): e is [string, Initiative] => !!e[1])),
      );
    } catch (err) {
      if (isMissingEndpoint(err)) setSupported(false);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchSummons();
  }, [fetchSummons]);

  const send = async (
    key: string,
    typeUrl: string,
    value: Record<string, unknown>,
    fallback: string,
  ) => {
    if (!address) return;
    try {
      setBusy(key);
      setError(null);
      await signAndBroadcast([{ typeUrl, value }]);
      setVoteFor(null);
      setReasoning("");
      await fetchSummons();
    } catch (err) {
      console.error(`${fallback}:`, err);
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(null);
    }
  };

  // Nothing to show on a node without the summons query, and nothing to show a
  // member who has never been seated — which is most of them, since jury duty
  // comes up about once a year.
  if (!supported || loading || reviews.length === 0) return null;

  return (
    <div className="sd-hull-tile rounded-xl p-5">
      <h3 className="text-sm font-semibold text-zinc-200">Jury summons</h3>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        You have been drawn to settle a dispute. Accepting turns the seat into a commitment
        and pays on a filed vote; declining is free and lets the seat be redrawn. Accepting
        and then letting it lapse costs reputation in the disputed tags.
      </p>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <ul className="mt-3 space-y-2">
        {reviews.map((r) => {
          const accepted = (r.accepted ?? []).includes(address ?? "");
          const voted = (r.votes ?? []).some((v) => v.juror === address);
          const initiative = initiatives[r.initiative_id];
          const criteria = initiative?.acceptance_criteria ?? [];
          return (
            <li key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-zinc-300">
                  {initiative ? (
                    <Link
                      href={`/contribute?view=initiatives&initiative=${r.initiative_id}`}
                      className="text-indigo-400 transition-colors hover:text-indigo-300"
                    >
                      #{r.initiative_id} {initiative.title}
                    </Link>
                  ) : r.content_challenge_id && r.content_challenge_id !== "0" ? (
                    "Content challenge"
                  ) : (
                    `Jury review ${r.id}`
                  )}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    accepted ? "bg-emerald-900/30 text-emerald-400" : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {voted ? "Voted" : accepted ? "Accepted" : "Unanswered"}
                </span>
                {r.verdict && r.verdict !== Verdict.PENDING && (
                  <span className="text-xs text-zinc-500">
                    {VERDICT_LABELS[r.verdict] ?? r.verdict}
                  </span>
                )}
              </div>

              {r.challenger_claim && (
                <p className="mt-1 text-xs text-zinc-400">{r.challenger_claim}</p>
              )}
              <p className="mt-1 text-xs text-zinc-500">
                {!accepted && r.acceptance_deadline && r.acceptance_deadline !== "0" && (
                  <>
                    Answer by block {r.acceptance_deadline} (
                    <BlockTime height={r.acceptance_deadline} />) ·{" "}
                  </>
                )}
                Vote by block {r.deadline} (<BlockTime height={r.deadline} />)
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                {!accepted && !voted && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        send(
                          `accept-${r.id}`,
                          RepMsgTypeUrls.AcceptJuryDuty,
                          { juror: address, juryReviewId: BigInt(r.id) },
                          "Failed to accept the summons",
                        )
                      }
                      disabled={!!busy}
                      className="sd-btn sd-btn-primary"
                    >
                      {busy === `accept-${r.id}` ? "Accepting..." : "Accept"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        send(
                          `decline-${r.id}`,
                          RepMsgTypeUrls.DeclineJuryDuty,
                          { juror: address, juryReviewId: BigInt(r.id) },
                          "Failed to decline the summons",
                        )
                      }
                      disabled={!!busy}
                      className="sd-btn sd-btn-secondary"
                    >
                      {busy === `decline-${r.id}` ? "Declining..." : "Decline"}
                    </button>
                  </>
                )}
                {!voted && voteFor !== r.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setVoteFor(r.id);
                      setError(null);
                    }}
                    className="sd-btn sd-btn-secondary"
                  >
                    Vote
                  </button>
                )}
              </div>

              {voteFor === r.id && (
                <div className="mt-2.5 border-t border-zinc-800 pt-2.5">
                  <div className="flex flex-wrap gap-2">
                    {[
                      [VerdictValue.UPHOLD_CHALLENGE, "Uphold challenge"],
                      [VerdictValue.REJECT_CHALLENGE, "Reject challenge"],
                      [VerdictValue.INCONCLUSIVE, "Inconclusive"],
                    ].map(([val, label]) => (
                      <button
                        key={String(val)}
                        type="button"
                        onClick={() => setVerdict(val as number)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          verdict === val
                            ? "bg-indigo-600/20 text-indigo-300"
                            : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800/50"
                        }`}
                      >
                        {label as string}
                      </button>
                    ))}
                  </div>
                  {criteria.length > 0 && (
                    <p className="mt-2 text-xs text-zinc-500">
                      This initiative declared {criteria.length} acceptance criteri
                      {criteria.length === 1 ? "on" : "a"}. Read them on the initiative before
                      voting.
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="text-xs text-zinc-400">
                      Confidence
                      <input
                        type="text"
                        inputMode="decimal"
                        value={confidence}
                        onChange={(e) => setConfidence(e.target.value)}
                        className="ml-2 w-20 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                      />
                    </label>
                    <span className="text-xs text-zinc-600">0 to 1</span>
                  </div>
                  <textarea
                    placeholder="Reasoning"
                    value={reasoning}
                    onChange={(e) => setReasoning(e.target.value)}
                    rows={2}
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        send(
                          `vote-${r.id}`,
                          RepMsgTypeUrls.SubmitJurorVote,
                          {
                            juror: address,
                            juryReviewId: BigInt(r.id),
                            criteriaVotes: [],
                            verdict,
                            confidence: decString(confidence, 1),
                            reasoning: reasoning.trim(),
                          },
                          "Failed to submit the vote",
                        )
                      }
                      disabled={!!busy}
                      className="sd-btn sd-btn-primary"
                    >
                      {busy === `vote-${r.id}` ? "Submitting..." : "Submit vote"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoteFor(null)}
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
    </div>
  );
}
