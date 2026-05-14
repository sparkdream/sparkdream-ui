"use client";

import { useState, useEffect } from "react";
import type { Group } from "@/types/commons";
import { GovMsgTypeUrls, UpgradeMsgTypeUrls, CommonsMsgTypeUrls } from "@/lib/tx";
import { listGroups, getCurrentUpgradePlan, getGovDepositParams, type UpgradePlan } from "@/lib/api";
import { getGovModuleAddress } from "@/lib/gov";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import ParamChangeForm from "./ParamChangeForm";
import NumberInput from "@/components/NumberInput";

type ChainProposalType =
  | "general"
  | "parameter-change"
  | "council-election"
  | "software-upgrade"
  | "cancel-upgrade"
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
  { value: "cancel-upgrade", label: "Cancel Upgrade", description: "Abort a pending software upgrade" },
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
  // Chain-side deposit thresholds, in display units (SPARK):
  // - `voting` is the full gov `min_deposit` — the amount that gets the
  //   proposal straight into the voting period. We prefill the input with
  //   this so the common path is one-click.
  // - `submit` is `min_deposit_ratio × min_deposit` — the floor the chain
  //   enforces at MsgSubmitProposal time (x/gov returns ErrMinDepositTooSmall
  //   below this). We surface it and refuse to submit when the user has
  //   typed less than that, since the chain would otherwise reject the tx
  //   after the signing prompt.
  // Both are `undefined` while loading, `null` if the LCD lookup failed —
  // we don't block the form on a params query.
  const [depositFloor, setDepositFloor] = useState<
    | { submit: string; voting: string; submitMicro: bigint }
    | null
    | undefined
  >(undefined);
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

  // Cancel-upgrade: surface whichever plan is currently scheduled so users
  // know what they're cancelling (and so we can grey out submit when
  // there's nothing pending).
  const [pendingPlan, setPendingPlan] = useState<UpgradePlan | null>(null);
  const [pendingPlanLoading, setPendingPlanLoading] = useState(false);
  const [pendingPlanError, setPendingPlanError] = useState<string | null>(null);

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

  // Prefill the Initial Deposit with the chain's gov `min_deposit` so users
  // don't have to look it up. The chain enforces `min_deposit_ratio *
  // min_deposit` as the floor at submission time (x/gov MinInitial — see
  // /home/chill/go/pkg/mod/cosmossdk.io@v0.53.0/x/gov/keeper/msg_server.go),
  // and the full min_deposit is what gets the proposal straight into the
  // voting period. We pick the entry whose denom matches the chain's bond
  // denom (typically the first/only entry) and convert from micro-units.
  // Only seed when the user hasn't typed anything — we don't want to clobber
  // an in-progress edit if the LCD response arrives late.
  useEffect(() => {
    let cancelled = false;
    getGovDepositParams()
      .then((res) => {
        if (cancelled) return;
        const minDeposit = res.params?.min_deposit ?? [];
        const match =
          minDeposit.find((c) => c.denom === config.denom) ?? minDeposit[0];
        if (!match) {
          setDepositFloor(null);
          return;
        }
        const votingMicro = BigInt(match.amount);
        // Compute `min_deposit_ratio × min_deposit` in micro-units using
        // BigInt math so we match the chain's behavior exactly. The chain
        // stores Dec as a fixed-point int with 18 fractional digits; the
        // LCD serializes it as a decimal string like "0.250000000000000000".
        // x/gov's MinInitial calls Mul(...).RoundInt() — we mirror that with
        // banker's rounding via half-to-even, since round-half-up could let
        // through one micro-token below the chain's accepted floor.
        // (BigInt literal syntax (`10n`) needs ES2020+; this project still
        // targets ES2017, so use the `BigInt(...)` constructor throughout.)
        const ZERO = BigInt(0);
        const ONE = BigInt(1);
        const TWO = BigInt(2);
        const TEN_18 = BigInt(10) ** BigInt(18);
        const MICRO = BigInt(1_000_000);
        const ratioStr = res.params?.min_deposit_ratio ?? "0";
        const [wholePart, fracPart = ""] = ratioStr.split(".");
        const ratioFixed18 =
          BigInt(wholePart || "0") * TEN_18 +
          BigInt((fracPart + "0".repeat(18)).slice(0, 18));
        const product = votingMicro * ratioFixed18; // scaled by 10^18
        const quot = product / TEN_18;
        const rem = product % TEN_18;
        const half = TEN_18 / TWO;
        // Half-to-even: when remainder is exactly half, round to the even
        // integer; otherwise round half away from zero (positive only here).
        let submitMicro = quot;
        if (rem > half) submitMicro += ONE;
        else if (rem === half && quot % TWO === ONE) submitMicro += ONE;

        const toDisplay = (microUnits: bigint): string => {
          const whole = microUnits / MICRO;
          const frac = microUnits % MICRO;
          if (frac === ZERO) return whole.toString();
          // Trim trailing zeros so we render "1.5" instead of "1.500000".
          return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
        };

        const submit = toDisplay(submitMicro);
        const voting = toDisplay(votingMicro);
        setDepositFloor({ submit, voting, submitMicro });
        // Only prefill if the field is still untouched. React's useState
        // updater form lets us read the current value without depending on it
        // in the effect's deps array (which would re-fire whenever the user
        // typed).
        setDeposit((cur) => (cur === "" ? voting : cur));
      })
      .catch(() => {
        if (!cancelled) setDepositFloor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [config.denom]);

  // True when the user's typed amount is below the chain-enforced submission
  // floor (`min_deposit_ratio × min_deposit`). We compute in micro-units to
  // avoid float-precision dropping a fractionally-just-above-floor amount
  // below the threshold. Returns false while params are still loading or if
  // the LCD lookup failed — we'd rather let the user submit and surface the
  // chain's own error than block on a flaky params query.
  const depositBelowFloor = (() => {
    if (!depositFloor || !deposit) return false;
    const parsed = parseFloat(deposit);
    if (!Number.isFinite(parsed) || parsed < 0) return true;
    const enteredMicro = BigInt(Math.round(parsed * 1_000_000));
    return enteredMicro < depositFloor.submitMicro;
  })();

  // Pull the pending upgrade plan when the user picks "Cancel Upgrade".
  // We don't cache across switches — the user may have been sitting on the
  // form long enough that a new upgrade got scheduled (or executed).
  useEffect(() => {
    if (type !== "cancel-upgrade") return;
    let cancelled = false;
    setPendingPlanLoading(true);
    setPendingPlanError(null);
    getCurrentUpgradePlan()
      .then((plan) => {
        if (!cancelled) setPendingPlan(plan);
      })
      .catch((err) => {
        if (!cancelled)
          setPendingPlanError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setPendingPlanLoading(false);
      });
    return () => { cancelled = true; };
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
    // Don't even open the signing prompt for a deposit the chain will
    // immediately reject. The chain enforces this server-side, so this is a
    // UX shortcut rather than the source of truth.
    if (depositBelowFloor && depositFloor) {
      setError(
        `Initial deposit must be at least ${depositFloor.submit} ${config.displayDenom} (min_deposit_ratio × min_deposit) to submit.`
      );
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
      } else if (type === "cancel-upgrade") {
        // Refuse to submit a guaranteed-no-op proposal. We only block when the
        // LCD definitively answered "no plan"; transport errors still let the
        // user through so a flaky endpoint doesn't strand emergency cancels.
        if (pendingPlan === null && !pendingPlanLoading && !pendingPlanError) {
          throw new Error(
            "No software upgrade is currently scheduled — nothing to cancel."
          );
        }
        const { MsgCancelUpgrade } = await import(
          "cosmjs-types/cosmos/upgrade/v1beta1/tx"
        );
        const govModuleAddress = await getGovModuleAddress();
        govMessages.push({
          typeUrl: UpgradeMsgTypeUrls.CancelUpgrade,
          value: MsgCancelUpgrade.encode(
            MsgCancelUpgrade.fromPartial({ authority: govModuleAddress })
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

      // SDK gov v1 dropped TextProposal: a proposal with no inner messages
      // must carry non-empty metadata or msg_server rejects it with
      // "either metadata or Msgs length must be non-nil". When the chain
      // can JSON-parse the metadata, it also enforces that the embedded
      // title/summary match the proposal's, so emit a blob that satisfies
      // both checks for the signaling-only "general" case.
      const proposalTitle = title.trim();
      const proposalSummary = summary.trim() || proposalTitle;
      const metadata =
        govMessages.length === 0
          ? JSON.stringify({ title: proposalTitle, summary: proposalSummary })
          : "";

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
            metadata,
            title: proposalTitle,
            summary: proposalSummary,
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

  // Gov module address now lives in @/lib/gov so the futarchy
  // CancelMarketProposalModal and any future proposal flows can share it.

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl sd-hull-tile p-5"
    >
      <h3 className="text-lg font-semibold text-white">
        New Chain Proposal
      </h3>

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
          <NumberInput
            step="any"
            min={depositFloor?.submit ?? "0"}
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder="0.00"
            className={`w-full rounded-lg border bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 ${
              depositBelowFloor
                ? "border-red-700 focus:border-red-500 focus:ring-red-500"
                : "border-zinc-700 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
          />
          {depositFloor ? (
            <p className="mt-1 text-xs text-zinc-500">
              The chain accepts deposits as low as{" "}
              <button
                type="button"
                onClick={() => setDeposit(depositFloor.submit)}
                className="font-mono text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                title="Set to min_deposit_ratio × min_deposit (the floor x/gov enforces at MsgSubmitProposal)"
              >
                {depositFloor.submit} {config.displayDenom}
              </button>{" "}
              (min_deposit_ratio × min_deposit). The proposal stays in the
              deposit period until total deposits reach{" "}
              <button
                type="button"
                onClick={() => setDeposit(depositFloor.voting)}
                className="font-mono text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline"
                title="Set to the full gov min_deposit (skips deposit period)"
              >
                {depositFloor.voting} {config.displayDenom}
              </button>
              , when voting starts.
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">
              Proposals need a minimum deposit to enter the voting period.
            </p>
          )}
          {depositBelowFloor && depositFloor && (
            <p className="mt-1 text-xs text-red-400">
              Below the chain&apos;s submission floor — x/gov will reject this tx
              with <span className="font-mono">ErrMinDepositTooSmall</span>.
              Raise to at least {depositFloor.submit} {config.displayDenom}.
            </p>
          )}
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
              className="sd-select w-full"
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
            <NumberInput
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

      {/* Cancel upgrade — no inputs; x/upgrade clears whichever plan is
          currently pending when this proposal passes. We pull the live plan
          so the user knows what they're cancelling, and gate submit when
          nothing's scheduled (the chain would still accept the proposal,
          but it'd be a guaranteed no-op). */}
      {type === "cancel-upgrade" && (
        <div className="space-y-2 rounded-lg border border-zinc-700/50 bg-zinc-800/20 p-4 text-xs text-zinc-400">
          <h4 className="text-sm font-medium text-zinc-300">Cancel Upgrade</h4>
          {pendingPlanLoading && <p>Looking up the pending upgrade…</p>}
          {pendingPlanError && (
            <p className="text-amber-400">
              Couldn&apos;t fetch the pending plan: {pendingPlanError}. You can
              still submit, but verify off-chain that an upgrade is actually
              scheduled.
            </p>
          )}
          {!pendingPlanLoading && !pendingPlanError && pendingPlan && (
            <div className="space-y-1 text-zinc-300">
              <p>The chain currently has this upgrade scheduled:</p>
              <ul className="list-disc space-y-0.5 pl-5 font-mono text-[11px]">
                <li>name: {pendingPlan.name || "(empty)"}</li>
                <li>height: {pendingPlan.height}</li>
                {pendingPlan.info && <li>info: {pendingPlan.info}</li>}
              </ul>
              <p className="text-zinc-400">
                Passing this proposal clears that plan before it executes.
              </p>
            </div>
          )}
          {!pendingPlanLoading && !pendingPlanError && !pendingPlan && (
            <p className="text-amber-400">
              No software upgrade is currently scheduled — there&apos;s nothing
              to cancel.
            </p>
          )}
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
                className="sd-select w-full"
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
              <NumberInput
                value={councilVotingPeriod}
                onChange={(e) => setCouncilVotingPeriod(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Min Exec Period (hrs)
              </label>
              <NumberInput
                value={councilMinExecPeriod}
                onChange={(e) => setCouncilMinExecPeriod(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Min Members
              </label>
              <NumberInput
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
              <NumberInput
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
              <NumberInput
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
          disabled={submitting || depositBelowFloor}
          title={
            depositBelowFloor && depositFloor
              ? `Initial deposit must be at least ${depositFloor.submit} ${config.displayDenom}`
              : undefined
          }
          className="sd-btn sd-btn-primary"
        >
          {submitting ? "Submitting..." : "Submit Proposal"}
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

function MemberListEditor({
  members,
  onAdd,
  onRemove,
  onUpdate,
}: {
  members: { address: string; weight: string }[];
  // Whole-list setter is accepted by callers (setElectionMembers /
  // setCouncilMembers) but not used internally — row-level edits go
  // through onAdd/onRemove/onUpdate. Kept on the interface so existing
  // callers don't have to change.
  onChange?: (v: { address: string; weight: string }[]) => void;
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
            <NumberInput
              min="1"
              value={m.weight}
              onChange={(e) => onUpdate(i, "weight", e.target.value)}
              wrapperClassName="w-16"
              className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-1.5 text-center text-xs text-white focus:border-indigo-500 focus:outline-none"
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
