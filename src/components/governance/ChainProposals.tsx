"use client";

import { useEffect, useState, useCallback } from "react";
import type { GovProposal, GovTallyResult, GovVote } from "@/types/gov";
import {
  GovProposalStatus,
  GovVoteOptionNum,
  GOV_VOTE_OPTION_LABELS,
} from "@/types/gov";
import {
  listGovProposals,
  getGovProposalVotes,
  getGovProposalTally,
} from "@/lib/api";
import { GovMsgTypeUrls } from "@/lib/tx";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  truncateAddress,
  timeRemaining,
  describeProposalMessages,
} from "@/lib/utils";
import NewChainProposal from "./NewChainProposal";
import NumberInput from "@/components/NumberInput";

export default function ChainProposals() {
  const { address, connected, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const [proposals, setProposals] = useState<GovProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showNewProposal, setShowNewProposal] = useState(false);

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listGovProposals(undefined, {
        reverse: true,
        limit: "50",
      });
      setProposals(res.proposals || []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load proposals"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const handleVote = async (proposalId: string, option: number) => {
    setActionLoading(`vote-${proposalId}`);
    try {
      await signAndBroadcast([
        {
          typeUrl: GovMsgTypeUrls.Vote,
          value: {
            proposalId: BigInt(proposalId),
            voter: address,
            option,
          },
        },
      ]);
      await fetchProposals();
    } catch (err) {
      console.error("Vote failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeposit = async (proposalId: string, amount: string) => {
    setActionLoading(`deposit-${proposalId}`);
    try {
      await signAndBroadcast([
        {
          typeUrl: GovMsgTypeUrls.Deposit,
          value: {
            proposalId: BigInt(proposalId),
            depositor: address,
            amount: [{ denom: config.denom, amount }],
          },
        },
      ]);
      await fetchProposals();
    } catch (err) {
      console.error("Deposit failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Chain Proposals</h2>
        {!showNewProposal && (
          <button
            type="button"
            onClick={() => setShowNewProposal(true)}
            disabled={!connected}
            title={connected ? "MsgSubmitProposal" : "Connect a wallet to submit a chain proposal"}
            className="sd-btn sd-btn-primary"
          >
            New Proposal
          </button>
        )}
      </div>

      {showNewProposal && (
        <div className="mb-6">
          <NewChainProposal
            onClose={() => setShowNewProposal(false)}
            onSuccess={() => {
              setShowNewProposal(false);
              fetchProposals();
            }}
          />
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button
            onClick={fetchProposals}
            className="ml-2 underline hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl sd-hull-tile p-5"
            >
              <div className="mb-2 h-5 w-2/3 rounded bg-zinc-800" />
              <div className="mb-2 h-4 w-1/2 rounded bg-zinc-800/60" />
              <div className="flex gap-4">
                <div className="h-3 w-24 rounded bg-zinc-800" />
                <div className="h-3 w-20 rounded bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No chain proposals yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <GovProposalCard
              key={proposal.id}
              proposal={proposal}
              connected={connected}
              actionLoading={actionLoading}
              displayDenom={config.displayDenom}
              denom={config.denom}
              onVote={handleVote}
              onDeposit={handleDeposit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Status badge ────────────────────────────────────────────────────

function govStatusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    [GovProposalStatus.DEPOSIT_PERIOD]: {
      bg: "bg-yellow-900/30",
      text: "text-yellow-400",
      label: "Deposit",
    },
    [GovProposalStatus.VOTING_PERIOD]: {
      bg: "bg-blue-900/30",
      text: "text-blue-400",
      label: "Voting",
    },
    [GovProposalStatus.PASSED]: {
      bg: "bg-emerald-900/30",
      text: "text-emerald-400",
      label: "Passed",
    },
    [GovProposalStatus.REJECTED]: {
      bg: "bg-red-900/30",
      text: "text-red-400",
      label: "Rejected",
    },
    [GovProposalStatus.FAILED]: {
      bg: "bg-red-900/30",
      text: "text-red-400",
      label: "Failed",
    },
  };
  const s = map[status] || {
    bg: "bg-zinc-800",
    text: "text-zinc-500",
    label: status.replace("PROPOSAL_STATUS_", ""),
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatCoins(
  coins: { denom: string; amount: string }[],
  displayDenom: string
): string {
  if (!coins?.length) return "0";
  return coins
    .map((c) => {
      const amt = parseInt(c.amount, 10);
      if (c.denom.startsWith("u")) {
        return `${(amt / 1_000_000).toLocaleString()} ${displayDenom}`;
      }
      return `${amt.toLocaleString()} ${c.denom}`;
    })
    .join(", ");
}

function formatISOTime(iso: string): string {
  if (!iso || iso === "0001-01-01T00:00:00Z") return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Decode chain proposal inner messages into human-readable lines */
function decodeGovMessages(
  msgs: { "@type": string; [key: string]: unknown }[],
  displayDenom: string
): string[] {
  if (!msgs?.length) return [];
  return msgs.map((m) => {
    const t = m["@type"] || "";

    if (t.includes("MsgSoftwareUpgrade")) {
      const plan = m.plan as Record<string, unknown> | undefined;
      if (plan) return `Upgrade "${plan.name}" at height ${plan.height}`;
      return "Software upgrade";
    }

    if (t.includes("MsgCancelUpgrade")) {
      return "Cancel pending software upgrade";
    }

    if (t.includes("MsgRenewGroup")) {
      const name = m.group_name as string;
      const members = m.new_members as string[];
      return `Renew council "${name}" with ${members?.length || "?"} members`;
    }

    if (t.includes("MsgRegisterGroup")) {
      const name = m.name as string;
      const members = m.members as string[];
      return `Register council "${name}" with ${members?.length || "?"} members`;
    }

    if (t.includes("MsgUpdateParams")) {
      // Extract module name from type URL
      const parts = t.split(".");
      const mod = parts.length >= 3 ? parts[parts.length - 3] : "unknown";
      return `Update ${mod} module parameters`;
    }

    if (t.includes("MsgCommunityPoolSpend") || t.includes("MsgSpendFromCommons")) {
      const recipient = m.recipient as string;
      const amount = m.amount as { denom: string; amount: string }[];
      return `Send ${formatCoins(amount || [], displayDenom)} to ${recipient ? truncateAddress(recipient) : "?"}`;
    }

    if (t.includes("MsgUpdateGroupMembers")) {
      const add = m.members_to_add as string[];
      const remove = m.members_to_remove as string[];
      const parts: string[] = [];
      if (add?.length) parts.push(`add ${add.length} member${add.length > 1 ? "s" : ""}`);
      if (remove?.length) parts.push(`remove ${remove.length} member${remove.length > 1 ? "s" : ""}`);
      return parts.join(", ") || "Update group members";
    }

    return "";
  }).filter(Boolean);
}

// ── Tally progress bar ──────────────────────────────────────────────

function GovTallyBar({
  yes,
  no,
  abstain,
  veto,
  displayDenom,
  denom,
}: {
  yes: string;
  no: string;
  abstain: string;
  veto: string;
  displayDenom: string;
  denom: string;
}) {
  const yesN = parseInt(yes || "0", 10);
  const noN = parseInt(no || "0", 10);
  const abstainN = parseInt(abstain || "0", 10);
  const vetoN = parseInt(veto || "0", 10);
  const total = yesN + noN + abstainN + vetoN;

  if (total === 0) {
    return (
      <div className="mb-1">
        <div className="h-2 w-full rounded-full bg-zinc-800" />
        <div className="mt-1 text-center text-[10px] text-zinc-600">
          No votes yet
        </div>
      </div>
    );
  }

  const pYes = (yesN / total) * 100;
  const pNo = (noN / total) * 100;
  const pAbstain = (abstainN / total) * 100;
  const pVeto = (vetoN / total) * 100;

  const fmt = (amt: number) =>
    denom.startsWith("u")
      ? `${(amt / 1_000_000).toLocaleString()} ${displayDenom}`
      : `${amt.toLocaleString()}`;

  return (
    <div className="mb-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        {pYes > 0 && <div className="bg-green-500 transition-all" style={{ width: `${pYes}%` }} />}
        {pNo > 0 && <div className="bg-red-500 transition-all" style={{ width: `${pNo}%` }} />}
        {pVeto > 0 && <div className="bg-orange-500 transition-all" style={{ width: `${pVeto}%` }} />}
        {pAbstain > 0 && <div className="bg-zinc-600 transition-all" style={{ width: `${pAbstain}%` }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-green-400">Yes {pYes.toFixed(0)}%<span className="ml-0.5 text-zinc-600">({fmt(yesN)})</span></span>
        <span className="text-red-400">No {pNo.toFixed(0)}%<span className="ml-0.5 text-zinc-600">({fmt(noN)})</span></span>
        {vetoN > 0 && <span className="text-orange-400">Veto {pVeto.toFixed(0)}%<span className="ml-0.5 text-zinc-600">({fmt(vetoN)})</span></span>}
        {abstainN > 0 && <span className="text-zinc-500">Abstain {pAbstain.toFixed(0)}%<span className="ml-0.5 text-zinc-600">({fmt(abstainN)})</span></span>}
      </div>
    </div>
  );
}

// ── Proposal card ───────────────────────────────────────────────────

function GovProposalCard({
  proposal,
  connected,
  actionLoading,
  displayDenom,
  denom,
  onVote,
  onDeposit,
}: {
  proposal: GovProposal;
  connected: boolean;
  actionLoading: string | null;
  displayDenom: string;
  denom: string;
  onVote: (id: string, option: number) => void;
  onDeposit: (id: string, amount: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tally, setTally] = useState<GovTallyResult | null>(null);
  const [votes, setVotes] = useState<GovVote[] | null>(null);
  const [depositAmount, setDepositAmount] = useState("");

  const loadDetail = async () => {
    if (tally) {
      setExpanded(!expanded);
      return;
    }
    try {
      const [tallyRes, votesRes] = await Promise.all([
        getGovProposalTally(proposal.id),
        getGovProposalVotes(proposal.id),
      ]);
      setTally(tallyRes.tally);
      setVotes(votesRes.votes || []);
      setExpanded(true);
    } catch {
      setExpanded(!expanded);
    }
  };

  const isDeposit = proposal.status === GovProposalStatus.DEPOSIT_PERIOD;
  const isVoting = proposal.status === GovProposalStatus.VOTING_PERIOD;

  const typeLabel = describeProposalMessages(proposal.messages);
  const decodedMsgs = decodeGovMessages(proposal.messages, displayDenom);

  // Time remaining
  let remaining: string | null = null;
  if (isVoting && proposal.voting_end_time) {
    remaining = timeRemaining(proposal.voting_end_time);
  } else if (isDeposit && proposal.deposit_end_time) {
    remaining = timeRemaining(proposal.deposit_end_time);
  }

  return (
    <article className="rounded-xl sd-hull-tile p-5">
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">#{proposal.id}</span>
          {govStatusBadge(proposal.status)}
          {typeLabel !== "General Vote" && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              {typeLabel}
            </span>
          )}
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

      {/* Title + summary */}
      {proposal.title && (
        <h3 className="mb-1 text-sm font-medium text-white">
          {proposal.title}
        </h3>
      )}
      {proposal.summary && (
        <p className="mb-2 line-clamp-2 text-sm text-zinc-400">
          {proposal.summary}
        </p>
      )}

      {/* Decoded message details */}
      {decodedMsgs.length > 0 && (
        <div className="mb-2 space-y-0.5">
          {decodedMsgs.map((line, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-zinc-400">
              <span className="mt-0.5 text-indigo-400/60">&#9656;</span>
              {line}
            </div>
          ))}
        </div>
      )}

      {/* Info row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>by {truncateAddress(proposal.proposer)}</span>
        <span>{formatISOTime(proposal.submit_time)}</span>
        {isDeposit && (
          <span>
            Deposit: {formatCoins(proposal.total_deposit, displayDenom)}
          </span>
        )}
        {isVoting && proposal.voting_end_time && (
          <span>Ends: {formatISOTime(proposal.voting_end_time)}</span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          {/* Progress bar tally */}
          {tally && (
            <GovTallyBar
              yes={tally.yes_count}
              no={tally.no_count}
              abstain={tally.abstain_count}
              veto={tally.no_with_veto_count}
              displayDenom={displayDenom}
              denom={denom}
            />
          )}

          {/* Individual votes */}
          {votes && votes.length > 0 && (
            <div className="mt-3 space-y-1">
              {votes.slice(0, 20).map((v) => (
                <div
                  key={v.voter}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="font-mono text-zinc-400">
                    {truncateAddress(v.voter)}
                  </span>
                  <span className="text-zinc-500">
                    {v.options
                      ?.map(
                        (o) =>
                          GOV_VOTE_OPTION_LABELS[o.option] ||
                          o.option.replace("VOTE_OPTION_", "")
                      )
                      .join(", ") || "?"}
                  </span>
                </div>
              ))}
              {votes.length > 20 && (
                <div className="text-xs text-zinc-600">
                  ... and {votes.length - 20} more
                </div>
              )}
            </div>
          )}

          {/* Full summary when long */}
          {proposal.summary && proposal.summary.length > 200 && (
            <div className="mt-3 rounded bg-zinc-800/50 p-3 text-xs text-zinc-400">
              {proposal.summary}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {connected && (isVoting || isDeposit) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
          {isVoting && (
            <>
              {[
                { opt: GovVoteOptionNum.YES, label: "Yes", style: "border-green-700/50 text-green-400 hover:border-green-500 hover:bg-green-900/20" },
                { opt: GovVoteOptionNum.NO, label: "No", style: "border-red-700/50 text-red-400 hover:border-red-500 hover:bg-red-900/20" },
                { opt: GovVoteOptionNum.ABSTAIN, label: "Abstain", style: "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300" },
                { opt: GovVoteOptionNum.NO_WITH_VETO, label: "No with Veto", style: "border-orange-700/50 text-orange-400 hover:border-orange-500 hover:bg-orange-900/20" },
              ].map(({ opt, label, style }) => (
                <button
                  key={opt}
                  onClick={() => onVote(proposal.id, opt)}
                  disabled={actionLoading === `vote-${proposal.id}`}
                  className={`rounded-lg border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${style}`}
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {isDeposit && (
            <div className="flex items-center gap-2">
              <NumberInput
                placeholder={`Amount (${displayDenom})`}
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                wrapperClassName="w-36"
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={() => {
                  if (!depositAmount) return;
                  const microAmount = (
                    parseFloat(depositAmount) * 1_000_000
                  ).toFixed(0);
                  onDeposit(proposal.id, microAmount);
                  setDepositAmount("");
                }}
                disabled={
                  actionLoading === `deposit-${proposal.id}` || !depositAmount
                }
                className="rounded-lg border border-yellow-500/30 bg-yellow-600/20 px-3 py-1 text-xs text-yellow-400 transition-colors hover:bg-yellow-600/30 disabled:opacity-50"
              >
                {actionLoading === `deposit-${proposal.id}`
                  ? "Depositing..."
                  : "Deposit"}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
