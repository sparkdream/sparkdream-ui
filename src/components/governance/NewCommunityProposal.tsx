"use client";

import { useState, useEffect } from "react";
import type { Group, Member } from "@/types/commons";
import { CommonsMsgTypeUrls } from "@/lib/tx";
import { listGroups } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { truncateAddress } from "@/lib/utils";

type ProposalType =
  | "general"
  | "invite"
  | "remove"
  | "treasury-spend"
  | "update-config"
  | "create-category";

const PROPOSAL_TYPES: { value: ProposalType; label: string; description: string }[] = [
  { value: "general", label: "General Vote", description: "Signaling vote with no executable action" },
  { value: "treasury-spend", label: "Treasury Spend", description: "Propose sending funds from the council treasury" },
  { value: "invite", label: "Invite Member", description: "Propose adding a new council member" },
  { value: "remove", label: "Remove Member", description: "Propose removing a council member" },
  { value: "update-config", label: "Update Config", description: "Propose changing a child committee's settings" },
  { value: "create-category", label: "Create Forum Category", description: "Propose creating a new forum category" },
];

interface NewCommunityProposalProps {
  group: Group;
  members: Member[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function NewCommunityProposal({
  group,
  members,
  onClose,
  onSuccess,
}: NewCommunityProposalProps) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const [type, setType] = useState<ProposalType>("general");
  const [metadata, setMetadata] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Target group for member changes — own group or parent
  // Only governance committees can manage their parent council's membership.
  // A real parent group has a 32-byte policy address (~66 chars bech32);
  // module authority accounts are 20 bytes (~46 chars) and don't count.
  const isGovernanceCommittee = group.index.toLowerCase().includes("governance");
  const hasParent = isGovernanceCommittee
    && !!group.parent_policy_address
    && group.parent_policy_address !== group.policy_address
    && group.parent_policy_address.length > 50;
  const [memberTarget, setMemberTarget] = useState<"self" | "parent">(hasParent ? "parent" : "self");
  const targetPolicyAddress = memberTarget === "parent" && hasParent
    ? group.parent_policy_address
    : group.policy_address;

  // Invite fields
  const [inviteAddress, setInviteAddress] = useState("");
  const [inviteWeight, setInviteWeight] = useState("1");

  // Remove fields
  const [removeAddress, setRemoveAddress] = useState("");

  // Treasury spend fields
  const [spendRecipient, setSpendRecipient] = useState("");
  const [spendAmount, setSpendAmount] = useState("");

  // Update config fields — targets a child group, not self
  const [childGroups, setChildGroups] = useState<Group[]>([]);
  const [configTargetGroup, setConfigTargetGroup] = useState("");
  const [configVoteThreshold, setConfigVoteThreshold] = useState("");
  const [configVotingPeriod, setConfigVotingPeriod] = useState("");
  const [configMinExecPeriod, setConfigMinExecPeriod] = useState("");
  const [configMinMembers, setConfigMinMembers] = useState("");
  const [configMaxMembers, setConfigMaxMembers] = useState("");
  const [configTermDuration, setConfigTermDuration] = useState("");
  const [configPolicyType, setConfigPolicyType] = useState("");

  // Create category fields
  const [categoryTitle, setCategoryTitle] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryMembersOnly, setCategoryMembersOnly] = useState(false);
  const [categoryAdminOnly, setCategoryAdminOnly] = useState(false);

