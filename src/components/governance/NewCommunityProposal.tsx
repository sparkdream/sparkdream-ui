"use client";

import { useState, useEffect } from "react";
import type { Category, Group, Member } from "@/types/commons";
import { CommonsMsgTypeUrls, ForumMsgTypeUrls } from "@/lib/tx";
import { getCouncilMembers, getPolicyPermissions, listCategories, listGroups } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { truncateAddress } from "@/lib/utils";
import { canSpendTreasury } from "@/lib/commons";
import NumberInput from "@/components/NumberInput";

export type ProposalType =
  | "general"
  | "invite"
  | "remove"
  | "treasury-spend"
  | "update-config"
  | "create-category"
  | "delete-category"
  | "unhide-post";

const PROPOSAL_TYPES: { value: ProposalType; label: string; description: string }[] = [
  { value: "general", label: "General vote", description: "Signaling vote with no executable action" },
  { value: "treasury-spend", label: "Treasury spend", description: "Propose sending funds from the council treasury" },
  { value: "invite", label: "Invite member", description: "Propose adding a new council member" },
  { value: "remove", label: "Remove member", description: "Propose removing a council member" },
  { value: "update-config", label: "Update config", description: "Propose changing a child committee's settings" },
  { value: "create-category", label: "Create Swarm category", description: "Propose creating a new Swarm category" },
  { value: "delete-category", label: "Delete Swarm category", description: "Propose removing an empty Swarm category" },
  { value: "unhide-post", label: "Unhide Swarm post", description: "Council override of a sentinel hide past the self-correct window" },
];

// Inner message types each proposal kind would broadcast — used to filter the
// picker against the group's PolicyPermissions.allowed_messages. The chain
// rejects a proposal whose inner messages aren't all in that list with
// `msg %s not allowed for policy %s` (see x/commons/keeper/msg_server_proposals.go).
// `general` carries no executable message so it's always available.
const REQUIRED_MESSAGES: Record<ProposalType, string[]> = {
  "general": [],
  "treasury-spend": [CommonsMsgTypeUrls.SpendFromCommons],
  "invite": [CommonsMsgTypeUrls.UpdateGroupMembers],
  "remove": [CommonsMsgTypeUrls.UpdateGroupMembers],
  "update-config": [CommonsMsgTypeUrls.UpdateGroupConfig],
  "create-category": [CommonsMsgTypeUrls.CreateCategory],
  "delete-category": [CommonsMsgTypeUrls.DeleteCategory],
  "unhide-post": [ForumMsgTypeUrls.UnhidePost],
};

interface NewCommunityProposalProps {
  group: Group;
  members: Member[];
  onClose: () => void;
  onSuccess: () => void;
  initialType?: ProposalType;
  /** Pre-fill the unhide-post form when the proposal type defaults to "unhide-post". */
  initialPostId?: string;
}

