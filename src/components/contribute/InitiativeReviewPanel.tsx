"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import {
  escalatedReviews,
  getBondedRole,
  getLatestBlockHeight,
  initiativeReviews,
  reviewBounty,
} from "@/lib/api";
import { RepMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseDreamToUdream, truncateAddress } from "@/lib/utils";
import { isMissingEndpoint } from "@/lib/errors";
import { useDisplayName } from "@/hooks/useDisplayName";
import BlockTime from "@/components/BlockTime";
import type {
  Initiative,
  InitiativeReview,
  InitiativeReviewsResponse,
  ReviewBountyResponse,
} from "@/types/rep";
import {
  BondedRoleStatus,
  CRITERIA_TYPE_LABELS,
  CriteriaType,
  InitiativeStatus,
  REVIEW_ESCALATION_LABELS,
  ReviewEscalation,
  ReviewEscalationValue,
  RoleType,
} from "@/types/rep";

interface Props {
  initiative: Initiative;
  /** The parent project's creator, for the conflict-of-interest exclusion. */
  projectCreator?: string;
  isOpsCommitteeMember: boolean;
  /** Re-reads the initiative list after a verdict changes its status. */
  onChanged: () => void;
}

// One reviewer's per-criterion verdict, as typed into the form. Kept separate
// from the wire CriteriaVote because `score` is a text field until it is sent.
type CriteriaAnswer = { passed: boolean; score: string; notes: string };

const DEFAULT_ANSWER: CriteriaAnswer = { passed: true, score: "", notes: "" };

function ReviewerName({ address }: { address: string }) {
  const { name } = useDisplayName(address);
  return <>{name || truncateAddress(address)}</>;
}

function errorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  return raw.trim() ? raw : fallback;
}

/**
 * Everything the bonded-reviewer gate adds to an initiative: the verdicts filed
 * against it, the review bounty bidding for reviewer attention, and the actions
 * available to a reviewer or to the Operations Committee.
 *
 * Split out of InitiativeList rather than inlined because it owns four
 * independent reads (verdicts, bounty, the signer's reviewer bond, chain
 * height) that only matter for an initiative whose card is open.
 *
 * Every read here 404s on a node older than v1.0.31. That is treated as "this
 * chain has no reviewer gate" and renders nothing, so the conviction-only
 * presentation above stays correct rather than showing an error.
 */
