"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useTxPhase } from "@/hooks/useTxPhase";
import {
  StakingMsgTypeUrls,
} from "@/lib/tx";
import {
  formatSpark,
  parseSparkToUspark,
  formatDecPercent,
  formatDurationApprox,
  parseDurationSeconds,
} from "@/lib/utils";
import SearchableSelect from "@/components/contribute/SearchableSelect";
import type { Validator, DelegationResponse, StakingParams } from "@/types/staking";

export type DelegateMode = "delegate" | "undelegate" | "redelegate";

interface Props {
  /** Validator the form acts on. Source for redelegate; target for delegate/undelegate. */
  validator: Validator;
  /** Default tab. */
  initialMode: DelegateMode;
  /** Full validator list — drives the redelegate destination dropdown. */
  allValidators: Validator[];
  /** Available spendable SPARK in base denom (uspark string). */
  availableBalance: string;
  /** Caller's current delegation to `validator`, if any. */
  myDelegation: DelegationResponse | undefined;
  /** Chain staking params for the unbonding-period hint. */
  params: StakingParams | null;
  /** Collapses the inline form without submitting. */
  onCancel: () => void;
  /** Fires after a successful tx; the caller typically refetches + collapses. */
  onSuccess: () => void;
}

// Tab order mirrors the row's pill order (Add / Move / Unbond) so users see
// the same sequence in both places — and keeps the destructive Undelegate
// action last.
const TABS: { id: DelegateMode; label: string }[] = [
  { id: "delegate", label: "Delegate" },
  { id: "redelegate", label: "Redelegate" },
  { id: "undelegate", label: "Undelegate" },
];

// Reserve 1 SPARK when the user clicks MAX in delegate mode, so they don't
// drain their entire spendable balance and leave themselves stuck for gas on
// the next claim/undelegate tx. Manual entry above this cap is still allowed.
const GAS_RESERVE_USPARK = BigInt(1_000_000);