  // Fetch child groups for update-config targeting.
  // A child is linked via parent_policy_address OR is the electoral committee.
  useEffect(() => {
    let cancelled = false;
    async function loadChildren() {
      try {
        const res = await listGroups();
        const children = (res.group || []).filter(
          (g) =>
            g.policy_address !== group.policy_address &&
            (g.parent_policy_address === group.policy_address ||
             g.policy_address === group.electoral_policy_address)
        );
        if (!cancelled) {
          setChildGroups(children);
          if (children.length > 0) setConfigTargetGroup((prev) => prev || children[0].index);
        }
      } catch {
        // ignore
      }
    }
    loadChildren();
    return () => { cancelled = true; };
  }, [group.policy_address]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const innerMessages: { typeUrl: string; value: Uint8Array }[] = [];

      if (type === "invite") {
        if (!inviteAddress.trim()) throw new Error("Address is required");
        const { MsgUpdateGroupMembers } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
        );
        innerMessages.push({
          typeUrl: CommonsMsgTypeUrls.UpdateGroupMembers,
          value: MsgUpdateGroupMembers.encode(
            MsgUpdateGroupMembers.fromPartial({
              authority: group.policy_address,
              groupPolicyAddress: targetPolicyAddress,
              membersToAdd: [inviteAddress.trim()],
              weightsToAdd: [inviteWeight || "1"],
              membersToRemove: [],
            })
          ).finish(),
        });
      } else if (type === "remove") {
        if (!removeAddress) throw new Error("Select a member to remove");
        const { MsgUpdateGroupMembers } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
        );
        innerMessages.push({
          typeUrl: CommonsMsgTypeUrls.UpdateGroupMembers,
          value: MsgUpdateGroupMembers.encode(
            MsgUpdateGroupMembers.fromPartial({
              authority: group.policy_address,
              groupPolicyAddress: targetPolicyAddress,
              membersToAdd: [],
              weightsToAdd: [],
              membersToRemove: [removeAddress],
            })
          ).finish(),
        });
      } else if (type === "treasury-spend") {
        if (!spendRecipient.trim()) throw new Error("Recipient is required");
        if (!spendAmount || parseFloat(spendAmount) <= 0) throw new Error("Amount is required");
        const { MsgSpendFromCommons } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
        );
        const microAmount = (parseFloat(spendAmount) * 1_000_000).toFixed(0);
        innerMessages.push({
          typeUrl: CommonsMsgTypeUrls.SpendFromCommons,
          value: MsgSpendFromCommons.encode(
            MsgSpendFromCommons.fromPartial({
              authority: group.policy_address,
              recipient: spendRecipient.trim(),
              amount: [{ denom: config.denom, amount: microAmount }],
            })
          ).finish(),
        });
      } else if (type === "update-config") {
        if (!configTargetGroup) throw new Error("Select a child group to configure");
        const { MsgUpdateGroupConfig } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
        );
        innerMessages.push({
          typeUrl: CommonsMsgTypeUrls.UpdateGroupConfig,
          value: MsgUpdateGroupConfig.encode(
            MsgUpdateGroupConfig.fromPartial({
              authority: group.policy_address,
              groupName: configTargetGroup,
              ...(configVoteThreshold ? { voteThreshold: configVoteThreshold } : {}),
              ...(configVotingPeriod ? { votingPeriod: BigInt(parseInt(configVotingPeriod) * 3600) } : {}),
              ...(configMinExecPeriod ? { minExecutionPeriod: BigInt(parseInt(configMinExecPeriod) * 3600) } : {}),
              ...(configMinMembers ? { minMembers: BigInt(configMinMembers) } : {}),
              ...(configMaxMembers ? { maxMembers: BigInt(configMaxMembers) } : {}),
              ...(configTermDuration ? { termDuration: BigInt(parseInt(configTermDuration) * 86400) } : {}),
              ...(configPolicyType ? { policyType: configPolicyType } : {}),
            })
          ).finish(),
        });
      } else if (type === "create-category") {
        if (!categoryTitle.trim()) throw new Error("Category title is required");
        const { MsgCreateCategory } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
        );
        innerMessages.push({
          typeUrl: CommonsMsgTypeUrls.CreateCategory,
          value: MsgCreateCategory.encode(
            MsgCreateCategory.fromPartial({
              creator: group.policy_address,
              title: categoryTitle.trim(),
              description: categoryDescription.trim(),
              membersOnlyWrite: categoryMembersOnly,
              adminOnlyWrite: categoryAdminOnly,
            })
          ).finish(),
        });
      }
      // "general" has no inner messages — signaling vote only

      const proposalMetadata =
        metadata.trim() ||
        defaultMetadata(type, {
          inviteAddress,
          removeAddress,
          spendRecipient,
          spendAmount,
          displayDenom: config.displayDenom,
          categoryTitle,
        });

      await signAndBroadcast([
        {
          typeUrl: CommonsMsgTypeUrls.SubmitProposal,
          value: {
            proposer: address,
            policyAddress: group.policy_address,
            messages: innerMessages,
            metadata: proposalMetadata,
          },
        },
      ]);

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit proposal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">New Proposal</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>

      {/* Proposal type selector */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          Proposal Type
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PROPOSAL_TYPES.map((pt) => (
            <button
              key={pt.value}
              type="button"
              onClick={() => setType(pt.value)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                type === pt.value
                  ? "border-indigo-500/50 bg-indigo-600/15 text-indigo-400"
                  : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              <div className="font-medium">{pt.label}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{pt.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Target group selector for member changes */}
      {hasParent && (type === "invite" || type === "remove") && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Target Group
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMemberTarget("parent")}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                memberTarget === "parent"
                  ? "border-indigo-500/50 bg-indigo-600/15 text-indigo-400"
                  : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              <div className="font-medium">Parent Council</div>
              <div className="mt-0.5 text-xs text-zinc-500">Manage parent group members</div>
            </button>
            <button
              type="button"
              onClick={() => setMemberTarget("self")}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                memberTarget === "self"
                  ? "border-indigo-500/50 bg-indigo-600/15 text-indigo-400"
                  : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              <div className="font-medium">This Committee</div>
              <div className="mt-0.5 text-xs text-zinc-500">Manage own members</div>
            </button>
          </div>
        </div>
      )}

      {/* Type-specific fields */}
      {type === "invite" && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Address to Invite
            </label>
            <input
              type="text"
              value={inviteAddress}
              onChange={(e) => setInviteAddress(e.target.value)}
              placeholder="sprkdrm1..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 font-mono text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Voting Weight
            </label>
            <input
              type="number"
              min="1"
              value={inviteWeight}
              onChange={(e) => setInviteWeight(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      )}

      {type === "remove" && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Member to Remove
          </label>
          <select
            value={removeAddress}
            onChange={(e) => setRemoveAddress(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">Select a member...</option>
            {members.map((m) => (
              <option key={m.address} value={m.address}>
                {m.metadata && m.metadata !== "N/A"
                  ? `${m.metadata} (${truncateAddress(m.address)})`
                  : truncateAddress(m.address)}{" "}
                — weight: {m.weight}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === "treasury-spend" && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Recipient Address
            </label>
            <input
              type="text"
              value={spendRecipient}
              onChange={(e) => setSpendRecipient(e.target.value)}
              placeholder="sprkdrm1..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 font-mono text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Amount ({config.displayDenom})
            </label>
            <input
              type="number"
              step="any"
              min="0"
              value={spendAmount}
              onChange={(e) => setSpendAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>
      )}

      {type === "update-config" && childGroups.length === 0 && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-3 text-sm text-zinc-500">
          This group has no child committees to configure.
        </div>
      )}

      {type === "update-config" && childGroups.length > 0 && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Target Committee
            </label>
            <select
              value={configTargetGroup}
              onChange={(e) => setConfigTargetGroup(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {childGroups.map((g) => (
                <option key={g.index} value={g.index}>{g.index}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-zinc-500">
            Leave fields blank to keep their current values.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Vote Threshold
              </label>
              <input
                type="text"
                value={configVoteThreshold}
                onChange={(e) => setConfigVoteThreshold(e.target.value)}
                placeholder="e.g. 0.51"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Policy Type
              </label>
              <select
                value={configPolicyType}
                onChange={(e) => setConfigPolicyType(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="">No change</option>
                <option value="percentage">Percentage</option>
                <option value="threshold">Threshold</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Voting Period (hours)
              </label>
              <input
                type="number"
                value={configVotingPeriod}
                onChange={(e) => setConfigVotingPeriod(e.target.value)}
                placeholder="e.g. 48"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Min Execution Period (hours)
              </label>
              <input
                type="number"
                value={configMinExecPeriod}
                onChange={(e) => setConfigMinExecPeriod(e.target.value)}
                placeholder="e.g. 0"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Min Members
              </label>
              <input
                type="number"
                min="1"
                value={configMinMembers}
                onChange={(e) => setConfigMinMembers(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Max Members
              </label>
              <input
                type="number"
                min="1"
                value={configMaxMembers}
                onChange={(e) => setConfigMaxMembers(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Term Duration (days)
              </label>
              <input
                type="number"
                value={configTermDuration}
                onChange={(e) => setConfigTermDuration(e.target.value)}
                placeholder="e.g. 365"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {type === "create-category" && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Category Title
            </label>
            <input
              type="text"
              value={categoryTitle}
              onChange={(e) => setCategoryTitle(e.target.value)}
              placeholder="e.g. Technical, Off-Topic"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Description
            </label>
            <input
              type="text"
              value={categoryDescription}
              onChange={(e) => setCategoryDescription(e.target.value)}
              placeholder="What this category is for..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={categoryMembersOnly}
                onChange={(e) => setCategoryMembersOnly(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800"
              />
              Members only write
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={categoryAdminOnly}
                onChange={(e) => setCategoryAdminOnly(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800"
              />
              Admin only write
            </label>
          </div>
        </div>
      )}

      {/* Metadata / description — hide when update-config has no children */}
      {!(type === "update-config" && childGroups.length === 0) && <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          {type === "general" ? "Description" : "Proposal Note (optional)"}
        </label>
        <textarea
          value={metadata}
          onChange={(e) => setMetadata(e.target.value)}
          placeholder={
            type === "general"
              ? "Describe what this vote is about..."
              : "Reason for this proposal..."
          }
          rows={type === "general" ? 4 : 2}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {type === "general" && !metadata.trim() && (
          <p className="mt-1 text-xs text-yellow-500/70">
            A description is recommended for general votes.
          </p>
        )}
      </div>}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || (type === "update-config" && childGroups.length === 0)}
          className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Proposal"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function defaultMetadata(
  type: ProposalType,
  ctx: {
    inviteAddress: string;
    removeAddress: string;
    spendRecipient: string;
    spendAmount: string;
    displayDenom: string;
    categoryTitle?: string;
  }
): string {
  switch (type) {
    case "general":
      return "General signaling vote";
    case "invite":
      return `Invite ${truncateAddress(ctx.inviteAddress.trim())} as member`;
    case "remove":
      return `Remove ${truncateAddress(ctx.removeAddress)} from council`;
    case "treasury-spend":
      return `Spend ${ctx.spendAmount} ${ctx.displayDenom} to ${truncateAddress(ctx.spendRecipient.trim())}`;
    case "update-config":
      return "Update council configuration";
    case "create-category":
      return `Create forum category "${ctx.categoryTitle || ""}"`;
    default:
      return "";
  }
}
