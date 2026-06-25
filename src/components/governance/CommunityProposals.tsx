"use client";

import { useEffect, useMemo, useState } from "react";
import type { Group, Proposal, Member } from "@/types/commons";
import { ProposalStatus, VoteOption, VOTE_OPTION_LABELS } from "@/types/commons";
import { getProposal } from "@/lib/api";
import { CommonsMsgTypeUrls } from "@/lib/tx";
import { useWallet } from "@/contexts/WalletContext";
import {
  formatTime,
  timeRemaining,
  describeProposalMessages,
} from "@/lib/utils";
import NameOrAddress from "@/components/NameOrAddress";
import { canSpendTreasury } from "@/lib/commons";
import NewCommunityProposal, { type ProposalType } from "./NewCommunityProposal";
import { CouncilTreasuryBanner } from "./CouncilTreasury";

interface CommunityProposalsProps {
  group: Group;
  members: Member[];
  proposals: Proposal[];
  loading: boolean;
  onRefresh: () => void;
  /** When set, auto-opens the new-proposal form pre-selected to this type. */
  initialAction?: ProposalType;
  /** Forwarded to NewCommunityProposal — pre-fills the unhide-post form. */
  initialPostId?: string;
}

export default function CommunityProposals({
  group,
  members,
  proposals,
  loading,
  onRefresh,
  initialAction,
  initialPostId,
}: CommunityProposalsProps) {
  const { address, signAndBroadcast } = useWallet();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Bumped after a successful vote/execute so child cards drop their cached tally and re-fetch. */
  const [refreshKey, setRefreshKey] = useState(0);
  const [showNewProposal, setShowNewProposal] = useState(!!initialAction);

  const isMember = members.some((m) => m.address === address);
  // Shared clock for every card's voting / execution countdowns. Tick
  // adapts: 30s normally, 5s when *any* visible card is in its sub-minute
  // window, so the "<1m left" badge transitions to "expired" / the Execute
  // button flips enabled within ~5s of the chain accepting the call rather
  // than parking at the floor of the previous bucket for up to 30s.
  const soonestDeadline = useMemo(() => {
    let soonest: number | null = null;
    for (const p of proposals) {
      const candidates: (string | undefined)[] = [];
      if (p.status === ProposalStatus.SUBMITTED) candidates.push(p.voting_deadline);
      if (p.status === ProposalStatus.ACCEPTED) candidates.push(p.execution_time);
      for (const c of candidates) {
        if (!c || c === "0") continue;
        const ms = parseInt(c, 10) * 1000;
        if (Number.isFinite(ms) && (soonest === null || ms < soonest)) soonest = ms;
      }
    }
    return soonest;
  }, [proposals]);
  const now = useNow(soonestDeadline);

  const handleVote = async (proposalId: string, option: number) => {
    setActionLoading(`vote-${proposalId}`);
    setActionError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: CommonsMsgTypeUrls.VoteProposal,
          value: {
            voter: address,
            proposalId: BigInt(proposalId),
            option,
            metadata: "",
          },
        },
      ]);
      setRefreshKey((k) => k + 1);
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Vote failed:", err);
      setActionError(`Vote on proposal #${proposalId} failed: ${msg}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecute = async (proposalId: string) => {
    setActionLoading(`exec-${proposalId}`);
    setActionError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: CommonsMsgTypeUrls.ExecuteProposal,
          value: {
            proposalId: BigInt(proposalId),
            executor: address,
          },
        },
      ]);
      setRefreshKey((k) => k + 1);
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Execute failed:", err);
      setActionError(`Execute of proposal #${proposalId} failed: ${msg}`);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      {canSpendTreasury(group) && <CouncilTreasuryBanner group={group} />}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Proposals</h2>
        {isMember && !showNewProposal && (
          <button
            type="button"
            onClick={() => setShowNewProposal(true)}
            className="sd-btn sd-btn-primary"
          >
            New proposal
          </button>
        )}
      </div>

      {showNewProposal && (
        <div className="mb-6">
          <NewCommunityProposal
            group={group}
            members={members}
            initialType={initialAction}
            initialPostId={initialPostId}
            onClose={() => setShowNewProposal(false)}
            onSuccess={() => {
              setShowNewProposal(false);
              onRefresh();
            }}
          />
        </div>
      )}

      {loading ? (
        <div className="animate-pulse rounded-xl sd-hull-tile p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-3 w-8 rounded bg-zinc-800" />
              <div className="h-4 w-14 rounded bg-zinc-800" />
              <div className="h-3 w-28 rounded bg-zinc-800" />
            </div>
            <div className="h-3 w-12 rounded bg-zinc-800" />
          </div>
          <div className="mb-2 h-4 w-3/5 rounded bg-zinc-800" />
          <div className="flex gap-4">
            <div className="h-3 w-24 rounded bg-zinc-800" />
            <div className="h-3 w-20 rounded bg-zinc-800" />
          </div>
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No proposals yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {actionError && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
              <span className="break-all">{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="shrink-0 text-xs text-red-300 hover:text-red-100"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}
          {proposals.map((proposal) => (
            // Remount on refreshKey bump so cached `detail` (votes + tally)
            // is dropped after a successful vote/execute.
            <CommonsProposalCard
              key={`${proposal.id}-${refreshKey}`}
              proposal={proposal}
              isMember={isMember}
              actionLoading={actionLoading}
              now={now}
              onVote={handleVote}
              onExecute={handleExecute}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Live-clock hook ─────────────────────────────────────────────────

/**
 * Re-renders subscribers on a recursive `setTimeout` whose cadence shortens
 * when the next deadline is close: 30s by default, 5s once we're inside the
 * last minute of `soonestDeadlineMs`. Pass `null` (or omit) when no card has
 * a live countdown and the hook will just tick at 30s for refresh hygiene.
 *
 * Why recursive setTimeout instead of setInterval: the interval needs to
 * change *as the deadline approaches* without restarting the effect every
 * render (which `now`-dependent useEffect deps would do). Each tick decides
 * the next delay itself, so we only restart the chain when the deadline
 * value itself moves (e.g. a proposal flips from voting to accepted).
 */
function useNow(soonestDeadlineMs: number | null = null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const pickDelay = (from: number): number => {
      if (soonestDeadlineMs === null) return 30_000;
      const left = soonestDeadlineMs - from;
      return left > 0 && left < 60_000 ? 5_000 : 30_000;
    };
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const next = Date.now();
      setNow(next);
      id = setTimeout(tick, pickDelay(next));
    };
    id = setTimeout(tick, pickDelay(Date.now()));
    return () => clearTimeout(id);
  }, [soonestDeadlineMs]);
  return now;
}

// ── Status badge ────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    [ProposalStatus.SUBMITTED]: { bg: "bg-blue-900/30", text: "text-blue-400", label: "Voting" },
    [ProposalStatus.ACCEPTED]: { bg: "bg-green-900/30", text: "text-green-400", label: "Accepted" },
    [ProposalStatus.REJECTED]: { bg: "bg-red-900/30", text: "text-red-400", label: "Rejected" },
    [ProposalStatus.EXECUTED]: { bg: "bg-emerald-900/30", text: "text-emerald-400", label: "Executed" },
    [ProposalStatus.FAILED]: { bg: "bg-red-900/30", text: "text-red-400", label: "Failed" },
    [ProposalStatus.VETOED]: { bg: "bg-orange-900/30", text: "text-orange-400", label: "Vetoed" },
    [ProposalStatus.EXPIRED]: { bg: "bg-zinc-800", text: "text-zinc-500", label: "Expired" },
  };
  const s = map[status] || { bg: "bg-zinc-800", text: "text-zinc-500", label: status };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ── Tally progress bar ──────────────────────────────────────────────

function TallyBar({
  yes,
  no,
  abstain,
  veto,
}: {
  yes: number;
  no: number;
  abstain: number;
  veto: number;
}) {
  const total = yes + no + abstain + veto;
  if (total === 0) {
    return (
      <div className="mb-1">
        <div className="h-2 w-full rounded-full bg-zinc-800" />
        <div className="mt-1 text-center text-[10px] text-zinc-600">No votes yet</div>
      </div>
    );
  }

  const pYes = (yes / total) * 100;
  const pNo = (no / total) * 100;
  const pAbstain = (abstain / total) * 100;
  const pVeto = (veto / total) * 100;

  return (
    <div className="mb-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        {pYes > 0 && (
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${pYes}%` }}
            title={`Yes: ${yes}`}
          />
        )}
        {pNo > 0 && (
          <div
            className="bg-red-500 transition-all"
            style={{ width: `${pNo}%` }}
            title={`No: ${no}`}
          />
        )}
        {pVeto > 0 && (
          <div
            className="bg-orange-500 transition-all"
            style={{ width: `${pVeto}%` }}
            title={`Veto: ${veto}`}
          />
        )}
        {pAbstain > 0 && (
          <div
            className="bg-zinc-600 transition-all"
            style={{ width: `${pAbstain}%` }}
            title={`Abstain: ${abstain}`}
          />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-green-400">Yes {pYes.toFixed(0)}%<span className="ml-0.5 text-zinc-600">({yes})</span></span>
        <span className="text-red-400">No {pNo.toFixed(0)}%<span className="ml-0.5 text-zinc-600">({no})</span></span>
        {veto > 0 && <span className="text-orange-400">Veto {pVeto.toFixed(0)}%<span className="ml-0.5 text-zinc-600">({veto})</span></span>}
        {abstain > 0 && <span className="text-zinc-500">Abstain {pAbstain.toFixed(0)}%<span className="ml-0.5 text-zinc-600">({abstain})</span></span>}
      </div>
    </div>
  );
}

// ── Proposal card ───────────────────────────────────────────────────

function CommonsProposalCard({
  proposal,
  isMember,
  actionLoading,
  now,
  onVote,
  onExecute,
}: {
  proposal: Proposal;
  isMember: boolean;
  actionLoading: string | null;
  /** Shared ticking clock from the parent — see useNow(). */
  now: number;
  onVote: (id: string, option: number) => void;
  onExecute: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<{
    votes: { voter: string; option: number }[];
    tally: {
      yes_weight: string;
      no_weight: string;
      abstain_weight: string;
      no_with_veto_weight: string;
    };
  } | null>(null);

  const loadDetail = async () => {
    if (detail) {
      setExpanded(!expanded);
      return;
    }
    try {
      const res = await getProposal(proposal.id);
      setDetail({ votes: res.votes || [], tally: res.tally });
      setExpanded(true);
    } catch {
      setExpanded(!expanded);
    }
  };

  const isVoting = proposal.status === ProposalStatus.SUBMITTED;
  const isAccepted = proposal.status === ProposalStatus.ACCEPTED;

  const typeLabel = describeProposalMessages(proposal.messages);
  const remaining =
    isVoting && proposal.voting_deadline && proposal.voting_deadline !== "0"
      ? timeRemaining(proposal.voting_deadline, now)
      : null;

  // `execution_time` is set by the chain when the proposal becomes ACCEPTED:
  // voting_deadline + DecisionPolicy.min_execution_period (the cooldown a
  // council enforces between acceptance and execution). Be lenient with
  // missing / "0" / unparseable values so policies without a cooldown still
  // let the button work immediately.
  const executionTimeMs = (() => {
    const v = proposal.execution_time;
    if (!v || v === "0") return null;
    const n = parseInt(v, 10);
    if (!n || isNaN(n)) return null;
    return n * 1000;
  })();
  const isExecutable = !executionTimeMs || now >= executionTimeMs;
  const executionWait =
    isAccepted && executionTimeMs && !isExecutable
      ? timeRemaining(proposal.execution_time, now)
      : null;

  return (
    <article className="rounded-xl sd-hull-tile p-5">
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">#{proposal.id}</span>
          {statusBadge(proposal.status)}
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            {typeLabel}
          </span>
          {remaining && (
            <span className={`text-xs font-medium ${remaining === "expired" ? "text-red-400" : "text-blue-400"}`}>
              {remaining}
            </span>
          )}
          {executionWait && (
            <span className="text-xs font-medium text-amber-400">
              Executable in {executionWait.replace(" left", "")}
            </span>
          )}
        </div>
        <button
          onClick={loadDetail}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      {/* Metadata / description */}
      {proposal.metadata && (
        <p className="mb-2 text-sm text-zinc-300">{proposal.metadata}</p>
      )}

      {/* Info row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>by <NameOrAddress address={proposal.proposer} /></span>
        <span>{formatTime(proposal.submit_time)}</span>
        {proposal.voting_deadline && proposal.voting_deadline !== "0" && (
          <span>Deadline: {formatTime(proposal.voting_deadline)}</span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && detail && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          {/* Progress bar tally */}
          <TallyBar
            yes={parseFloat(detail.tally.yes_weight || "0")}
            no={parseFloat(detail.tally.no_weight || "0")}
            abstain={parseFloat(detail.tally.abstain_weight || "0")}
            veto={parseFloat(detail.tally.no_with_veto_weight || "0")}
          />

          {/* Individual votes */}
          {detail.votes.length > 0 && (
            <div className="mt-3 space-y-1">
              {detail.votes.map((v) => (
                <div
                  key={v.voter}
                  className="flex items-center gap-2 text-xs"
                >
                  <NameOrAddress address={v.voter} className="font-mono text-zinc-400" />
                  <span className={voteColor(v.option)}>
                    {VOTE_OPTION_LABELS[v.option] || "?"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {isMember && (isVoting || isAccepted) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
          {isVoting && (
            <>
              {[
                VoteOption.YES,
                VoteOption.NO,
                VoteOption.ABSTAIN,
                VoteOption.NO_WITH_VETO,
              ].map((opt) => (
                <button
                  key={opt}
                  onClick={() => onVote(proposal.id, opt)}
                  disabled={actionLoading === `vote-${proposal.id}`}
                  className={`rounded-lg border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${voteButtonStyle(opt)}`}
                >
                  {VOTE_OPTION_LABELS[opt]}
                </button>
              ))}
            </>
          )}
          {isAccepted && (
            <button
              onClick={() => onExecute(proposal.id)}
              disabled={!isExecutable || actionLoading === `exec-${proposal.id}`}
              title={
                !isExecutable
                  ? `Min-execution cooldown — executable at ${formatTime(proposal.execution_time)}`
                  : undefined
              }
              className="rounded-lg border border-green-500/30 bg-green-600/20 px-3 py-1 text-xs text-green-400 transition-colors hover:bg-green-600/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading === `exec-${proposal.id}`
                ? "Executing..."
                : "Execute"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function voteColor(option: number): string {
  switch (option) {
    case VoteOption.YES: return "text-green-400";
    case VoteOption.NO: return "text-red-400";
    case VoteOption.NO_WITH_VETO: return "text-orange-400";
    case VoteOption.ABSTAIN: return "text-zinc-500";
    default: return "text-zinc-500";
  }
}

function voteButtonStyle(option: number): string {
  switch (option) {
    case VoteOption.YES:
      return "border-green-700/50 text-green-400 hover:border-green-500 hover:bg-green-900/20";
    case VoteOption.NO:
      return "border-red-700/50 text-red-400 hover:border-red-500 hover:bg-red-900/20";
    case VoteOption.NO_WITH_VETO:
      return "border-orange-700/50 text-orange-400 hover:border-orange-500 hover:bg-orange-900/20";
    case VoteOption.ABSTAIN:
      return "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300";
    default:
      return "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white";
  }
}
