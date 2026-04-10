"use client";

import { useEffect, useState, useCallback } from "react";
import type { Group, Proposal, Member } from "@/types/commons";
import { ProposalStatus, VoteOption, VOTE_OPTION_LABELS } from "@/types/commons";
import {
  listGroups,
  getCouncilMembers,
  listProposals,
  getProposal,
} from "@/lib/api";
import { CommonsMsgTypeUrls } from "@/lib/tx";
import { useWallet } from "@/contexts/WalletContext";
import { truncateAddress, formatTime } from "@/lib/utils";

export default function GovernancePage() {
  const { address, connected, signAndBroadcast } = useWallet();

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteAddress, setInviteAddress] = useState("");
  const [inviteWeight, setInviteWeight] = useState("1");
  const [inviteMetadata, setInviteMetadata] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const isMember = members.some((m) => m.address === address);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listGroups();
      setGroups(res.group || []);
      if (res.group?.length > 0 && !selectedGroup) {
        setSelectedGroup(res.group[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load groups");
    }
  }, [selectedGroup]);

  const fetchGroupData = useCallback(async () => {
    if (!selectedGroup) return;
    try {
      setLoading(true);
      const [membersRes, proposalsRes] = await Promise.all([
        getCouncilMembers(selectedGroup.index),
        listProposals(selectedGroup.index, { reverse: true, limit: "50" }),
      ]);
      setMembers(membersRes.members || []);
      setProposals(proposalsRes.proposals || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedGroup]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    if (selectedGroup) fetchGroupData();
  }, [selectedGroup, fetchGroupData]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !selectedGroup || !inviteAddress.trim()) return;

    setInviting(true);
    setInviteError(null);

    try {
      // Encode the inner MsgUpdateGroupMembers as an Any
      const { MsgUpdateGroupMembers } = await import(
        "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
      );
      const innerMsg = MsgUpdateGroupMembers.encode({
        authority: selectedGroup.policy_address,
        groupPolicyAddress: selectedGroup.policy_address,
        membersToAdd: [inviteAddress.trim()],
        weightsToAdd: [inviteWeight || "1"],
        membersToRemove: [],
      }).finish();

      await signAndBroadcast([
        {
          typeUrl: CommonsMsgTypeUrls.SubmitProposal,
          value: {
            proposer: address,
            policyAddress: selectedGroup.policy_address,
            messages: [
              {
                typeUrl: CommonsMsgTypeUrls.UpdateGroupMembers,
                value: innerMsg,
              },
            ],
            metadata: inviteMetadata.trim() || `Invite ${truncateAddress(inviteAddress.trim())} as member`,
          },
        },
      ]);

      setInviteAddress("");
      setInviteWeight("1");
      setInviteMetadata("");
      setShowInvite(false);
      await fetchGroupData();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to submit proposal");
    } finally {
      setInviting(false);
    }
  };

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
      await fetchGroupData();
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
      await fetchGroupData();
    } catch (err) {
      console.error("Execute failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

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

  function describeMessages(msgs: { type_url: string }[]): string {
    if (!msgs?.length) return "No messages";
    return msgs
      .map((m) => {
        const parts = m.type_url.split(".");
        return parts[parts.length - 1].replace("Msg", "");
      })
      .join(", ");
  }

  if (!connected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-white">Governance</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">Connect your wallet to participate in governance</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Governance</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Council proposals and member management
          </p>
        </div>
        {isMember && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            {showInvite ? "Cancel" : "Invite Member"}
          </button>
        )}
      </div>

      {/* Group selector */}
      {groups.length > 1 && (
        <div className="mb-6">
          <select
            value={selectedGroup?.index || ""}
            onChange={(e) => {
              const g = groups.find((g) => g.index === e.target.value);
              if (g) setSelectedGroup(g);
            }}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300 focus:border-zinc-600 focus:outline-none"
          >
            {groups.map((g) => (
              <option key={g.index} value={g.index}>
                {g.index}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Members */}
      {selectedGroup && (
        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            {selectedGroup.index} &middot; {members.length} members
          </h2>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <span
                key={m.address}
                className={`rounded-lg px-2.5 py-1 text-xs font-mono ${
                  m.address === address
                    ? "bg-indigo-900/30 text-indigo-400 border border-indigo-500/30"
                    : "bg-zinc-800 text-zinc-400"
                }`}
                title={`${m.metadata || m.address} (weight: ${m.weight})`}
              >
                {m.metadata && m.metadata !== "N/A"
                  ? <><span className="font-sans font-medium">{m.metadata}</span>{" "}<span className="text-zinc-500">{truncateAddress(m.address)}</span></>
                  : truncateAddress(m.address)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Invite form */}
      {showInvite && selectedGroup && (
        <form
          onSubmit={handleInvite}
          className="mb-8 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
        >
          <h2 className="text-lg font-semibold text-white">
            Propose New Member
          </h2>
          <p className="text-xs text-zinc-500">
            This will submit a governance proposal to add the address as a member of {selectedGroup.index}.
            Other council members will need to vote to approve it.
          </p>

          <div>
            <label htmlFor="inviteAddr" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Address to Invite
            </label>
            <input
              id="inviteAddr"
              type="text"
              value={inviteAddress}
              onChange={(e) => setInviteAddress(e.target.value)}
              placeholder="sprkdrm1..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="inviteWeight" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Voting Weight
              </label>
              <input
                id="inviteWeight"
                type="number"
                min="1"
                value={inviteWeight}
                onChange={(e) => setInviteWeight(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
            </div>
            <div>
              <label htmlFor="inviteMeta" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Proposal Note (optional)
              </label>
              <input
                id="inviteMeta"
                type="text"
                value={inviteMetadata}
                onChange={(e) => setInviteMetadata(e.target.value)}
                placeholder="Reason for invite"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
            </div>
          </div>

          {inviteError && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
              {inviteError}
            </div>
          )}

          <button
            type="submit"
            disabled={inviting || !inviteAddress.trim()}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {inviting ? "Submitting..." : "Submit Proposal"}
          </button>
        </form>
      )}

      {/* Proposals */}
      <h2 className="mb-4 text-lg font-semibold text-white">Proposals</h2>

      {error && (
        <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={fetchGroupData} className="ml-2 underline hover:text-red-300">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50"
            />
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">No proposals yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              isMember={isMember}
              actionLoading={actionLoading}
              onVote={handleVote}
              onExecute={handleExecute}
              statusBadge={statusBadge}
              describeMessages={describeMessages}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  proposal,
  isMember,
  actionLoading,
  onVote,
  onExecute,
  statusBadge,
  describeMessages,
}: {
  proposal: Proposal;
  isMember: boolean;
  actionLoading: string | null;
  onVote: (id: string, option: number) => void;
  onExecute: (id: string) => void;
  statusBadge: (s: string) => React.ReactNode;
  describeMessages: (msgs: { type_url: string }[]) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<{ votes: { voter: string; option: number }[]; tally: { yes_weight: string; no_weight: string; abstain_weight: string; no_with_veto_weight: string } } | null>(null);

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

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">#{proposal.id}</span>
          {statusBadge(proposal.status)}
          <span className="text-xs text-zinc-500">
            {describeMessages(proposal.messages)}
          </span>
        </div>
        <button
          onClick={loadDetail}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      {proposal.metadata && (
        <p className="mb-2 text-sm text-zinc-300">{proposal.metadata}</p>
      )}

      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <span>by {truncateAddress(proposal.proposer)}</span>
        <span>{formatTime(proposal.submit_time)}</span>
        {proposal.voting_deadline && proposal.voting_deadline !== "0" && (
          <span>Deadline: {formatTime(proposal.voting_deadline)}</span>
        )}
      </div>

      {expanded && detail && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          {/* Tally */}
          <div className="mb-3 grid grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded bg-green-900/20 p-2">
              <div className="font-medium text-green-400">{detail.tally.yes_weight || "0"}</div>
              <div className="text-zinc-500">Yes</div>
            </div>
            <div className="rounded bg-red-900/20 p-2">
              <div className="font-medium text-red-400">{detail.tally.no_weight || "0"}</div>
              <div className="text-zinc-500">No</div>
            </div>
            <div className="rounded bg-zinc-800 p-2">
              <div className="font-medium text-zinc-400">{detail.tally.abstain_weight || "0"}</div>
              <div className="text-zinc-500">Abstain</div>
            </div>
            <div className="rounded bg-orange-900/20 p-2">
              <div className="font-medium text-orange-400">{detail.tally.no_with_veto_weight || "0"}</div>
              <div className="text-zinc-500">Veto</div>
            </div>
          </div>

          {/* Votes */}
          {detail.votes.length > 0 && (
            <div className="mb-3 space-y-1">
              {detail.votes.map((v) => (
                <div key={v.voter} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-zinc-400">{truncateAddress(v.voter)}</span>
                  <span className="text-zinc-500">{VOTE_OPTION_LABELS[v.option] || "?"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {isMember && (isVoting || isAccepted) && (
        <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
          {isVoting && (
            <>
              {[VoteOption.YES, VoteOption.NO, VoteOption.ABSTAIN, VoteOption.NO_WITH_VETO].map(
                (opt) => (
                  <button
                    key={opt}
                    onClick={() => onVote(proposal.id, opt)}
                    disabled={actionLoading === `vote-${proposal.id}`}
                    className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-50"
                  >
                    {VOTE_OPTION_LABELS[opt]}
                  </button>
                )
              )}
            </>
          )}
          {isAccepted && (
            <button
              onClick={() => onExecute(proposal.id)}
              disabled={actionLoading === `exec-${proposal.id}`}
              className="rounded-lg bg-green-600/20 border border-green-500/30 px-3 py-1 text-xs text-green-400 transition-colors hover:bg-green-600/30 disabled:opacity-50"
            >
              {actionLoading === `exec-${proposal.id}` ? "Executing..." : "Execute"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