export default function DelegateForm({
  validator,
  initialMode,
  allValidators,
  availableBalance,
  myDelegation,
  params,
  onCancel,
  onSuccess,
}: Props) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const [mode, setMode] = useState<DelegateMode>(initialMode);
  const [amountInput, setAmountInput] = useState("");
  const [destOperator, setDestOperator] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const tx = useTxPhase();
  const [error, setError] = useState<string | null>(null);

  const hasDelegation = !!myDelegation;
  const delegatedAmount = myDelegation?.balance.amount ?? "0";

  // Reset amount + destination whenever the active tab flips.
  useEffect(() => {
    setAmountInput("");
    setDestOperator("");
    setError(null);
  }, [mode]);

  const maxUspark = useMemo(() => {
    if (mode === "delegate") return availableBalance;
    return delegatedAmount;
  }, [mode, availableBalance, delegatedAmount]);

  // What MAX actually fills in — for delegate mode, leave 1 SPARK behind for
  // gas. Returns "0" if the user has 1 SPARK or less, which also disables the
  // MAX button via the existing check.
  const maxButtonUspark = useMemo(() => {
    if (mode !== "delegate") return maxUspark;
    try {
      const avail = BigInt(availableBalance || "0");
      if (avail <= GAS_RESERVE_USPARK) return "0";
      return (avail - GAS_RESERVE_USPARK).toString();
    } catch {
      return "0";
    }
  }, [mode, availableBalance, maxUspark]);

  const showGasReserveHint =
    mode === "delegate" && BigInt(availableBalance || "0") > GAS_RESERVE_USPARK;

  const amountUspark = parseSparkToUspark(amountInput);
  const amountValid = amountUspark !== null && BigInt(amountUspark) > BigInt(0);
  const amountExceedsMax =
    amountUspark !== null &&
    maxUspark &&
    BigInt(amountUspark) > BigInt(maxUspark);

  const unbondingHint = useMemo(() => {
    if (!params) return null;
    const secs = parseDurationSeconds(params.unbonding_time);
    return formatDurationApprox(secs);
  }, [params]);

  // Redelegate destination options — exclude the source validator + jailed
  // ones (chain rejects redelegations to a jailed validator).
  const redelegateOptions = useMemo(
    () =>
      allValidators
        .filter(
          (v) =>
            v.operator_address !== validator.operator_address &&
            !v.jailed &&
            v.status === "BOND_STATUS_BONDED"
        )
        .sort((a, b) => (a.description.moniker || "").localeCompare(b.description.moniker || ""))
        .map((v) => ({
          value: v.operator_address,
          label: `${v.description.moniker || v.operator_address.slice(0, 14)} · ${formatDecPercent(v.commission.commission_rates.rate)} fee`,
        })),
    [allValidators, validator.operator_address]
  );

  const handleSetMax = () => {
    if (!maxButtonUspark || maxButtonUspark === "0") return;
    setAmountInput(formatSpark(maxButtonUspark));
  };

  const handleSubmit = async () => {
    if (!address || !amountUspark || !amountValid || amountExceedsMax) return;
    if (mode === "redelegate" && !destOperator) {
      setError("Pick a destination validator");
      return;
    }
    setSubmitting(true);
    tx.setPhase(null);
    setError(null);
    try {
      const amount = { denom: config.denom, amount: amountUspark };
      let msg: { typeUrl: string; value: unknown };
      if (mode === "delegate") {
        msg = {
          typeUrl: StakingMsgTypeUrls.Delegate,
          value: {
            delegatorAddress: address,
            validatorAddress: validator.operator_address,
            amount,
          },
        };
      } else if (mode === "undelegate") {
        msg = {
          typeUrl: StakingMsgTypeUrls.Undelegate,
          value: {
            delegatorAddress: address,
            validatorAddress: validator.operator_address,
            amount,
          },
        };
      } else {
        msg = {
          typeUrl: StakingMsgTypeUrls.BeginRedelegate,
          value: {
            delegatorAddress: address,
            validatorSrcAddress: validator.operator_address,
            validatorDstAddress: destOperator,
            amount,
          },
        };
      }
      await signAndBroadcast([msg], "", tx.setPhase);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      tx.setPhase(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        {TABS.map((t) => {
          // Disable undelegate/redelegate when the user has no delegation here.
          const disabled = t.id !== "delegate" && !hasDelegation;
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              onClick={() => !disabled && setMode(t.id)}
              disabled={disabled}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-indigo-600/20 text-indigo-300"
                  : disabled
                  ? "text-zinc-600 cursor-not-allowed"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title={disabled ? "No active delegation here" : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Stat row: shows the relevant max-available for the active tab */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs">
        {mode === "delegate" ? (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Available to delegate</span>
            <span className="font-medium text-zinc-200">
              {formatSpark(availableBalance)} {config.displayDenom}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Currently delegated here</span>
            <span className="font-medium text-zinc-200">
              {formatSpark(delegatedAmount)} {config.displayDenom}
            </span>
          </div>
        )}
      </div>

      {/* Redelegate destination picker */}
      {mode === "redelegate" && (
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Destination validator</label>
          {redelegateOptions.length === 0 ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-2 text-xs text-zinc-500">
              No other active validators available
            </div>
          ) : (
            <SearchableSelect
              options={redelegateOptions}
              value={destOperator}
              onChange={setDestOperator}
              placeholder="Search validators..."
              emptyMessage="No matches"
            />
          )}
        </div>
      )}

      {/* Amount input */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-zinc-400">Amount ({config.displayDenom})</label>
          <button
            onClick={handleSetMax}
            disabled={!maxButtonUspark || maxButtonUspark === "0"}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600"
          >
            MAX
          </button>
        </div>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.000000"
          value={amountInput}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) setAmountInput(v);
          }}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
        />
        {amountInput && !amountValid && (
          <p className="mt-1 text-xs text-red-400">Enter an amount greater than 0</p>
        )}
        {amountExceedsMax && (
          <p className="mt-1 text-xs text-red-400">
            Exceeds {mode === "delegate" ? "available balance" : "delegated amount"}
          </p>
        )}
        {showGasReserveHint && (
          <p className="mt-1 text-[11px] text-zinc-500">
            MAX keeps 1 {config.displayDenom} in reserve for gas on future claim/undelegate txs.
          </p>
        )}
      </div>

      {/* Mode-specific hints */}
      {mode === "undelegate" && unbondingHint && (
        <p className="rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300/90">
          Unbonded {config.displayDenom} is locked for ~{unbondingHint} before it returns to your spendable balance — and earns no rewards during that window.
        </p>
      )}
      {mode === "redelegate" && (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px] text-zinc-400">
          Redelegations are instant (no unbonding wait) but the chain locks the destination against further redelegations for the full unbonding period.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300 wrap-break-word">
          {error}
        </p>
      )}

      {tx.hint && <p className="text-[11px] text-zinc-500">{tx.hint}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="sd-btn sd-btn-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={
            submitting ||
            !amountValid ||
            !!amountExceedsMax ||
            (mode === "redelegate" && !destOperator)
          }
          className="sd-btn sd-btn-primary"
        >
          {tx.buttonLabel(
            mode === "delegate" ? "Delegate" : mode === "undelegate" ? "Undelegate" : "Redelegate",
          )}
        </button>
      </div>
    </div>
  );
}
