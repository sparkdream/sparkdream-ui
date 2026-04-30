"use client";

import { useEffect, useState } from "react";
import { getModuleParams } from "@/lib/api";
import { useChainConfig } from "@/contexts/ChainConfigContext";

// ── Module definitions ──────────────────────────────────────────────

type FieldKind = "string" | "number" | "bigint" | "boolean" | "duration" | "coins" | "coin" | "dec-bytes";

interface FieldDef {
  /** Proto camelCase field name */
  key: string;
  /** LCD snake_case field name */
  apiKey: string;
  label: string;
  kind: FieldKind;
  /** For duration: display unit */
  unit?: string;
  /** For duration: divisor to get display unit from seconds */
  unitDivisor?: number;
  hint?: string;
}

interface ModuleDef {
  label: string;
  paramPath: string;
  /** Response JSON key that contains the params object */
  responseKey: string;
  typeUrl: string;
  fields: FieldDef[];
}

const MODULES: Record<string, ModuleDef> = {
  gov: {
    label: "Governance",
    paramPath: "/cosmos/gov/v1/params/voting",
    responseKey: "params",
    typeUrl: "/cosmos.gov.v1.MsgUpdateParams",
    fields: [
      { key: "quorum", apiKey: "quorum", label: "Quorum", kind: "string", hint: "Fraction of total staked that must vote (e.g. 0.334)" },
      { key: "threshold", apiKey: "threshold", label: "Threshold", kind: "string", hint: "Fraction of Yes votes to pass (e.g. 0.5)" },
      { key: "vetoThreshold", apiKey: "veto_threshold", label: "Veto Threshold", kind: "string", hint: "Fraction of NoWithVeto votes to veto (e.g. 0.334)" },
      { key: "votingPeriod", apiKey: "voting_period", label: "Voting Period", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { key: "maxDepositPeriod", apiKey: "max_deposit_period", label: "Max Deposit Period", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { key: "minDeposit", apiKey: "min_deposit", label: "Min Deposit", kind: "coins" },
      { key: "minInitialDepositRatio", apiKey: "min_initial_deposit_ratio", label: "Min Initial Deposit Ratio", kind: "string" },
      { key: "expeditedThreshold", apiKey: "expedited_threshold", label: "Expedited Threshold", kind: "string" },
      { key: "expeditedVotingPeriod", apiKey: "expedited_voting_period", label: "Expedited Voting Period", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { key: "burnVoteQuorum", apiKey: "burn_vote_quorum", label: "Burn on Quorum Failure", kind: "boolean" },
      { key: "burnVoteVeto", apiKey: "burn_vote_veto", label: "Burn on Veto", kind: "boolean" },
    ],
  },
  staking: {
    label: "Staking",
    paramPath: "/cosmos/staking/v1beta1/params",
    responseKey: "params",
    typeUrl: "/cosmos.staking.v1beta1.MsgUpdateParams",
    fields: [
      { key: "unbondingTime", apiKey: "unbonding_time", label: "Unbonding Time", kind: "duration", unit: "days", unitDivisor: 86400 },
      { key: "maxValidators", apiKey: "max_validators", label: "Max Validators", kind: "number" },
      { key: "maxEntries", apiKey: "max_entries", label: "Max Entries", kind: "number" },
      { key: "historicalEntries", apiKey: "historical_entries", label: "Historical Entries", kind: "number" },
      { key: "bondDenom", apiKey: "bond_denom", label: "Bond Denom", kind: "string" },
      { key: "minCommissionRate", apiKey: "min_commission_rate", label: "Min Commission Rate", kind: "string", hint: "e.g. 0.05 = 5%" },
    ],
  },
  distribution: {
    label: "Distribution",
    paramPath: "/cosmos/distribution/v1beta1/params",
    responseKey: "params",
    typeUrl: "/cosmos.distribution.v1beta1.MsgUpdateParams",
    fields: [
      { key: "communityTax", apiKey: "community_tax", label: "Community Tax", kind: "string", hint: "e.g. 0.02 = 2%" },
      { key: "withdrawAddrEnabled", apiKey: "withdraw_addr_enabled", label: "Withdraw Address Enabled", kind: "boolean" },
    ],
  },
  slashing: {
    label: "Slashing",
    paramPath: "/cosmos/slashing/v1beta1/params",
    responseKey: "params",
    typeUrl: "/cosmos.slashing.v1beta1.MsgUpdateParams",
    fields: [
      { key: "signedBlocksWindow", apiKey: "signed_blocks_window", label: "Signed Blocks Window", kind: "bigint" },
      { key: "minSignedPerWindow", apiKey: "min_signed_per_window", label: "Min Signed Per Window", kind: "dec-bytes", hint: "e.g. 0.5 = 50%" },
      { key: "downtimeJailDuration", apiKey: "downtime_jail_duration", label: "Downtime Jail Duration", kind: "duration", unit: "minutes", unitDivisor: 60 },
      { key: "slashFractionDoubleSign", apiKey: "slash_fraction_double_sign", label: "Slash Fraction (Double Sign)", kind: "dec-bytes", hint: "e.g. 0.05 = 5%" },
      { key: "slashFractionDowntime", apiKey: "slash_fraction_downtime", label: "Slash Fraction (Downtime)", kind: "dec-bytes", hint: "e.g. 0.0001 = 0.01%" },
    ],
  },
  commons: {
    label: "Commons",
    paramPath: "/sparkdream/commons/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.commons.v1.MsgUpdateParams",
    fields: [
      { key: "proposalFee", apiKey: "proposal_fee", label: "Proposal Fee", kind: "string", hint: "Cost to register a group (in base denom e.g. 1000uspark)" },
    ],
  },
  blog: {
    label: "Blog",
    paramPath: "/sparkdream/blog/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.blog.v1.MsgUpdateParams",
    fields: [
      { key: "maxTitleLength", apiKey: "max_title_length", label: "Max Title Length", kind: "bigint" },
      { key: "maxBodyLength", apiKey: "max_body_length", label: "Max Body Length", kind: "bigint" },
      { key: "maxReplyLength", apiKey: "max_reply_length", label: "Max Reply Length", kind: "bigint" },
      { key: "maxReplyDepth", apiKey: "max_reply_depth", label: "Max Reply Depth", kind: "number" },
      { key: "maxPostsPerDay", apiKey: "max_posts_per_day", label: "Max Posts Per Day", kind: "number" },
      { key: "maxRepliesPerDay", apiKey: "max_replies_per_day", label: "Max Replies Per Day", kind: "number" },
      { key: "maxReactionsPerDay", apiKey: "max_reactions_per_day", label: "Max Reactions Per Day", kind: "number" },
      { key: "costPerByte", apiKey: "cost_per_byte", label: "Cost Per Byte", kind: "coin" },
      { key: "reactionFee", apiKey: "reaction_fee", label: "Reaction Fee", kind: "coin" },
      { key: "costPerByteExempt", apiKey: "cost_per_byte_exempt", label: "Cost Per Byte Exempt", kind: "boolean" },
      { key: "reactionFeeExempt", apiKey: "reaction_fee_exempt", label: "Reaction Fee Exempt", kind: "boolean" },
    ],
  },
  session: {
    label: "Session",
    paramPath: "/sparkdream/session/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.session.v1.MsgUpdateParams",
    fields: [
      { key: "maxSessionsPerGranter", apiKey: "max_sessions_per_granter", label: "Max Sessions Per Granter", kind: "bigint" },
      { key: "maxMsgTypesPerSession", apiKey: "max_msg_types_per_session", label: "Max Msg Types Per Session", kind: "bigint" },
      { key: "maxExpiration", apiKey: "max_expiration", label: "Max Expiration", kind: "duration", unit: "days", unitDivisor: 86400 },
      { key: "maxSpendLimit", apiKey: "max_spend_limit", label: "Max Spend Limit", kind: "coin" },
    ],
  },
};

// ── Component ───────────────────────────────────────────────────────

interface ParamChangeFormProps {
  onMessage: (msg: { typeUrl: string; value: Uint8Array } | null) => void;
}

export default function ParamChangeForm({ onMessage }: ParamChangeFormProps) {
  const { config } = useChainConfig();
  const [selectedModule, setSelectedModule] = useState<string>("");
  const [currentParams, setCurrentParams] = useState<Record<string, unknown> | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const moduleDef = selectedModule ? MODULES[selectedModule] : null;

  // Fetch current params when module changes
  useEffect(() => {
    if (!moduleDef) {
      setCurrentParams(null);
      setEditedValues({});
      onMessage(null);
      return;
    }

    setLoading(true);
    setFetchError(null);

    getModuleParams(moduleDef.paramPath)
      .then((res) => {
        const params = res[moduleDef.responseKey] as Record<string, unknown>;
        setCurrentParams(params || {});

        // Pre-fill edited values from current params
        const initial: Record<string, string> = {};
        for (const field of moduleDef.fields) {
          initial[field.key] = displayValue(field, params?.[field.apiKey]);
        }
        setEditedValues(initial);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : "Failed to fetch params");
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModule]);

  // Encode the message whenever edited values change
  useEffect(() => {
    if (!moduleDef || !currentParams) {
      onMessage(null);
      return;
    }

    (async () => {
      try {
        const encoded = await encodeParamUpdate(
          selectedModule,
          moduleDef,
          currentParams,
          editedValues
        );
        onMessage(encoded);
      } catch {
        onMessage(null);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedValues, selectedModule, currentParams]);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-700/50 bg-zinc-800/20 p-4">
      <h4 className="text-sm font-medium text-zinc-300">Parameter Change</h4>

      {/* Module selector */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-400">
          Module
        </label>
        <select
          value={selectedModule}
          onChange={(e) => setSelectedModule(e.target.value)}
          className="sd-select w-full"
        >
          <option value="">Select a module...</option>
          {Object.entries(MODULES).map(([key, mod]) => (
            <option key={key} value={key}>
              {mod.label}
            </option>
          ))}
        </select>
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-400">
          {fetchError}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          Loading current parameters...
        </div>
      )}

      {/* Parameter fields */}
      {moduleDef && currentParams && !loading && (
        <div className="space-y-2.5">
          <p className="text-xs text-zinc-500">
            Current values are pre-filled. Edit the values you want to change.
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {moduleDef.fields.map((field) => (
              <ParamField
                key={field.key}
                field={field}
                value={editedValues[field.key] || ""}
                displayDenom={config.displayDenom}
                onChange={(val) =>
                  setEditedValues((prev) => ({ ...prev, [field.key]: val }))
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field renderer ──────────────────────────────────────────────────

function ParamField({
  field,
  value,
  displayDenom,
  onChange,
}: {
  field: FieldDef;
  value: string;
  displayDenom: string;
  onChange: (v: string) => void;
}) {
  if (field.kind === "boolean") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2">
        <label className="text-xs font-medium text-zinc-400">
          {field.label}
        </label>
        <button
          type="button"
          onClick={() => onChange(value === "true" ? "false" : "true")}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            value === "true" ? "bg-indigo-600" : "bg-zinc-600"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              value === "true" ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    );
  }

  const label = field.unit
    ? `${field.label} (${field.unit})`
    : field.kind === "coin" || field.kind === "coins"
      ? `${field.label} (${displayDenom})`
      : field.label;

  return (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      <input
        type={
          field.kind === "number" || field.kind === "bigint" || field.kind === "duration"
            ? "number"
            : "text"
        }
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
      />
      {field.hint && (
        <p className="mt-0.5 text-[10px] text-zinc-600">{field.hint}</p>
      )}
    </div>
  );
}

// ── Value display helpers ───────────────────────────────────────────

function displayValue(field: FieldDef, raw: unknown): string {
  if (raw === undefined || raw === null) return "";

  if (field.kind === "duration") {
    // Duration comes as "172800s" or { seconds: "172800", nanos: 0 }
    const secs = parseDurationSeconds(raw);
    return String(Math.round(secs / (field.unitDivisor || 1)));
  }

  if (field.kind === "coins") {
    // Coin array — show first coin amount in display units
    const arr = raw as { denom: string; amount: string }[];
    if (!arr?.length) return "0";
    return String(parseInt(arr[0].amount, 10) / 1_000_000);
  }

  if (field.kind === "coin") {
    // Single coin
    const c = raw as { denom: string; amount: string };
    if (!c?.amount) return "0";
    return String(parseInt(c.amount, 10) / 1_000_000);
  }

  if (field.kind === "boolean") {
    return String(!!raw);
  }

  if (field.kind === "dec-bytes") {
    // Decimal bytes — displayed as decimal string from API
    return String(raw);
  }

  return String(raw);
}

function parseDurationSeconds(raw: unknown): number {
  if (typeof raw === "string") {
    // "172800s" format
    const match = raw.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) return parseFloat(match[1]);
    return parseFloat(raw) || 0;
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return Number(obj.seconds || 0);
  }
  return Number(raw) || 0;
}

// ── Encoding ────────────────────────────────────────────────────────

async function encodeParamUpdate(
  moduleKey: string,
  moduleDef: ModuleDef,
  currentParams: Record<string, unknown>,
  editedValues: Record<string, string>
): Promise<{ typeUrl: string; value: Uint8Array }> {
  // Build the params object from edited values, falling back to current values
  const govModuleAddress = await fetchGovModuleAddress();

  switch (moduleKey) {
    case "gov": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/gov/v1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              quorum: editedValues.quorum || String(cur.quorum || ""),
              threshold: editedValues.threshold || String(cur.threshold || ""),
              vetoThreshold: editedValues.vetoThreshold || String(cur.veto_threshold || ""),
              votingPeriod: toDuration(editedValues.votingPeriod, 3600, cur.voting_period),
              maxDepositPeriod: toDuration(editedValues.maxDepositPeriod, 3600, cur.max_deposit_period),
              minDeposit: toCoins(editedValues.minDeposit, cur.min_deposit),
              minInitialDepositRatio: editedValues.minInitialDepositRatio || String(cur.min_initial_deposit_ratio || "0"),
              expeditedThreshold: editedValues.expeditedThreshold || String(cur.expedited_threshold || ""),
              expeditedVotingPeriod: toDuration(editedValues.expeditedVotingPeriod, 3600, cur.expedited_voting_period),
              expeditedMinDeposit: (cur.expedited_min_deposit as any[]) || [],
              proposalCancelRatio: String(cur.proposal_cancel_ratio || "0.5"),
              proposalCancelDest: String(cur.proposal_cancel_dest || ""),
              burnVoteQuorum: editedValues.burnVoteQuorum === "true",
              burnProposalDepositPrevote: !!(cur.burn_proposal_deposit_prevote),
              burnVoteVeto: editedValues.burnVoteVeto === "true",
              minDepositRatio: String(cur.min_deposit_ratio || "0.01"),
            },
          })
        ).finish(),
      };
    }
    case "staking": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/staking/v1beta1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              unbondingTime: toDuration(editedValues.unbondingTime, 86400, cur.unbonding_time),
              maxValidators: parseInt(editedValues.maxValidators) || Number(cur.max_validators || 100),
              maxEntries: parseInt(editedValues.maxEntries) || Number(cur.max_entries || 7),
              historicalEntries: parseInt(editedValues.historicalEntries) || Number(cur.historical_entries || 10000),
              bondDenom: editedValues.bondDenom || String(cur.bond_denom || ""),
              minCommissionRate: editedValues.minCommissionRate || String(cur.min_commission_rate || "0"),
            },
          })
        ).finish(),
      };
    }
    case "distribution": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/distribution/v1beta1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              communityTax: editedValues.communityTax || String(cur.community_tax || ""),
              baseProposerReward: String(cur.base_proposer_reward || "0"),
              bonusProposerReward: String(cur.bonus_proposer_reward || "0"),
              withdrawAddrEnabled: editedValues.withdrawAddrEnabled === "true",
            },
          })
        ).finish(),
      };
    }
    case "slashing": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/slashing/v1beta1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              signedBlocksWindow: BigInt(editedValues.signedBlocksWindow || cur.signed_blocks_window as string || "0"),
              minSignedPerWindow: toDecBytes(editedValues.minSignedPerWindow || String(cur.min_signed_per_window || "")),
              downtimeJailDuration: toDuration(editedValues.downtimeJailDuration, 60, cur.downtime_jail_duration),
              slashFractionDoubleSign: toDecBytes(editedValues.slashFractionDoubleSign || String(cur.slash_fraction_double_sign || "")),
              slashFractionDowntime: toDecBytes(editedValues.slashFractionDowntime || String(cur.slash_fraction_downtime || "")),
            },
          })
        ).finish(),
      };
    }
    case "commons": {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              proposalFee: editedValues.proposalFee || String(cur.proposal_fee || ""),
            },
          })
        ).finish(),
      };
    }
    case "blog": {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              maxTitleLength: BigInt(editedValues.maxTitleLength || cur.max_title_length as string || "0"),
              maxBodyLength: BigInt(editedValues.maxBodyLength || cur.max_body_length as string || "0"),
              maxReplyLength: BigInt(editedValues.maxReplyLength || cur.max_reply_length as string || "0"),
              maxReplyDepth: parseInt(editedValues.maxReplyDepth) || Number(cur.max_reply_depth || 0),
              maxPostsPerDay: parseInt(editedValues.maxPostsPerDay) || Number(cur.max_posts_per_day || 0),
              maxRepliesPerDay: parseInt(editedValues.maxRepliesPerDay) || Number(cur.max_replies_per_day || 0),
              maxReactionsPerDay: parseInt(editedValues.maxReactionsPerDay) || Number(cur.max_reactions_per_day || 0),
              costPerByte: toCoin(editedValues.costPerByte, cur.cost_per_byte),
              reactionFee: toCoin(editedValues.reactionFee, cur.reaction_fee),
              costPerByteExempt: editedValues.costPerByteExempt === "true",
              reactionFeeExempt: editedValues.reactionFeeExempt === "true",
              // Carry forward fields not shown in the form
              ephemeralContentTtl: BigInt(cur.ephemeral_content_ttl as string || "0"),
              pinMinTrustLevel: Number(cur.pin_min_trust_level || 0),
              maxPinsPerDay: Number(cur.max_pins_per_day || 0),
              minEphemeralContentTtl: BigInt(cur.min_ephemeral_content_ttl as string || "0"),
              maxCostPerByte: (cur.max_cost_per_byte as any) || undefined,
              maxReactionFee: (cur.max_reaction_fee as any) || undefined,
              convictionRenewalThreshold: String(cur.conviction_renewal_threshold || ""),
              convictionRenewalPeriod: BigInt(cur.conviction_renewal_period as string || "0"),
            },
          })
        ).finish(),
      };
    }
    case "session": {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              maxSessionsPerGranter: BigInt(editedValues.maxSessionsPerGranter || cur.max_sessions_per_granter as string || "0"),
              maxMsgTypesPerSession: BigInt(editedValues.maxMsgTypesPerSession || cur.max_msg_types_per_session as string || "0"),
              maxExpiration: toDuration(editedValues.maxExpiration, 86400, cur.max_expiration),
              maxSpendLimit: toCoin(editedValues.maxSpendLimit, cur.max_spend_limit),
              // Carry forward array fields
              maxAllowedMsgTypes: (cur.max_allowed_msg_types as string[]) || [],
              allowedMsgTypes: (cur.allowed_msg_types as string[]) || [],
            },
          })
        ).finish(),
      };
    }
    default:
      throw new Error(`Unknown module: ${moduleKey}`);
  }
}

