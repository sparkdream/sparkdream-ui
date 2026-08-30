"use client";

import { useEffect, useState } from "react";
import { getModuleParams } from "@/lib/api";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  MODULES,
  displayValue,
  parseDurationSeconds,
  getByPath,
  type FieldDef,
  type ModuleDef,
} from "@/lib/paramMeta";


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

        // Pre-fill edited values from current params, descending into
        // nested messages when `apiKey` is a dot-path (e.g. rep's
        // `apprentice_tier.max_budget` reaches into TierConfig).
        const initial: Record<string, string> = {};
        for (const field of moduleDef.fields) {
          initial[field.key] = displayValue(field, getByPath(params, field.apiKey));
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
      <h4 className="text-sm font-medium text-zinc-300">Parameter change</h4>

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
            Fields not shown here are carried forward from the chain&apos;s
            current params.
          </p>
          {/* Render fields in their source order. When a `group` heading
              changes between consecutive fields we close the current grid
              and open a new section — keeps modules like rep (~90 fields)
              scannable. Fields without a group render under no heading. */}
          {groupFields(moduleDef.fields).map((section, idx) => (
            <div key={section.group ?? `_ungrouped_${idx}`} className="space-y-1.5">
              {section.group && (
                <h5 className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {section.group}
                </h5>
              )}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {section.fields.map((field) => (
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
          ))}
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
    : field.kind === "coin" || field.kind === "coins" || field.kind === "amount"
      ? `${field.label} (${displayDenom})`
      : field.kind === "dream"
        ? `${field.label} (DREAM)`
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


// ── Encoding ────────────────────────────────────────────────────────

async function encodeParamUpdate(
  moduleKey: string,
  moduleDef: ModuleDef,
  currentParams: Record<string, unknown>,
  editedValues: Record<string, string>
): Promise<{ typeUrl: string; value: Uint8Array }> {
  const govModuleAddress = await fetchGovModuleAddress();

  // Sparkdream modules — every Params has a Telescope-generated fromAmino
  // that accepts the same snake_case JSON the LCD returns. We overlay user
  // edits onto the LCD object (so unedited fields round-trip untouched, even
  // ones we don't render in the form) and let fromAmino do the proto packing.
  if (moduleDef.generic) {
    const { MsgUpdateParams, Params } = await moduleDef.generic();
    const editedAmino = buildEditedAmino(moduleDef.fields, currentParams, editedValues);
    const params = Params.fromAmino(normalizeDurationsForAmino(editedAmino));
    return {
      typeUrl: moduleDef.typeUrl,
      value: MsgUpdateParams.encode(
        MsgUpdateParams.fromPartial({ authority: govModuleAddress, params })
      ).finish(),
    };
  }

  // Cosmos-SDK modules — cosmjs-types' Params codecs don't ship fromAmino, so
  // we still build the proto params object by hand from the camelCase edits +
  // carry-forward snake_case LCD response fields.
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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    case "mint": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/mint/v1beta1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              mintDenom: editedValues.mintDenom || String(cur.mint_denom || ""),
              inflationRateChange: editedValues.inflationRateChange || String(cur.inflation_rate_change || "0"),
              inflationMax: editedValues.inflationMax || String(cur.inflation_max || "0"),
              inflationMin: editedValues.inflationMin || String(cur.inflation_min || "0"),
              goalBonded: editedValues.goalBonded || String(cur.goal_bonded || "0"),
              blocksPerYear: BigInt(editedValues.blocksPerYear || cur.blocks_per_year as string || "0"),
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

function toDecBytes(value: string): Uint8Array {
  // Cosmos SDK stores sdk.Dec as UTF-8 encoded string bytes
  return new TextEncoder().encode(value);
}

/**
 * Overlay user edits onto the current LCD amino JSON. Unedited fields stay as
 * the LCD returned them so they round-trip cleanly through Params.fromAmino —
 * including fields the form doesn't render at all (long-tail params we'd
 * otherwise have to enumerate in every FieldDef array). When `apiKey` is a
 * dot-path, the edit descends into nested messages (rep's TierConfigs /
 * TrustLevelConfig) without disturbing sibling fields.
 */
function buildEditedAmino(
  fields: FieldDef[],
  currentParams: Record<string, unknown>,
  editedValues: Record<string, string>
): Record<string, unknown> {
  let out: Record<string, unknown> = { ...currentParams };
  for (const field of fields) {
    const v = editedValues[field.key];
    if (v === undefined || v === "") continue;
    const converted = convertEditToAmino(field, v, getByPath(currentParams, field.apiKey));
    out = setByPath(out, field.apiKey, converted);
  }
  return out;
}


/** Immutably set a nested field, copying every object along the way so the
 * original LCD response isn't mutated and React can detect the state change. */
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const parts = path.split(".");
  if (parts.length === 1) {
    return { ...obj, [parts[0]]: value };
  }
  const [head, ...rest] = parts;
  const child = (obj[head] as Record<string, unknown>) ?? {};
  return { ...obj, [head]: setByPath(child, rest.join("."), value) };
}

/** Bucket fields into ordered sections by their `group`. Consecutive fields
 * with the same group share one bucket; ungrouped fields fall into a single
 * leading bucket with `group: undefined`. */
function groupFields(
  fields: FieldDef[]
): { group: string | undefined; fields: FieldDef[] }[] {
  const out: { group: string | undefined; fields: FieldDef[] }[] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (last && last.group === f.group) {
      last.fields.push(f);
    } else {
      out.push({ group: f.group, fields: [f] });
    }
  }
  return out;
}

function convertEditToAmino(
  field: FieldDef,
  edited: string,
  currentRaw: unknown
): unknown {
  switch (field.kind) {
    case "boolean":
      return edited === "true";
    case "number":
      return parseInt(edited, 10);
    case "bigint":
      // Amino JSON encodes int64/uint64 as strings; keep as-is.
      return edited;
    case "duration": {
      // Emit "Xs" form — normalizeDurationsForAmino below converts to the
      // nanosecond string Duration.fromAmino expects.
      const secs = Math.round(parseFloat(edited) * (field.unitDivisor || 1));
      return `${secs}s`;
    }
    case "coin": {
      const cur = currentRaw as { denom?: string } | undefined;
      const denom = cur?.denom || "uspark";
      const micro = (parseFloat(edited) * 1_000_000).toFixed(0);
      return { denom, amount: micro };
    }
    case "coins": {
      const cur = currentRaw as { denom?: string }[] | undefined;
      const denom = cur?.[0]?.denom || "uspark";
      const micro = (parseFloat(edited) * 1_000_000).toFixed(0);
      return [{ denom, amount: micro }];
    }
    case "amount": {
      // Bare math.Int string in micro-units; the chain wraps it into the
      // bond-denom Coin at use time from x/identity (post-efcf392).
      return (parseFloat(edited) * 1_000_000).toFixed(0);
    }
    case "dream": {
      // Whole DREAM input → bare math.Int micro-DREAM string (1 DREAM =
      // 1_000_000 micro-DREAM).
      return (parseFloat(edited) * 1_000_000).toFixed(0);
    }
    case "string":
    case "int":
    case "dec":
    case "dec-bytes":
    default:
      return edited;
  }
}

/**
 * Recursively rewrite protobuf Duration strings (`"172800s"`) into the
 * nanosecond strings Telescope's `Duration.fromAmino` expects (it does
 * `BigInt(object) / 1e9` per the codec, so `"172800s"` would just throw).
 * Only touches strings matching the `^\d+(?:\.\d+)?s$` shape — leaves
 * everything else (including e.g. token denoms or descriptive strings) alone.
 */
function normalizeDurationsForAmino(obj: unknown): unknown {
  if (typeof obj === "string") {
    const m = obj.match(/^(\d+(?:\.\d+)?)s$/);
    if (m) {
      const num = parseFloat(m[1]);
      return String(BigInt(Math.round(num * 1_000_000_000)));
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeDurationsForAmino);
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      out[k] = normalizeDurationsForAmino((obj as Record<string, unknown>)[k]);
    }
    return out;
  }
  return obj;
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
