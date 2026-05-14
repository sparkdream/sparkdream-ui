"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
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
  /** Validator the modal is anchored to. Source for redelegate; target for delegate/undelegate. */
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
  onClose: () => void;
  onSuccess: () => void;
}

const TABS: { id: DelegateMode; label: string }[] = [
  { id: "delegate", label: "Delegate" },
  { id: "undelegate", label: "Undelegate" },
  { id: "redelegate", label: "Redelegate" },
];

export default function DelegateModal({
  validator,
  initialMode,
  allValidators,
  availableBalance,
  myDelegation,
  params,
  onClose,
  onSuccess,
}: Props) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const [mode, setMode] = useState<DelegateMode>(initialMode);
  const [amountInput, setAmountInput] = useState("");
  const [destOperator, setDestOperator] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasDelegation = !!myDelegation;
  const delegatedAmount = myDelegation?.balance.amount ?? "0";

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

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
    if (!maxUspark || maxUspark === "0") return;
    setAmountInput(formatSpark(maxUspark));
  };

  const handleSubmit = async () => {
    if (!address || !amountUspark || !amountValid || amountExceedsMax) return;
    if (mode === "redelegate" && !destOperator) {
      setError("Pick a destination validator");
      return;
    }
    setSubmitting(true);
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
      await signAndBroadcast([msg]);
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // For the "Source" / "Destination" header text.
  const moniker = validator.description.moniker || validator.operator_address.slice(0, 18);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl sd-hull-tile p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">
              {mode === "redelegate" ? "Redelegate from" : mode === "undelegate" ? "Undelegate from" : "Delegate to"}{" "}
              <span className="text-indigo-400">{moniker}</span>
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 break-all">
              {validator.operator_address}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
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
        <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs">
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
          <div className="mb-3">
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
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-zinc-400">Amount ({config.displayDenom})</label>
          <button
            onClick={handleSetMax}
            disabled={!maxUspark || maxUspark === "0"}
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

        {/* Mode-specific hints */}
        {mode === "undelegate" && unbondingHint && (
          <p className="mt-2 rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300/90">
            Unbonded {config.displayDenom} is locked for ~{unbondingHint} before it returns to your spendable balance — and earns no rewards during that window.
          </p>
        )}
        {mode === "redelegate" && (
          <p className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-[11px] text-zinc-400">
            Redelegations are instant (no unbonding wait) but the chain locks the destination against further redelegations for the full unbonding period.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-md border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300 break-words">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
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
            {submitting
              ? "Signing..."
              : mode === "delegate"
              ? "Delegate"
              : mode === "undelegate"
              ? "Undelegate"
              : "Redelegate"}
          </button>
        </div>
      </div>
    </div>
  );
}
