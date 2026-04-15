"use client";

import { useState, useEffect } from "react";
import type { Group } from "@/types/commons";
import { GovMsgTypeUrls, UpgradeMsgTypeUrls, CommonsMsgTypeUrls } from "@/lib/tx";
import { listGroups } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import ParamChangeForm from "./ParamChangeForm";

type ChainProposalType =
  | "general"
  | "parameter-change"
  | "council-election"
  | "software-upgrade"
  | "register-council";

const CHAIN_PROPOSAL_TYPES: {
  value: ChainProposalType;
  label: string;
  description: string;
}[] = [
  { value: "general", label: "General Vote", description: "Signaling proposal — no executable action" },
  { value: "parameter-change", label: "Parameter Change", description: "Update a module's parameters" },
  { value: "council-election", label: "Council Election", description: "Renew a council term with new membership" },
  { value: "software-upgrade", label: "Software Upgrade", description: "Schedule a chain binary upgrade" },
  { value: "register-council", label: "Register Council", description: "Create a new council/committee" },
];

interface NewChainProposalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function NewChainProposal({
  onClose,
  onSuccess,
}: NewChainProposalProps) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const [type, setType] = useState<ChainProposalType>("general");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [deposit, setDeposit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Council election fields
  const [groups, setGroups] = useState<Group[]>([]);
  const [electionGroup, setElectionGroup] = useState("");
  const [electionMembers, setElectionMembers] = useState<
    { address: string; weight: string }[]
  >([{ address: "", weight: "1" }]);

  // Parameter change
  const [paramChangeMsg, setParamChangeMsg] = useState<{
    typeUrl: string;
    value: Uint8Array;
  } | null>(null);

  // Software upgrade fields
  const [upgradeName, setUpgradeName] = useState("");
  const [upgradeHeight, setUpgradeHeight] = useState("");
  const [upgradeInfo, setUpgradeInfo] = useState("");

  // Register council fields
  const [councilName, setCouncilName] = useState("");
  const [councilDescription, setCouncilDescription] = useState("");
  const [councilMembers, setCouncilMembers] = useState<
    { address: string; weight: string }[]
  >([{ address: "", weight: "1" }]);
  const [councilVoteThreshold, setCouncilVoteThreshold] = useState("0.51");
  const [councilPolicyType, setCouncilPolicyType] = useState("percentage");
  const [councilVotingPeriod, setCouncilVotingPeriod] = useState("48");
  const [councilMinExecPeriod, setCouncilMinExecPeriod] = useState("0");
  const [councilMinMembers, setCouncilMinMembers] = useState("1");
  const [councilMaxMembers, setCouncilMaxMembers] = useState("20");
  const [councilTermDuration, setCouncilTermDuration] = useState("365");

  useEffect(() => {
    if (type === "council-election") {
      listGroups()
        .then((res) => setGroups(res.group || []))
        .catch(() => {});
    }
  }, [type]);

  const addMemberRow = (
    list: { address: string; weight: string }[],
    setter: (v: { address: string; weight: string }[]) => void
  ) => {
    setter([...list, { address: "", weight: "1" }]);
  };

  const removeMemberRow = (
    list: { address: string; weight: string }[],
    setter: (v: { address: string; weight: string }[]) => void,
    idx: number
  ) => {
    setter(list.filter((_, i) => i !== idx));
  };

  const updateMemberRow = (
    list: { address: string; weight: string }[],
    setter: (v: { address: string; weight: string }[]) => void,
    idx: number,
    field: "address" | "weight",
    value: string
  ) => {
    const updated = [...list];
    updated[idx] = { ...updated[idx], [field]: value };
    setter(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      // Build the inner messages for the gov v1 proposal
      const govMessages: { typeUrl: string; value: Uint8Array }[] = [];

      if (type === "parameter-change") {
        if (!paramChangeMsg) throw new Error("Select a module and configure parameters");
        govMessages.push(paramChangeMsg);
      } else if (type === "council-election") {
        if (!electionGroup) throw new Error("Select a council");
        const validMembers = electionMembers.filter((m) => m.address.trim());
        if (validMembers.length === 0)
          throw new Error("At least one member is required");

        const { MsgRenewGroup } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
        );
        // For gov proposals, authority is the gov module address
        // The chain derives this; we use a placeholder that the gov module fills
        const govModuleAddress = await getGovModuleAddress();
        govMessages.push({
          typeUrl: CommonsMsgTypeUrls.RenewGroup,
          value: MsgRenewGroup.encode(
            MsgRenewGroup.fromPartial({
              authority: govModuleAddress,
              groupName: electionGroup,
              newMembers: validMembers.map((m) => m.address.trim()),
              newMemberWeights: validMembers.map((m) => m.weight || "1"),
            })
          ).finish(),
        });
      } else if (type === "software-upgrade") {
        if (!upgradeName.trim()) throw new Error("Upgrade name is required");
        if (!upgradeHeight || parseInt(upgradeHeight) <= 0)
          throw new Error("Valid upgrade height is required");

        const { MsgSoftwareUpgrade } = await import(
          "cosmjs-types/cosmos/upgrade/v1beta1/tx"
        );
        const govModuleAddress = await getGovModuleAddress();
        govMessages.push({
          typeUrl: UpgradeMsgTypeUrls.SoftwareUpgrade,
          value: MsgSoftwareUpgrade.encode(
            MsgSoftwareUpgrade.fromPartial({
              authority: govModuleAddress,
              plan: {
                name: upgradeName.trim(),
                height: BigInt(upgradeHeight),
                info: upgradeInfo.trim(),
              },
            })
          ).finish(),
        });
      } else if (type === "register-council") {
        if (!councilName.trim()) throw new Error("Council name is required");
        const validMembers = councilMembers.filter((m) => m.address.trim());
        if (validMembers.length === 0)
          throw new Error("At least one member is required");

        const { MsgRegisterGroup } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx"
        );
        const govModuleAddress = await getGovModuleAddress();
        govMessages.push({
          typeUrl: CommonsMsgTypeUrls.RegisterGroup,
          value: MsgRegisterGroup.encode(
            MsgRegisterGroup.fromPartial({
              authority: govModuleAddress,
              name: councilName.trim(),
              description: councilDescription.trim(),
              members: validMembers.map((m) => m.address.trim()),
              memberWeights: validMembers.map((m) => m.weight || "1"),
              fundingWeight: BigInt(0),
              maxSpendPerEpoch: "0",
              updateCooldown: BigInt(0),
              minMembers: BigInt(councilMinMembers || "1"),
              maxMembers: BigInt(councilMaxMembers || "20"),
              termDuration: BigInt(
                parseInt(councilTermDuration || "365") * 86400
              ),
              activationTime: BigInt(0),
              votingPeriod: BigInt(
                parseInt(councilVotingPeriod || "48") * 3600
              ),
              minExecutionPeriod: BigInt(
                parseInt(councilMinExecPeriod || "0") * 3600
              ),
              futarchyEnabled: false,
              voteThreshold: councilVoteThreshold || "0.51",
              policyType: councilPolicyType || "percentage",
              allowedMessages: [],
              electoralPolicyAddress: "",
            })
          ).finish(),
        });
      }
      // "general" has no inner messages

      const microDeposit = deposit
        ? (parseFloat(deposit) * 1_000_000).toFixed(0)
        : "0";

      await signAndBroadcast([
        {
          typeUrl: GovMsgTypeUrls.SubmitProposal,
          value: {
            messages: govMessages,
            initialDeposit:
              microDeposit !== "0"
                ? [{ denom: config.denom, amount: microDeposit }]
                : [],
            proposer: address,
            metadata: "",
            title: title.trim(),
            summary: summary.trim() || title.trim(),
            expedited: false,
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

  // Derive the gov module address from chain bech32 prefix
  // The gov module address is cosmos-sdk's autogenerated module account
  async function getGovModuleAddress(): Promise<string> {
    try {
      const res = await fetch(
        `/api/lcd/cosmos/auth/v1beta1/module_accounts/gov`
      );
      const data = await res.json();
      return data.account?.base_account?.address || "";
    } catch {
      // Fallback: return empty and let the chain fill it
      return "";
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          New Chain Proposal
        </h3>
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
          {CHAIN_PROPOSAL_TYPES.map((pt) => (
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
              <div className="mt-0.5 text-xs text-zinc-500">
                {pt.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Common fields */}
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Proposal title..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Summary
          </label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Describe the proposal..."
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-300">
            Initial Deposit ({config.displayDenom})
          </label>
          <input
            type="number"
            step="any"
            min="0"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Proposals need a minimum deposit to enter the voting period.
          </p>
        </div>
      </div>

      {/* Parameter change fields */}
      {type === "parameter-change" && (
        <ParamChangeForm onMessage={setParamChangeMsg} />
      )}

      {/* Council election fields */}
      {type === "council-election" && (
        <div className="space-y-3 rounded-lg border border-zinc-700/50 bg-zinc-800/20 p-4">
          <h4 className="text-sm font-medium text-zinc-300">
            Council Election
          </h4>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Council
            </label>
            <select
              value={electionGroup}
              onChange={(e) => setElectionGroup(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Select a council...</option>
              {groups.map((g) => (
                <option key={g.index} value={g.index}>
                  {g.index}
                </option>
              ))}
            </select>
          </div>
          <MemberListEditor
            members={electionMembers}
            onChange={setElectionMembers}
            onAdd={() => addMemberRow(electionMembers, setElectionMembers)}
            onRemove={(i) =>
              removeMemberRow(electionMembers, setElectionMembers, i)
            }
            onUpdate={(i, f, v) =>
              updateMemberRow(electionMembers, setElectionMembers, i, f, v)
            }
          />
        </div>
      )}

      {/* Software upgrade fields */}
      {type === "software-upgrade" && (
        <div className="space-y-3 rounded-lg border border-zinc-700/50 bg-zinc-800/20 p-4">
          <h4 className="text-sm font-medium text-zinc-300">
            Software Upgrade
          </h4>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Upgrade Name
            </label>
            <input
              type="text"
              value={upgradeName}
              onChange={(e) => setUpgradeName(e.target.value)}
              placeholder="e.g. v2.0.0"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Upgrade Height
            </label>
            <input
              type="number"
              min="1"
              value={upgradeHeight}
              onChange={(e) => setUpgradeHeight(e.target.value)}
              placeholder="Block height"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Info (optional)
            </label>
            <textarea
              value={upgradeInfo}
              onChange={(e) => setUpgradeInfo(e.target.value)}
              placeholder="Binary download URL or JSON info..."
              rows={2}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Register council fields */}
      {type === "register-council" && (
        <div className="space-y-3 rounded-lg border border-zinc-700/50 bg-zinc-800/20 p-4">
          <h4 className="text-sm font-medium text-zinc-300">
            Register New Council
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Council Name
              </label>
              <input
                type="text"
                value={councilName}
                onChange={(e) => setCouncilName(e.target.value)}
                placeholder="e.g. grants"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Description
              </label>
              <input
                type="text"
                value={councilDescription}
                onChange={(e) => setCouncilDescription(e.target.value)}
                placeholder="What this council does"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <MemberListEditor
            members={councilMembers}
            onChange={setCouncilMembers}
            onAdd={() => addMemberRow(councilMembers, setCouncilMembers)}
            onRemove={(i) =>
              removeMemberRow(councilMembers, setCouncilMembers, i)
            }
            onUpdate={(i, f, v) =>
              updateMemberRow(councilMembers, setCouncilMembers, i, f, v)
            }
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Policy Type
              </label>
              <select
                value={councilPolicyType}
                onChange={(e) => setCouncilPolicyType(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="percentage">Percentage</option>
                <option value="threshold">Threshold</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Vote Threshold
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={councilVoteThreshold}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setCouncilVoteThreshold(v);
                }}
                placeholder="0.51"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Voting Period (hrs)
              </label>
              <input
                type="number"
                value={councilVotingPeriod}
                onChange={(e) => setCouncilVotingPeriod(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Min Exec Period (hrs)
              </label>
              <input
                type="number"
                value={councilMinExecPeriod}
                onChange={(e) => setCouncilMinExecPeriod(e.target.value)}
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
                value={councilMinMembers}
                onChange={(e) => setCouncilMinMembers(e.target.value)}
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
                value={councilMaxMembers}
                onChange={(e) => setCouncilMaxMembers(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Term Duration (days)
              </label>
              <input
                type="number"
                value={councilTermDuration}
                onChange={(e) => setCouncilTermDuration(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
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

function MemberListEditor({
  members,
  onChange,
  onAdd,
  onRemove,
  onUpdate,
}: {
  members: { address: string; weight: string }[];
  onChange: (v: { address: string; weight: string }[]) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, field: "address" | "weight", value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">
        Members
      </label>
      <div className="space-y-2">
        {members.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={m.address}
              onChange={(e) => onUpdate(i, "address", e.target.value)}
              placeholder="sprkdrm1..."
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
            />
            <input
              type="number"
              min="1"
              value={m.weight}
              onChange={(e) => onUpdate(i, "weight", e.target.value)}
              className="w-16 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-center text-xs text-white focus:border-indigo-500 focus:outline-none"
              title="Weight"
            />
            {members.length > 1 && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="rounded p-1 text-zinc-500 hover:text-red-400"
                title="Remove"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
      >
        + Add member
      </button>
    </div>
  );
}