export default function InitiativeReviewPanel({
  initiative,
  projectCreator,
  isOpsCommitteeMember,
  onChanged,
}: Props) {
  const { address, signAndBroadcast } = useWallet();

  const [reviews, setReviews] = useState<InitiativeReviewsResponse | null>(null);
  const [bounty, setBounty] = useState<ReviewBountyResponse | null>(null);
  const [height, setHeight] = useState<bigint | null>(null);
  const [escalated, setEscalated] = useState(false);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);

  // The signer's reviewer standing. Only a NORMAL bond may file: RECOVERY,
  // UNBONDING and DEMOTED all mean the bond is not backing new liability,
  // which is exactly what a verdict creates (QualifiedReviewer).
  const [reviewerBondStatus, setReviewerBondStatus] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [approved, setApproved] = useState(true);
  const [comments, setComments] = useState("");
  const [answers, setAnswers] = useState<Record<string, CriteriaAnswer>>({});
  const [bountyAmount, setBountyAmount] = useState("");
  const [escalationReason, setEscalationReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const id = initiative.id;

  const load = useCallback(async () => {
    setLoading(true);
    const [reviewsRes, bountyRes, heightRes, escalationsRes] = await Promise.allSettled([
      initiativeReviews(id),
      reviewBounty(id),
      getLatestBlockHeight(),
      escalatedReviews(),
    ]);
    if (reviewsRes.status === "fulfilled") {
      setReviews(reviewsRes.value);
    } else if (isMissingEndpoint(reviewsRes.reason)) {
      setSupported(false);
    }
    // A bounty query fails plainly when nothing is escrowed, which is the
    // common case, so its failure says nothing about node support.
    setBounty(bountyRes.status === "fulfilled" ? bountyRes.value : null);
    setHeight(
      heightRes.status === "fulfilled" && /^\d+$/.test(heightRes.value)
        ? BigInt(heightRes.value)
        : null,
    );
    setEscalated(
      escalationsRes.status === "fulfilled" &&
        (escalationsRes.value.escalations ?? []).some((e) => e.initiative_id === id),
    );
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!address) {
      setReviewerBondStatus(null);
      return;
    }
    let cancelled = false;
    getBondedRole(RoleType.INITIATIVE_REVIEWER, address)
      .then((res) => {
        if (!cancelled) setReviewerBondStatus(res?.bonded_role?.bond_status ?? null);
      })
      .catch(() => {
        if (!cancelled) setReviewerBondStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const refresh = async () => {
    await load();
    onChanged();
  };

  const criteria = initiative.acceptance_criteria ?? [];
  const rounds = reviews?.rounds ?? [];
  const currentRound = reviews?.current_round ?? initiative.review_round ?? 0;
  // How many approving verdicts this initiative needs, or `null` when that is
  // genuinely not known.
  //
  // The live query computes RequiredVerifiersFor, which is the max of the
  // project's policy floor and the chain-wide review_required_above_budget
  // threshold. Only the policy half is snapshotted onto the initiative — the
  // threshold is deliberately read live chain-side — so a snapshot of 0 does
  // NOT mean no verdict is required, it means the snapshot cannot answer. A
  // positive snapshot is still a sound lower bound and worth keeping.
  //
  // `null` rather than a guessed 0 or 1: 0 would claim a gate is absent (and
  // hide this whole panel via the early return below), while 1 would invite a
  // reviewer to bond DREAM on a verdict that may not be wanted. Everything
  // downstream tests `verdictRequired`, which is false on null.
  const snapshotRequired = initiative.required_verifiers ?? 0;
  const required: number | null =
    reviews?.required !== undefined
      ? reviews.required
      : snapshotRequired > 0
        ? snapshotRequired
        : null;
  // Known to be on. Unknown reads false, so nothing downstream renders a round,
  // a deadline, or a verdict-filing affordance for a gate that may not exist.
  const verdictRequired = required !== null && required > 0;
  const approvals = reviews?.approvals ?? 0;
  const satisfied = reviews?.satisfied ?? false;
  const escalation = initiative.review_escalation;

  const openForReview =
    initiative.status === InitiativeStatus.SUBMITTED ||
    initiative.status === InitiativeStatus.IN_REVIEW;

  // Conflict of interest, mirroring QualifiedReviewer. The staking and
  // invitation-neighbourhood exclusions are enforced chain-side only: both need
  // reads this card does not do, and both surface as a broadcast error.
  const isConflicted =
    !!address && (address === initiative.assignee || address === projectCreator);

  const alreadyReviewed = (rounds.find((r) => r.round === currentRound)?.reviews ?? []).some(
    (r) => r.reviewer === address,
  );

  const canFileVerdict =
    openForReview &&
    verdictRequired &&
    !!address &&
    !isConflicted &&
    !alreadyReviewed &&
    reviewerBondStatus === BondedRoleStatus.NORMAL;

  const myContribution = (bounty?.reclaim_status ?? []).find((c) => c.funder === address);
  const canReclaim = !!myContribution?.reclaimable;
  const bountyTotal = bounty?.bounty?.amount ?? "0";
  const hasBounty = bountyTotal !== "0" && bountyTotal !== "";

  const setAnswer = (criteriaId: string, patch: Partial<CriteriaAnswer>) =>
    setAnswers((prev) => ({
      ...prev,
      [criteriaId]: { ...DEFAULT_ANSWER, ...prev[criteriaId], ...patch },
    }));

  const handleSubmitVerdict = async () => {
    if (!address) return;
    try {
      setBusy("verdict");
      setActionError(null);
      // Only answered criteria are sent. The chain accepts a partial set (it
      // validates ids and rejects duplicates) but rejects any id the initiative
      // never declared, so an untouched criterion is left out rather than sent
      // as a silent pass.
      const criteriaVotes = criteria
        .filter((c) => answers[c.id])
        .map((c) => ({
          criteriaId: c.id,
          passed: answers[c.id].passed,
          score: c.type === CriteriaType.SCALE ? Number(answers[c.id].score || "0") : 0,
          notes: answers[c.id].notes.trim(),
        }));
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.SubmitInitiativeReview,
          value: {
            reviewer: address,
            // uint64: BigInt keeps the amino converter's omit-zero check honest.
            initiativeId: BigInt(id),
            approved,
            criteriaVotes,
            comments: comments.trim(),
          },
        },
      ]);
      setFormOpen(false);
      setComments("");
      setAnswers({});
      await refresh();
    } catch (err) {
      console.error("Submit review failed:", err);
      setActionError(errorMessage(err, "Failed to file verdict"));
    } finally {
      setBusy(null);
    }
  };

  const handleFundBounty = async () => {
    if (!address) return;
    const micro = parseDreamToUdream(bountyAmount);
    if (!micro || micro === "0") {
      setActionError("Enter a DREAM amount above zero");
      return;
    }
    try {
      setBusy("fund");
      setActionError(null);
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.FundReviewBounty,
          value: { funder: address, initiativeId: BigInt(id), amount: micro },
        },
      ]);
      setBountyAmount("");
      await refresh();
    } catch (err) {
      console.error("Fund review bounty failed:", err);
      setActionError(errorMessage(err, "Failed to fund the bounty"));
    } finally {
      setBusy(null);
    }
  };

  const handleReclaimBounty = async () => {
    if (!address) return;
    try {
      setBusy("reclaim");
      setActionError(null);
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.ReclaimReviewBounty,
          value: { funder: address, initiativeId: BigInt(id) },
        },
      ]);
      await refresh();
    } catch (err) {
      console.error("Reclaim review bounty failed:", err);
      setActionError(errorMessage(err, "Failed to reclaim the bounty"));
    } finally {
      setBusy(null);
    }
  };

  const handleResolveEscalation = async (resolution: number, label: string) => {
    if (!address) return;
    try {
      setBusy(`escalation-${resolution}`);
      setActionError(null);
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.ResolveReviewEscalation,
          value: {
            creator: address,
            initiativeId: BigInt(id),
            resolution,
            reason: escalationReason.trim(),
          },
        },
      ]);
      setEscalationReason("");
      await refresh();
    } catch (err) {
      console.error("Resolve review escalation failed:", err);
      setActionError(errorMessage(err, `Failed to ${label} this round`));
    } finally {
      setBusy(null);
    }
  };

  // Nothing to say on a chain without the reviewer gate, or on an initiative
  // that neither declares criteria, needs a verdict, nor holds a bounty.
  if (!supported) return null;
  if (loading && !reviews) return null;
  // Note `=== 0`, not falsy: an unknown requirement keeps the panel mounted so
  // the gate reads "unavailable" rather than silently disappearing.
  if (required === 0 && criteria.length === 0 && !hasBounty && rounds.length === 0) return null;

  const pastDeadline =
    height !== null &&
    !!initiative.review_deadline &&
    initiative.review_deadline !== "0" &&
    height > BigInt(initiative.review_deadline);

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Reviewer gate
        </h4>
        {required === null ? (
          <span
            title="The reviewer-gate query did not answer, and this initiative's snapshot only records its project's policy — not the chain-wide budget threshold. Reload to check."
            className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500"
          >
            Verdict requirement unavailable
          </span>
        ) : verdictRequired ? (
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              satisfied
                ? "bg-emerald-900/30 text-emerald-400"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {approvals} of {required} approved
          </span>
        ) : (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
            No verdict required
          </span>
        )}
        {openForReview && verdictRequired && (
          <span className="text-xs text-zinc-500">Round {currentRound + 1}</span>
        )}
        {escalation && escalation !== ReviewEscalation.NONE && (
          <span className="rounded bg-indigo-900/30 px-1.5 py-0.5 text-xs text-indigo-300">
            {REVIEW_ESCALATION_LABELS[escalation] ?? escalation}
          </span>
        )}
      </div>

      {/* The window, and what happens at the end of it. Committee silence
          rejects the round, so the deadline is a real event rather than a
          formality. */}
      {openForReview && verdictRequired && initiative.review_deadline &&
        initiative.review_deadline !== "0" && (
        <p className="mt-1.5 text-xs text-zinc-500">
          {pastDeadline ? "Review window closed at " : "Review window closes at "}
          block {initiative.review_deadline}
          <span className="text-zinc-600">
            {" "}
            (<BlockTime height={initiative.review_deadline} />)
          </span>
          . {escalated
            ? "This round is with the Operations Committee; silence rejects it."
            : "Past it without the gate met, the round escalates to the Operations Committee."}
        </p>
      )}

      {criteria.length > 0 && (
        <div className="mt-3">
          <h5 className="text-xs font-semibold text-zinc-400">Definition of done</h5>
          <ul className="mt-1.5 space-y-1.5">
            {criteria.map((c) => (
              <li key={c.id} className="text-xs text-zinc-300">
                <span className="text-zinc-500">{c.id}</span> · {c.question}
                {c.required && <span className="ml-1 text-amber-400">(required)</span>}
                <span className="ml-1 text-zinc-600">
                  {CRITERIA_TYPE_LABELS[c.type] ?? c.type}
                </span>
                {c.how_to_verify && (
                  <div className="mt-0.5 text-zinc-500">How to verify: {c.how_to_verify}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rounds.length > 0 && (
        <div className="mt-3 space-y-2">
          {rounds.map((round) => (
            <div key={round.round}>
              <h5 className="text-xs font-semibold text-zinc-400">
                Round {round.round + 1}
                <span className="ml-1 font-normal text-zinc-500">
                  {round.approvals} of {round.reviews.length} verdicts approving
                </span>
              </h5>
              <ul className="mt-1 space-y-1.5">
                {round.reviews.map((r: InitiativeReview) => (
                  <li
                    key={`${r.round}-${r.reviewer}`}
                    className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={r.approved ? "text-emerald-400" : "text-red-400"}
                      >
                        {r.approved ? "Approved" : "Rejected"}
                      </span>
                      <span className="text-zinc-400">
                        <ReviewerName address={r.reviewer} />
                      </span>
                      {r.bond_reserved && r.bond_reserved !== "0" && (
                        <span style={{ color: "var(--amber)" }}>
                          {formatSpark(r.bond_reserved)} DREAM bonded
                        </span>
                      )}
                      {r.settled && <span className="text-zinc-600">settled</span>}
                    </div>
                    {r.comments && <p className="mt-1 text-zinc-300">{r.comments}</p>}
                    {(r.criteria_votes ?? []).length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-zinc-500">
                        {(r.criteria_votes ?? []).map((v) => (
                          <li key={v.criteria_id}>
                            <span className={v.passed ? "text-emerald-400" : "text-red-400"}>
                              {v.passed ? "pass" : "fail"}
                            </span>{" "}
                            {v.criteria_id}
                            {v.score ? ` · ${v.score}/100` : ""}
                            {v.notes ? ` · ${v.notes}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Review bounty. Shown whenever review is on the table, because the
          point of a bounty is to be visible before anyone has looked. */}
      {(verdictRequired || hasBounty) && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-xs font-semibold text-zinc-400">Review bounty</h5>
            <span style={{ color: "var(--amber)" }} className="text-xs">
              {formatSpark(bountyTotal)} DREAM escrowed
            </span>
            {bounty?.bounty?.committed && (
              <span className="text-xs text-zinc-500">committed to the filed verdicts</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Paid per verdict filed and split across the round&apos;s reviewers, never on the
            outcome. Funding buys the work a look, not an approval.
          </p>
          {address && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                placeholder="DREAM"
                value={bountyAmount}
                onChange={(e) => setBountyAmount(e.target.value)}
                className="w-28 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleFundBounty}
                disabled={busy === "fund" || !bountyAmount.trim()}
                className="sd-btn sd-btn-secondary"
              >
                {busy === "fund" ? "Funding..." : "Fund"}
              </button>
              {myContribution && (
                <button
                  type="button"
                  onClick={handleReclaimBounty}
                  disabled={busy === "reclaim" || !canReclaim}
                  title={
                    canReclaim
                      ? undefined
                      : bounty?.bounty?.committed
                        ? "A verdict has been filed, so the bounty is committed"
                        : `Reclaimable from block ${myContribution.reclaimable_at_height}`
                  }
                  className="sd-btn sd-btn-secondary"
                >
                  {busy === "reclaim"
                    ? "Reclaiming..."
                    : `Reclaim ${formatSpark(myContribution.amount)}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filing a verdict. Bond is reserved on filing and slashed if a jury
          overturns it, so the cost is stated before the buttons. */}
      {canFileVerdict && !formOpen && (
        <button
          type="button"
          onClick={() => {
            setFormOpen(true);
            setActionError(null);
          }}
          className="sd-btn sd-btn-primary mt-3"
        >
          File a verdict
        </button>
      )}

      {canFileVerdict && formOpen && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setApproved(true)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                approved
                  ? "bg-emerald-600/20 text-emerald-300"
                  : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800/50"
              }`}
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setApproved(false)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                approved
                  ? "border border-zinc-700 text-zinc-400 hover:bg-zinc-800/50"
                  : "bg-red-900/30 text-red-300"
              }`}
            >
              Reject
            </button>
          </div>

          {criteria.length > 0 && (
            <div className="mt-2.5 space-y-2">
              {criteria.map((c) => {
                const a = answers[c.id];
                return (
                  <div key={c.id} className="rounded border border-zinc-800 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-zinc-300">{c.question}</span>
                      <button
                        type="button"
                        onClick={() => setAnswer(c.id, { passed: true })}
                        className={`rounded px-2 py-0.5 text-xs ${
                          a?.passed ? "bg-emerald-600/20 text-emerald-300" : "text-zinc-500"
                        }`}
                      >
                        Pass
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnswer(c.id, { passed: false })}
                        className={`rounded px-2 py-0.5 text-xs ${
                          a && !a.passed ? "bg-red-900/30 text-red-300" : "text-zinc-500"
                        }`}
                      >
                        Fail
                      </button>
                      {c.type === CriteriaType.SCALE && a && (
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0-100"
                          value={a.score}
                          onChange={(e) => setAnswer(c.id, { score: e.target.value })}
                          className="w-20 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                        />
                      )}
                    </div>
                    {a && (
                      <input
                        type="text"
                        placeholder="Notes (optional)"
                        value={a.notes}
                        onChange={(e) => setAnswer(c.id, { notes: e.target.value })}
                        className="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                      />
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-zinc-500">
                Criteria you leave untouched are not sent, so an unanswered item is never
                recorded as a pass.
              </p>
            </div>
          )}

          <textarea
            placeholder="What you checked, and what you found"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />

          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Filing reserves bond scaled to this initiative&apos;s budget. It is released when
            the challenge window closes unchallenged and slashed if a jury overturns you.
            Rejecting returns the work to the assignee for another round.
          </p>

          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={handleSubmitVerdict}
              disabled={busy === "verdict"}
              className="sd-btn sd-btn-primary"
            >
              {busy === "verdict" ? "Filing..." : approved ? "File approval" : "File rejection"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setAnswers({});
                setComments("");
              }}
              className="sd-btn sd-btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Why the file button is absent, for someone who expected it. */}
      {openForReview && verdictRequired && !canFileVerdict && !!address && (
        <p className="mt-3 text-xs text-zinc-500">
          {alreadyReviewed
            ? "Your verdict on this round is filed."
            : isConflicted
              ? "You commissioned or did this work, so you cannot review it."
              : reviewerBondStatus === null
                ? "Filing a verdict needs a bonded reviewer role."
                : `Your reviewer bond is ${reviewerBondStatus.replace("BONDED_ROLE_STATUS_", "").toLowerCase()}, so it is not backing new verdicts.`}
        </p>
      )}

      {/* Operations Committee resolution of an escalated round. All three
          outcomes still run the challenge window: committee approval satisfies
          the reviewer requirement and nothing else. */}
      {isOpsCommitteeMember && escalated && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <h5 className="text-xs font-semibold text-zinc-400">Resolve escalation</h5>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Approve satisfies the reviewer gate. Reject sends the work back for another
            round. Pass declines to substitute judgement and lets conviction and the
            challenge window decide. Doing nothing rejects the round at the deadline.
          </p>
          <input
            type="text"
            placeholder="Reason"
            value={escalationReason}
            onChange={(e) => setEscalationReason(e.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleResolveEscalation(ReviewEscalationValue.APPROVED, "approve")}
              disabled={busy !== null}
              className="sd-btn sd-btn-primary"
            >
              {busy === `escalation-${ReviewEscalationValue.APPROVED}` ? "Approving..." : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => handleResolveEscalation(ReviewEscalationValue.REJECTED, "reject")}
              disabled={busy !== null}
              className="rounded-lg border border-red-700 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-50"
            >
              {busy === `escalation-${ReviewEscalationValue.REJECTED}` ? "Rejecting..." : "Reject"}
            </button>
            <button
              type="button"
              onClick={() => handleResolveEscalation(ReviewEscalationValue.PASSED, "pass")}
              disabled={busy !== null}
              className="sd-btn sd-btn-secondary"
            >
              {busy === `escalation-${ReviewEscalationValue.PASSED}` ? "Passing..." : "Pass"}
            </button>
          </div>
        </div>
      )}

      {actionError && <p className="mt-2 text-xs text-red-400">{actionError}</p>}
    </div>
  );
}
