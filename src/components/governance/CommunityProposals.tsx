"use client";

import { useState } from "react";
import type { Group, Proposal, Member } from "@/types/commons";
import { ProposalStatus, VoteOption, VOTE_OPTION_LABELS } from "@/types/commons";
import { getProposal } from "@/lib/api";
import { CommonsMsgTypeUrls } from "@/lib/tx";
import { useWallet } from "@/contexts/WalletContext";
import {
  truncateAddress,
  formatTime,
  timeRemaining,
  describeProposalMessages,
} from "@/lib/utils";
import NewCommunityProposal from "./NewCommunityProposal";

interface CommunityProposalsProps {
  group: Group;
  members: Member[];
  proposals: Proposal[];
  loading: boolean;
  onRefresh: () => void;
}

export default function CommunityProposals({
  group,
  members,
  proposals,
  loading,
  onRefresh,
}: CommunityProposalsProps) {
  const { address, signAndBroadcast } = useWallet();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showNewProposal, setShowNewProposal] = useState(false);

  const isMember = members.some((m) => m.address === address);

  const handleVote = async (proposalId: string, option: number) => {
    setActionLoading(`vote-${proposalId}`);
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
      onRefresh();
    } catch (err) {
      console.error("Vote failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecute = async (proposalId: string) => {
    setActionLoading(`exec-${proposalId}`);
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
      onRefresh();
    } catch (err) {
      console.error("Execute failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Proposals</h2>
        {isMember && (
          <button
            onClick={() => setShowNewProposal(!showNewProposal)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            {showNewProposal ? "Cancel" : "New Proposal"}
          </button>
        )}
      </div>

      {showNewProposal && (
        <div className="mb-6">
          <NewCommunityProposal
            group={group}
            members={members}
            onClose={() => setShowNewProposal(false)}
            onSuccess={() => {
              setShowNewProposal(false);
              onRefresh();
            }}
          />
        </div>
      )}

      {loading ? (
        <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">No proposals yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <CommonsProposalCard
              key={proposal.id}
              proposal={proposal}
              isMember={isMember}
              actionLoading={actionLoading}
              onVote={handleVote}
              onExecute={handleExecute}
            />
          ))}
        </div>
      )}
    </div>
  );
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
  onVote,
  onExecute,
}: {
  proposal: Proposal;
  isMember: boolean;
  actionLoading: string | null;
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
      ? timeRemaining(proposal.voting_deadline)
      : null;

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
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
        <span>by {truncateAddress(proposal.proposer)}</span>
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
                  <span className="font-mono text-zinc-400">
                    {truncateAddress(v.voter)}
                  </span>
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
              disabled={actionLoading === `exec-${proposal.id}`}
              className="rounded-lg border border-green-500/30 bg-green-600/20 px-3 py-1 text-xs text-green-400 transition-colors hover:bg-green-600/30 disabled:opacity-50"
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