// ── Encoding helpers ────────────────────────────────────────────────

function toDuration(
  editedValue: string | undefined,
  unitDivisor: number,
  currentRaw: unknown
): { seconds: bigint; nanos: number } | undefined {
  if (editedValue !== undefined && editedValue !== "") {
    const seconds = Math.round(parseFloat(editedValue) * unitDivisor);
    return { seconds: BigInt(seconds), nanos: 0 };
  }
  // Fall back to current
  const secs = parseDurationSeconds(currentRaw);
  return { seconds: BigInt(Math.round(secs)), nanos: 0 };
}

function toCoins(
  editedValue: string | undefined,
  currentRaw: unknown
): { denom: string; amount: string }[] {
  if (editedValue !== undefined && editedValue !== "") {
    const micro = (parseFloat(editedValue) * 1_000_000).toFixed(0);
    // Reuse denom from current
    const cur = currentRaw as { denom: string; amount: string }[] | undefined;
    const denom = cur?.[0]?.denom || "uspark";
    return [{ denom, amount: micro }];
  }
  return (currentRaw as { denom: string; amount: string }[]) || [];
}

function toCoin(
  editedValue: string | undefined,
  currentRaw: unknown
): { denom: string; amount: string } | undefined {
  if (editedValue !== undefined && editedValue !== "") {
    const cur = currentRaw as { denom: string; amount: string } | undefined;
    const denom = cur?.denom || "uspark";
    const micro = (parseFloat(editedValue) * 1_000_000).toFixed(0);
    return { denom, amount: micro };
  }
  return (currentRaw as { denom: string; amount: string }) || undefined;
}

function toDecBytes(value: string): Uint8Array {
  // Cosmos SDK stores sdk.Dec as UTF-8 encoded string bytes
  return new TextEncoder().encode(value);
}

let _govModuleAddr = "";

async function fetchGovModuleAddress(): Promise<string> {
  if (_govModuleAddr) return _govModuleAddr;
  try {
    const res = await fetch("/api/lcd/cosmos/auth/v1beta1/module_accounts/gov");
    const data = await res.json();
    _govModuleAddr = data.account?.base_account?.address || "";
    return _govModuleAddr;
  } catch {
    return "";
  }
}