export default function NewCommunityProposal({
  group,
  members,
  onClose,
  onSuccess,
  initialType,
  initialPostId,
}: NewCommunityProposalProps) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const canSpend = canSpendTreasury(group);
  // Reject a deep-linked initialType="treasury-spend" for non-spending groups
  // — otherwise the picker would hide the option but the spend form would
  // still render for the seeded `type`.
  const safeInitialType: ProposalType | undefined =
    initialType === "treasury-spend" && !canSpend ? "general" : initialType;
  const [type, setType] = useState<ProposalType>(safeInitialType ?? "general");
  // The group's chain-side AllowedMessages — `null` while loading so the
  // picker doesn't briefly hide options before settling.
  const [allowedMessages, setAllowedMessages] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPolicyPermissions(group.policy_address)
      .then((res) => {
        if (!cancelled) setAllowedMessages(res.policy_permissions?.allowed_messages ?? []);
      })
      .catch(() => {
        // Treat a missing/erroring permissions record as no executables
        // allowed — the chain would reject anyway.
        if (!cancelled) setAllowedMessages([]);
      });
    return () => { cancelled = true; };
  }, [group.policy_address]);
  const [metadata, setMetadata] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Target group for member changes — own group, or the group this committee
  // is the electoral authority for. The chain (msg_server_update_group_members)
  // accepts the signer when it equals the target's parent OR its
  // `electoral_policy_address`; `parent_policy_address` would be the right
  // pointer for Tech/Eco governance committees (which sit directly under their
  // councils) but is wrong for the Commons Governance Committee, whose parent
  // is the Supervisory Board — Commons Council is reached purely via electoral
  // delegation (`Commons Council.electoral_policy_address = commonsGovPolicy`
  // in the chain's genesis bootstrap). Resolving by electoral relationship
  // works uniformly for all three governance committees.
  const [electoralFor, setElectoralFor] = useState<Group | null>(null);
  const [memberTarget, setMemberTarget] = useState<"self" | "managed">("self");
  // Auto-flip to "managed" once we learn this group is an electoral authority,
  // but only the first time — don't fight a user who clicked back to "self".
  const [defaultedToManaged, setDefaultedToManaged] = useState(false);
  useEffect(() => {
    if (electoralFor && !defaultedToManaged) {
      setMemberTarget("managed");
      setDefaultedToManaged(true);
    }
  }, [electoralFor, defaultedToManaged]);
  const targetPolicyAddress = memberTarget === "managed" && electoralFor
    ? electoralFor.policy_address
    : group.policy_address;

  // Invite fields
  const [inviteAddress, setInviteAddress] = useState("");
  const [inviteWeight, setInviteWeight] = useState("1");

  // Remove fields
  const [removeAddress, setRemoveAddress] = useState("");
  // Members of the managed (electoral) target group, lazily loaded so the
  // "Member to Remove" picker lists *that* council's members instead of the
  // submitting committee's (the chain stores members per group in a separate
  // `(councilName, address)` collection). Falls back to the prop `members`
  // when the picker is in "self" mode.
  const [targetMembers, setTargetMembers] = useState<Member[]>([]);
  useEffect(() => {
    if (memberTarget !== "managed" || !electoralFor) return;
    let cancelled = false;
    getCouncilMembers(electoralFor.index)
      .then((res) => {
        if (!cancelled) setTargetMembers(res.members || []);
      })
      .catch(() => {
        if (!cancelled) setTargetMembers([]);
      });
    return () => { cancelled = true; };
  }, [memberTarget, electoralFor]);
  // Reset the selection when the user flips the target so we never submit
  // a stale address that belongs to the other group.
  useEffect(() => {
    setRemoveAddress("");
  }, [memberTarget]);
  const displayedMembers =
    memberTarget === "managed" && electoralFor ? targetMembers : members;

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
  const [categoryMembersOnly, setCategoryMembersOnly] = useState(true);
  const [categoryAdminOnly, setCategoryAdminOnly] = useState(false);

  // Delete category fields
  const [existingCategories, setExistingCategories] = useState<Category[]>([]);
  const [deleteCategoryId, setDeleteCategoryId] = useState("");

  // Unhide post fields. Pre-filled from `initialPostId` when the parent
  // governance page is reached via the SentinelPanel deep-link
  // (`/governance?...&action=unhide-post&post_id=N`).
  const [unhidePostId, setUnhidePostId] = useState(initialPostId ?? "");

  // Lazily load existing categories when the delete-category form is shown.
  useEffect(() => {
    if (type !== "delete-category" || existingCategories.length > 0) return;
    let cancelled = false;
    listCategories()
      .then((res) => {
        if (cancelled) return;
        const cats = res.category || [];
        setExistingCategories(cats);
        if (cats.length > 0) setDeleteCategoryId((prev) => prev || cats[0].category_id);
      })
      .catch(() => { /* leave list empty; submit will surface the error */ });
    return () => { cancelled = true; };
  }, [type, existingCategories.length]);

  // Fetch sibling groups once and derive two relationships from the result:
  //  - childGroups: groups this one oversees (parent_policy_address points
  //    here, or it's our designated electoral committee) — drives the
  //    update-config picker.
  //  - electoralFor: the group THIS one is the electoral authority for
  //    (i.e. some group's `electoral_policy_address` equals our policy
  //    address) — drives the invite/remove "managed" target toggle.
  //    The `g.policy_address !== group.policy_address` filter skips the
  //    self-electoral loop wired into the genesis bootstrap for the Commons
  //    Operations Committee (`SetElectoralDelegation("Commons Operations
  //    Committee", commOpsPolicy)`, which lets it manage its own members);
  //    that's a single-target case where the toggle would just point at
  //    `group` from both buttons.
  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      try {
        const res = await listGroups();
        const groups = res.group || [];
        const children = groups.filter(
          (g) =>
            g.policy_address !== group.policy_address &&
            (g.parent_policy_address === group.policy_address ||
             g.policy_address === group.electoral_policy_address)
        );
        const managed = groups.find(
          (g) =>
            g.electoral_policy_address === group.policy_address &&
            g.policy_address !== group.policy_address
        ) ?? null;
        if (!cancelled) {
          setChildGroups(children);
          if (children.length > 0) setConfigTargetGroup((prev) => prev || children[0].index);
          setElectoralFor(managed);
        }
      } catch {
        // ignore
      }
    }
    loadGroups();
    return () => { cancelled = true; };
  }, [group.policy_address, group.electoral_policy_address]);

  // Hide proposal types whose inner message the group's policy isn't
  // authorized for (Technical groups have no MsgCreateCategory, governance
  // committees have no MsgSpendFromCommons, etc.). While permissions are
  // still loading we show every option to avoid a flash. update-config is
  // additionally hidden when there's nothing to configure.
  const visibleProposalTypes = PROPOSAL_TYPES.filter((pt) => {
    if (pt.value === "treasury-spend" && !canSpend) return false;
    if (pt.value === "update-config" && childGroups.length === 0) return false;
    if (allowedMessages === null) return true;
    const required = REQUIRED_MESSAGES[pt.value];
    return required.every((m) => allowedMessages.includes(m));
  });
  // If the currently-picked type got filtered out (e.g. a deep link landed on
  // unhide-post for a group that can't unhide), drop back to the always-on
  // general signaling vote rather than letting the form render a non-submittable
  // body.
  useEffect(() => {
    if (allowedMessages === null) return;
    if (!visibleProposalTypes.find((pt) => pt.value === type)) {
      setType("general");
    }
  }, [allowedMessages, visibleProposalTypes, type]);

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
      } else if (type === "delete-category") {
        if (!deleteCategoryId) throw new Error("Pick a category to delete");
        const { MsgDeleteCategory } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
        );
        innerMessages.push({
          typeUrl: CommonsMsgTypeUrls.DeleteCategory,
          value: MsgDeleteCategory.encode(
            MsgDeleteCategory.fromPartial({
              creator: group.policy_address,
              categoryId: BigInt(deleteCategoryId),
            })
          ).finish(),
        });
      } else if (type === "unhide-post") {
        const trimmed = unhidePostId.trim();
        if (!trimmed) throw new Error("Post ID is required");
        if (!/^\d+$/.test(trimmed)) throw new Error("Post ID must be a positive integer");
        const { MsgUnhidePost } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx"
        );
        innerMessages.push({
          typeUrl: ForumMsgTypeUrls.UnhidePost,
          value: MsgUnhidePost.encode(
            MsgUnhidePost.fromPartial({
              creator: group.policy_address,
              postId: BigInt(trimmed),
            })
          ).finish(),
        });
      }
      // "general" has no inner messages — signaling vote only

      const deletedCategoryTitle =
        existingCategories.find((c) => c.category_id === deleteCategoryId)?.title ?? "";
      const proposalMetadata =
        metadata.trim() ||
        defaultMetadata(type, {
          inviteAddress,
          removeAddress,
          spendRecipient,
          spendAmount,
          displayDenom: config.displayDenom,
          categoryTitle,
          deletedCategoryTitle,
          deletedCategoryId: deleteCategoryId,
          unhidePostId: unhidePostId.trim(),
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
      className="space-y-5 rounded-xl sd-hull-tile p-5"
    >
      <h3 className="text-lg font-semibold text-white">New proposal</h3>

      {/* Proposal type selector */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          Proposal type
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleProposalTypes.map((pt) => (
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
      {electoralFor && (type === "invite" || type === "remove") && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Target group
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMemberTarget("managed")}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                memberTarget === "managed"
                  ? "border-indigo-500/50 bg-indigo-600/15 text-indigo-400"
                  : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              <div className="font-medium">{electoralFor.index}</div>
              <div className="mt-0.5 text-xs text-zinc-500">Manage members of the main council</div>
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
              <div className="font-medium">This committee</div>
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
              Address to invite
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
              Voting weight
            </label>
            <NumberInput
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
            Member to remove
          </label>
          <select
            value={removeAddress}
            onChange={(e) => setRemoveAddress(e.target.value)}
            className="sd-select w-full"
          >
            <option value="">Select a member...</option>
            {displayedMembers.map((m) => (
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
              Recipient address
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
            <NumberInput
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
              Target committee
            </label>
            <select
              value={configTargetGroup}
              onChange={(e) => setConfigTargetGroup(e.target.value)}
              className="sd-select w-full"
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
                Vote threshold
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
                Policy type
              </label>
              <select
                value={configPolicyType}
                onChange={(e) => setConfigPolicyType(e.target.value)}
                className="sd-select w-full"
              >
                <option value="">No change</option>
                <option value="percentage">Percentage</option>
                <option value="threshold">Threshold</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Voting period (hours)
              </label>
              <NumberInput
                value={configVotingPeriod}
                onChange={(e) => setConfigVotingPeriod(e.target.value)}
                placeholder="e.g. 48"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Min execution period (hours)
              </label>
              <NumberInput
                value={configMinExecPeriod}
                onChange={(e) => setConfigMinExecPeriod(e.target.value)}
                placeholder="e.g. 0"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Min members
              </label>
              <NumberInput
                min="1"
                value={configMinMembers}
                onChange={(e) => setConfigMinMembers(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Max members
              </label>
              <NumberInput
                min="1"
                value={configMaxMembers}
                onChange={(e) => setConfigMaxMembers(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Term duration (days)
              </label>
              <NumberInput
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
              Category title
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

      {type === "delete-category" && (
        <div className="space-y-3">
          {existingCategories.length === 0 ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-3 text-sm text-zinc-500">
              No categories exist yet.
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                Category to delete
              </label>
              <select
                value={deleteCategoryId}
                onChange={(e) => setDeleteCategoryId(e.target.value)}
                className="sd-select w-full"
              >
                {existingCategories.map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    #{c.category_id} — {c.title}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500">
                The chain refuses to delete a category that still has forum posts. Move or
                archive any remaining threads first.
              </p>
            </div>
          )}
        </div>
      )}

      {type === "unhide-post" && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-300">
              Post ID to unhide
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={unhidePostId}
              onChange={(e) => setUnhidePostId(e.target.value)}
              placeholder="e.g. 42"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 font-mono text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Council override of a sentinel hide. Use this for hides past the
              sentinel self-correct window. The chain refuses if the post&apos;s
              category was deleted while it was hidden.
            </p>
          </div>
        </div>
      )}

      {/* Metadata / description — hide when update-config has no children */}
      {!(type === "update-config" && childGroups.length === 0) && <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
          {type === "general" ? "Description" : "Proposal note (optional)"}
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
          disabled={
            submitting ||
            (type === "update-config" && childGroups.length === 0) ||
            (type === "delete-category" && existingCategories.length === 0) ||
            (type === "unhide-post" && !unhidePostId.trim())
          }
          className="sd-btn sd-btn-primary"
        >
          {submitting ? "Submitting..." : "Submit proposal"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="sd-btn sd-btn-secondary"
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
    deletedCategoryTitle?: string;
    deletedCategoryId?: string;
    unhidePostId?: string;
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
      return `Create Swarm category "${ctx.categoryTitle || ""}"`;
    case "delete-category":
      return `Delete Swarm category "${ctx.deletedCategoryTitle || ""}" (#${ctx.deletedCategoryId || "?"})`;
    case "unhide-post":
      return `Council override: unhide Swarm post #${ctx.unhidePostId || "?"}`;
    default:
      return "";
  }
}
