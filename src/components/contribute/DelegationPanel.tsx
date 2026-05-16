"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  getBankBalance,
  getDelegatorRewards,
  getStakingParams,
  getStakingPool,
  listAllDelegationsByDelegator,
  listAllValidators,
  listUnbondingsByDelegator,
} from "@/lib/api";
import { DistributionMsgTypeUrls } from "@/lib/tx";
import {
  decCoinToBaseDenom,
  formatDecPercent,
  formatSpark,
  timeRemaining,
} from "@/lib/utils";
import DelegateForm, { type DelegateMode } from "@/components/contribute/DelegateForm";
import { useTxPhase } from "@/hooks/useTxPhase";
import type {
  DelegationResponse,
  StakingParams,
  StakingPool,
  UnbondingDelegation,
  Validator,
} from "@/types/staking";

interface RewardEntry {
  validator_address: string;
  // Floored integer base-denom (uspark) the user actually receives on withdraw.
  base_amount: bigint;
}

export default function DelegationPanel() {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();

  const [validators, setValidators] = useState<Validator[]>([]);
  const [delegations, setDelegations] = useState<DelegationResponse[]>([]);
  const [rewards, setRewards] = useState<RewardEntry[]>([]);
  const [unbondings, setUnbondings] = useState<UnbondingDelegation[]>([]);
  const [pool, setPool] = useState<StakingPool | null>(null);
  const [params, setParams] = useState<StakingParams | null>(null);
  const [balance, setBalance] = useState<string>("0");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [claimingAll, setClaimingAll] = useState(false);
  const claimTx = useTxPhase();

  // Which validator row is showing its inline delegate/undelegate/redelegate
  // form, and which tab opens by default. `null` = no form open.
  const [openForm, setOpenForm] = useState<{ operatorAddress: string; mode: DelegateMode } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Parallel where possible; the validator list is the hot path.
      const [vals, poolRes, paramsRes] = await Promise.all([
        listAllValidators(""),
        getStakingPool().catch(() => null),
        getStakingParams().catch(() => null),
      ]);
      setValidators(vals);
      if (poolRes) setPool(poolRes.pool);
      if (paramsRes) setParams(paramsRes.params);

      if (address) {
        const [dels, rewRes, ubs, bal] = await Promise.all([
          listAllDelegationsByDelegator(address).catch(() => []),
          getDelegatorRewards(address).catch(() => null),
          listUnbondingsByDelegator(address).catch(() => null),
          getBankBalance(address, config.denom).catch(() => null),
        ]);
        setDelegations(dels);
        setRewards(
          (rewRes?.rewards ?? []).map((r) => {
            // Sum the base-denom DecCoin entries only — ignore other denoms
            // (chains with multi-coin staking rewards return one entry per
            // denom; the Claim All button still withdraws all of them via
            // MsgWithdrawDelegatorReward, but the UI summary shows SPARK only).
            const base = r.reward
              .filter((c) => c.denom === config.denom)
              .reduce((acc, c) => acc + decCoinToBaseDenom(c.amount), BigInt(0));
            return { validator_address: r.validator_address, base_amount: base };
          })
        );
        setUnbondings(ubs?.unbonding_responses ?? []);
        setBalance(bal?.balance?.amount ?? "0");
      } else {
        setDelegations([]);
        setRewards([]);
        setUnbondings([]);
        setBalance("0");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [address, config.denom]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const validatorByAddr = useMemo(() => {
    const m = new Map<string, Validator>();
    for (const v of validators) m.set(v.operator_address, v);
    return m;
  }, [validators]);

  const delegationByValidator = useMemo(() => {
    const m = new Map<string, DelegationResponse>();
    for (const d of delegations) m.set(d.delegation.validator_address, d);
    return m;
  }, [delegations]);

  const rewardByValidator = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const r of rewards) m.set(r.validator_address, r.base_amount);
    return m;
  }, [rewards]);

  const totalDelegated = useMemo(
    () =>
      delegations.reduce(
        (acc, d) => acc + BigInt(d.balance.amount || "0"),
        BigInt(0)
      ),
    [delegations]
  );
  const totalRewards = useMemo(
    () => rewards.reduce((acc, r) => acc + r.base_amount, BigInt(0)),
    [rewards]
  );
  const totalUnbonding = useMemo(() => {
    let sum = BigInt(0);
    for (const u of unbondings) {
      for (const e of u.entries) sum += BigInt(e.balance || "0");
    }
    return sum;
  }, [unbondings]);

  const bondedTokens = useMemo(
    () => (pool ? BigInt(pool.bonded_tokens || "0") : BigInt(0)),
    [pool]
  );

  // Sort: active (bonded, not jailed) first, then by token count desc.
  const filteredValidators = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...validators]
      .filter((v) => {
        if (!showInactive && (v.jailed || v.status !== "BOND_STATUS_BONDED")) {
          // Always include if the user has a delegation here — otherwise it
          // would vanish from the list and they couldn't undelegate.
          if (!delegationByValidator.has(v.operator_address)) return false;
        }
        if (!q) return true;
        return (
          (v.description.moniker || "").toLowerCase().includes(q) ||
          v.operator_address.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Sort own-delegation rows to the top, then bonded by voting power.
        const aMine = delegationByValidator.has(a.operator_address) ? 1 : 0;
        const bMine = delegationByValidator.has(b.operator_address) ? 1 : 0;
        if (aMine !== bMine) return bMine - aMine;
        const aBonded = a.status === "BOND_STATUS_BONDED" && !a.jailed ? 1 : 0;
        const bBonded = b.status === "BOND_STATUS_BONDED" && !b.jailed ? 1 : 0;
        if (aBonded !== bBonded) return bBonded - aBonded;
        return BigInt(b.tokens) > BigInt(a.tokens) ? 1 : -1;
      });
  }, [validators, delegationByValidator, search, showInactive]);

  // Withdraw rewards from every validator we're delegated to, in one tx.
  // Filter to non-zero base-denom rewards so we don't pay fees to claim 0.
  const claimableRewards = useMemo(
    () =>
      rewards
        .filter((r) => r.base_amount > BigInt(0))
        .map((r) => r.validator_address),
    [rewards]
  );

  const handleClaimAll = async () => {
    if (!address || claimableRewards.length === 0) return;
    setClaimingAll(true);
    claimTx.setPhase(null);
    setError(null);
    try {
      const msgs = claimableRewards.map((valAddr) => ({
        typeUrl: DistributionMsgTypeUrls.WithdrawDelegatorReward,
        value: {
          delegatorAddress: address,
          validatorAddress: valAddr,
        },
      }));
      await signAndBroadcast(msgs, "", claimTx.setPhase);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaimingAll(false);
      claimTx.setPhase(null);
    }
  };

  // Toggle the inline form for a row. Clicking the same action again on a row
  // that already has its form open collapses it; clicking a different action
  // on the same row switches the form's tab without re-mounting.
  const toggleForm = (validator: Validator, mode: DelegateMode) => {
    setOpenForm((prev) =>
      prev && prev.operatorAddress === validator.operator_address && prev.mode === mode
        ? null
        : { operatorAddress: validator.operator_address, mode }
    );
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl sd-hull-tile" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl sd-hull-tile" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Delegate</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Stake {config.displayDenom} with a validator to secure the chain and earn rewards.
          </p>
        </div>
        {address && (
          <button
            onClick={handleClaimAll}
            disabled={claimingAll || claimableRewards.length === 0}
            className="sd-btn sd-btn-primary"
            title={
              claimableRewards.length === 0
                ? "No claimable rewards"
                : `Withdraw from ${claimableRewards.length} validator${claimableRewards.length === 1 ? "" : "s"}`
            }
          >
            {claimTx.buttonLabel(
              claimableRewards.length === 0
                ? "Claim Rewards"
                : `Claim ${formatSpark(totalRewards)} ${config.displayDenom}`,
            )}
          </button>
        )}
      </div>

      {claimingAll && claimTx.hint && (
        <p className="mb-3 text-[11px] text-zinc-500">{claimTx.hint}</p>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-300 break-words">
          {error}
        </div>
      )}

      {/* Summary stats */}
      {address && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Available"
            value={formatSpark(balance)}
            suffix={config.displayDenom}
          />
          <StatTile
            label="Delegated"
            value={formatSpark(totalDelegated)}
            suffix={config.displayDenom}
          />
          <StatTile
            label="Pending rewards"
            value={formatSpark(totalRewards)}
            suffix={config.displayDenom}
          />
          <StatTile
            label="Unbonding"
            value={formatSpark(totalUnbonding)}
            suffix={config.displayDenom}
          />
        </div>
      )}

      {/* Unbonding queue */}
      {unbondings.length > 0 && (
        <div className="mb-4 rounded-xl sd-hull-tile p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Unbonding queue
          </h3>
          <div className="space-y-1.5">
            {unbondings.flatMap((u) =>
              u.entries.map((e, idx) => {
                const v = validatorByAddr.get(u.validator_address);
                return (
                  <div
                    key={`${u.validator_address}-${idx}`}
                    className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-zinc-200">
                        {v?.description.moniker || u.validator_address.slice(0, 18)}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {timeRemaining(e.completion_time)}
                      </div>
                    </div>
                    <div className="text-zinc-300">
                      {formatSpark(e.balance)} {config.displayDenom}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Validator list controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search validators..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
        />
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          Show inactive
        </label>
      </div>

      {/* Validator table */}
      <div className="overflow-x-auto rounded-xl sd-hull-tile">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2 font-medium">Validator</th>
              <th className="px-3 py-2 text-right font-medium">Voting power</th>
              <th className="px-3 py-2 text-right font-medium">Commission</th>
              <th className="px-3 py-2 text-right font-medium">My stake</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filteredValidators.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-zinc-500">
                  No validators match your filters.
                </td>
              </tr>
            ) : (
              filteredValidators.map((v) => {
                const tokens = BigInt(v.tokens || "0");
                const vpPct =
                  bondedTokens > BigInt(0) && v.status === "BOND_STATUS_BONDED" && !v.jailed
                    ? Number((tokens * BigInt(10_000)) / bondedTokens) / 100
                    : null;
                const myDel = delegationByValidator.get(v.operator_address);
                const myReward = rewardByValidator.get(v.operator_address) ?? BigInt(0);
                const status =
                  v.jailed
                    ? { label: "Jailed", color: "bg-red-500/10 text-red-400" }
                    : v.status !== "BOND_STATUS_BONDED"
                    ? { label: "Inactive", color: "bg-zinc-500/10 text-zinc-400" }
                    : null;
                const formOpenHere = openForm?.operatorAddress === v.operator_address;
                const activeMode = formOpenHere ? openForm!.mode : null;
                const actionBtn = (mode: DelegateMode, label: string, tone: "neutral" | "danger" | "primary") => {
                  const active = activeMode === mode;
                  const base = "rounded-md border px-2 py-1 text-[11px]";
                  const cls =
                    tone === "danger"
                      ? active
                        ? `${base} border-red-700 bg-red-900/30 text-red-300`
                        : `${base} border-red-800/60 text-red-400 hover:bg-red-900/20`
                      : tone === "primary"
                      ? active
                        ? "sd-btn sd-btn-primary !px-3 !py-1 !text-xs ring-2 ring-indigo-400/60"
                        : "sd-btn sd-btn-primary !px-3 !py-1 !text-xs"
                      : active
                      ? `${base} border-indigo-500/60 bg-indigo-500/10 text-indigo-300`
                      : `${base} border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:text-white`;
                  return (
                    <button
                      key={mode}
                      onClick={() => toggleForm(v, mode)}
                      disabled={!address || (mode === "delegate" && !myDel ? v.jailed : false)}
                      className={cls}
                    >
                      {label}
                    </button>
                  );
                };
                return (
                  <Fragment key={v.operator_address}>
                    <tr className="border-b border-zinc-900 last:border-0 hover:bg-zinc-900/30">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-zinc-200">
                            {v.description.moniker || v.operator_address.slice(0, 18)}
                          </span>
                          {status && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.color}`}>
                              {status.label}
                            </span>
                          )}
                        </div>
                        {v.description.website && (
                          <a
                            href={v.description.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] text-indigo-400/80 hover:text-indigo-300"
                          >
                            {v.description.website.replace(/^https?:\/\//, "")}
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-zinc-300">
                        {vpPct !== null ? `${vpPct.toFixed(2)}%` : "—"}
                        <div className="text-[10px] text-zinc-500">
                          {formatSpark(tokens, { maxFractionDigits: 0 })}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-zinc-300">
                        {formatDecPercent(v.commission.commission_rates.rate)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-zinc-300">
                        {myDel ? (
                          <>
                            <div>{formatSpark(myDel.balance.amount)}</div>
                            {myReward > BigInt(0) && (
                              <div className="text-[10px] text-emerald-400/80">
                                +{formatSpark(myReward)} rewards
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {myDel ? (
                            <>
                              {actionBtn("delegate", "Add", "neutral")}
                              {actionBtn("redelegate", "Move", "neutral")}
                              {actionBtn("undelegate", "Unbond", "danger")}
                            </>
                          ) : (
                            actionBtn("delegate", "Delegate", "primary")
                          )}
                        </div>
                      </td>
                    </tr>
                    {formOpenHere && (
                      <tr className="border-b border-zinc-900 bg-zinc-950/40">
                        <td colSpan={5} className="px-3 py-3 sm:px-4 sm:py-4">
                          <DelegateForm
                            key={`${v.operator_address}-${openForm!.mode}`}
                            validator={v}
                            initialMode={openForm!.mode}
                            allValidators={validators}
                            availableBalance={balance}
                            myDelegation={myDel}
                            params={params}
                            onCancel={() => setOpenForm(null)}
                            onSuccess={() => {
                              setOpenForm(null);
                              fetchAll();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

function StatTile({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix: string;
}) {
  return (
    <div className="rounded-xl sd-hull-tile px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-base font-semibold text-zinc-100" title={`${value} ${suffix}`}>
        {value}
        <span className="ml-1 text-xs font-normal text-zinc-500">{suffix}</span>
      </div>
    </div>
  );
}
