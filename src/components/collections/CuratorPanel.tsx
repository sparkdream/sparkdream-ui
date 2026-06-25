"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getBondedRole,
  getBondedRoleConfig,
  getCollectParams,
  getCuratorActivity,
  listCurationReviewsByCurator,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { RepMsgTypeUrls } from "@/lib/tx";
import { timeAgo } from "@/lib/utils";
import NumberInput from "@/components/NumberInput";
import {
  RoleType,
  BondedRoleStatus,
  BONDED_ROLE_STATUS_LABELS,
} from "@/types/rep";
import type { BondedRole, BondedRoleConfig } from "@/types/rep";
import {
  CurationVerdict,
  CURATION_VERDICT_LABELS,
} from "@/types/collect";
import type { CuratorActivity, CurationReview } from "@/types/collect";

const CURATOR_ROLE = RoleType.COLLECT_CURATOR;

function formatAmount(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

// Render unbond_completion_time (unix seconds) as a compact countdown.
function formatCooldownRemaining(completionUnix: string): string {
  if (!completionUnix || completionUnix === "0") return "";
  const n = parseInt(completionUnix, 10);
  if (!Number.isFinite(n) || n <= 0) return "";
  const remaining = n - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return "matured";
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Read a collect param (LCD returns numbers as decimal strings).
function strParam(params: Record<string, unknown> | null, key: string): string | null {
  const raw = params?.[key];
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return null;
}

export default function CuratorPanel() {
  const { address, connected, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const cannotBond = address ? isMember === false : false;

  const [bond, setBond] = useState<BondedRole | null>(null);
  const [config, setConfig] = useState<BondedRoleConfig | null>(null);
  const [params, setParams] = useState<Record<string, unknown> | null>(null);
  const [activity, setActivity] = useState<CuratorActivity | null>(null);
  const [reviews, setReviews] = useState<CurationReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCurator, setIsCurator] = useState(false);

  const [showBondForm, setShowBondForm] = useState(false);
  const [bondAmount, setBondAmount] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!address) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const [bondRes, configRes, paramsRes] = await Promise.all([
        getBondedRole(CURATOR_ROLE, address).catch(() => null),
        getBondedRoleConfig(CURATOR_ROLE).catch(() => null),
        getCollectParams().catch(() => null),
      ]);
      setConfig(configRes?.bonded_role_config ?? null);
      setParams(paramsRes?.params ?? null);

      if (bondRes) {
        setIsCurator(true);
        setBond(bondRes.bonded_role);
        const [actRes, reviewsRes] = await Promise.all([
          getCuratorActivity(address).catch(() => null),
          listCurationReviewsByCurator(address, { limit: "50", reverse: true }).catch(() => null),
        ]);
        setActivity(actRes?.curator_activity ?? null);
        setReviews(reviewsRes?.reviews ?? []);
      } else {
        setIsCurator(false);
        setBond(null);
        setActivity(null);
        setReviews([]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load curator data";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setIsCurator(false);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const bondTx = async (typeUrl: string, amountUdream: string, key: string) => {
    if (!address) return;
    setActionLoading(key);
    try {
      await signAndBroadcast([{
        typeUrl,
        value: { creator: address, roleType: CURATOR_ROLE, amount: amountUdream },
      }]);
      setBondAmount("");
      setShowBondForm(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleBond = () => {
    if (!bondAmount.trim()) return;
    const amount = (BigInt(Math.floor(parseFloat(bondAmount) * 1_000_000))).toString();
    bondTx(RepMsgTypeUrls.BondRole, amount, "bond");
  };

  const handleUnbond = () => {
    if (!bondAmount.trim()) return;
    const amount = (BigInt(Math.floor(parseFloat(bondAmount) * 1_000_000))).toString();
    bondTx(RepMsgTypeUrls.UnbondRole, amount, "unbond");
  };

  // Cancel an in-flight unbond, restoring the pending amount to active bond
  // without waiting out the cooldown (pending is only an earmark). Cancels the
  // full pending amount; the amount field is the cap.
  const handleCancelUnbond = () => {
    if (!bond?.pending_unbond_amount || bond.pending_unbond_amount === "0") return;
    bondTx(RepMsgTypeUrls.CancelUnbondRole, bond.pending_unbond_amount, "cancel-unbond");
  };

  if (!connected) {
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="h-32 animate-pulse sd-hull-tile rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchData} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  const bondStatus = bond?.bond_status ?? "";
  const currentBond = bond?.current_bond ?? "0";
  const totalCommitted = bond?.total_committed_bond ?? "0";
  const availableBond = bond
    ? (BigInt(currentBond) - BigInt(totalCommitted)).toString()
    : "0";

  const minTrust = strParam(params, "min_curator_trust_level");
  const minAgeBlocks = strParam(params, "min_curator_age_blocks");

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Curator status</h2>

      {!isCurator && (
        <div className="sd-hull-tile rounded-xl p-6">
          <p className="mb-2 text-sm text-zinc-400">
            You are not a curator. Bond DREAM to become a collection curator and help rate which
            public collections deserve to be surfaced.
          </p>
          <div className="mb-4 space-y-0.5 text-xs text-zinc-500">
            {config && <p>Minimum bond: {formatAmount(config.min_bond)} DREAM</p>}
            {minTrust && minTrust !== "TRUST_LEVEL_UNSPECIFIED" && (
              <p>Minimum trust: {minTrust.replace("TRUST_LEVEL_", "")}</p>
            )}
            {minAgeBlocks && minAgeBlocks !== "0" && (
              <p>Must stay bonded {Number(minAgeBlocks).toLocaleString()} blocks before your first review counts.</p>
            )}
          </div>
          {cannotBond && (
            <p className="mb-3 text-xs text-zinc-500">
              Bonding as a curator is open to members. Ask any existing{" "}
              <Link href="/contribute?view=members" className="text-indigo-400 underline hover:text-indigo-300">
                member
              </Link>{" "}
              to invite you in.
            </p>
          )}
          {!showBondForm ? (
            <button
              type="button"
              onClick={() => setShowBondForm(true)}
              disabled={cannotBond}
              title={cannotBond ? "Only existing members can become a curator" : undefined}
              className="sd-btn sd-btn-primary"
            >
              Become a curator
            </button>
          ) : (
            <div className="space-y-3">
              <NumberInput
                value={bondAmount}
                onChange={(e) => setBondAmount(e.target.value)}
                placeholder="Amount (DREAM)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleBond}
                  disabled={!bondAmount.trim() || actionLoading === "bond" || cannotBond}
                  className="sd-btn sd-btn-primary"
                >
                  {actionLoading === "bond" ? "Bonding..." : "Bond"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowBondForm(false)}
                  className="sd-btn sd-btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isCurator && (
        <>
          {/* Bond overview */}
          <div className="sd-hull-tile rounded-xl p-5">
            {bondStatus === BondedRoleStatus.UNBONDING && bond?.unbond_completion_time && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-xs text-amber-300">
                <span>
                  Unbond in progress. <b>{formatAmount(bond.pending_unbond_amount || "0")} DREAM</b> stays
                  locked + slashable for {formatCooldownRemaining(bond.unbond_completion_time) || "—"}.
                  Curators cannot rate collections while unbonding.
                </span>
                {bond.pending_unbond_amount && bond.pending_unbond_amount !== "0" && (
                  <button
                    type="button"
                    onClick={handleCancelUnbond}
                    disabled={!!actionLoading}
                    title="Return the pending amount to active bond without waiting out the cooldown"
                    className="shrink-0 rounded-md border border-amber-700/60 px-2.5 py-1 font-medium text-amber-200 hover:bg-amber-900/30 disabled:opacity-50"
                  >
                    {actionLoading === "cancel-unbond" ? "Cancelling..." : "Cancel unbond"}
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-zinc-500">Status</p>
                <p className={`font-medium ${
                  bondStatus === BondedRoleStatus.NORMAL ? "text-emerald-400"
                    : bondStatus === BondedRoleStatus.RECOVERY ? "text-amber-400"
                      : bondStatus === BondedRoleStatus.UNBONDING ? "text-amber-400"
                        : "text-red-400"
                }`}>
                  {BONDED_ROLE_STATUS_LABELS[bondStatus] || bondStatus}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Current bond</p>
                <p className="font-medium text-zinc-200">{formatAmount(currentBond)} DREAM</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Available</p>
                <p className="font-medium text-zinc-200">{formatAmount(availableBond)} DREAM</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Rewards</p>
                <p className="font-medium text-amber-400">{formatAmount(bond?.cumulative_rewards || "0")} DREAM</p>
              </div>
            </div>

            {config && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800/60 pt-3 text-xs text-zinc-500 sm:grid-cols-4">
                <div>
                  <span className="text-zinc-600">Min bond: </span>
                  <span className="text-zinc-400">{formatAmount(config.min_bond)} DREAM</span>
                </div>
                <div>
                  <span className="text-zinc-600">Demotion floor: </span>
                  <span className="text-zinc-400">{formatAmount(config.demotion_threshold)} DREAM</span>
                </div>
                {config.unbond_cooldown && config.unbond_cooldown !== "0" && (
                  <div>
                    <span className="text-zinc-600">Unbond cooldown: </span>
                    <span className="text-zinc-400">{Math.round(parseInt(config.unbond_cooldown, 10) / 86400)}d</span>
                  </div>
                )}
                {bond?.registered_at && (
                  <div>
                    <span className="text-zinc-600">Bonded since block: </span>
                    <span className="text-zinc-400">{bond.registered_at}</span>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              {!showBondForm ? (
                <button
                  onClick={() => setShowBondForm(true)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                >
                  Bond / unbond
                </button>
              ) : (
                <div className="flex w-full flex-wrap items-center gap-2">
                  <NumberInput
                    value={bondAmount}
                    onChange={(e) => setBondAmount(e.target.value)}
                    placeholder="Amount (DREAM)"
                    wrapperClassName="w-32"
                    className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleBond}
                    disabled={!bondAmount.trim() || !!actionLoading || cannotBond}
                    className="sd-btn sd-btn-primary"
                  >
                    {actionLoading === "bond" ? "..." : "Bond"}
                  </button>
                  <button
                    onClick={handleUnbond}
                    disabled={!bondAmount.trim() || !!actionLoading}
                    className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-700 disabled:opacity-50"
                  >
                    {actionLoading === "unbond" ? "..." : "Unbond"}
                  </button>
                  <button
                    onClick={() => setShowBondForm(false)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Review activity */}
          {activity && (
            <div className="sd-hull-tile rounded-xl p-5">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Review activity</h3>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-zinc-500">Total reviews</p>
                  <p className="text-zinc-200">{activity.total_reviews}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Challenged</p>
                  <p className="text-zinc-200">{activity.challenged_reviews}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Upheld</p>
                  <p className="text-emerald-400">{activity.upheld_reviews}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Overturned</p>
                  <p className="text-red-400">{activity.overturned_reviews}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Upheld streak</p>
                  <p className="text-zinc-200">{activity.consecutive_upheld}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Overturn streak</p>
                  <p className={activity.consecutive_overturns !== "0" ? "text-amber-400" : "text-zinc-200"}>
                    {activity.consecutive_overturns}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* My reviews */}
          <div className="sd-hull-tile rounded-xl p-5">
            <h3 className="mb-3 text-sm font-semibold text-zinc-300">My reviews</h3>
            {reviews.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No reviews yet. Open a public collection and submit a verdict to start curating.
              </p>
            ) : (
              <ul className="space-y-2">
                {reviews.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-zinc-300">Collection #{r.collection_id}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          r.verdict === CurationVerdict.UP
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-red-500/15 text-red-400"
                        }`}>
                          {CURATION_VERDICT_LABELS[r.verdict] || r.verdict}
                        </span>
                        {r.challenged && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                            {r.overturned ? "Overturned" : "Challenged"}
                          </span>
                        )}
                      </div>
                      {r.comment && <p className="mt-0.5 truncate text-xs text-zinc-500">{r.comment}</p>}
                      {r.tags?.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.tags.map((t) => (
                            <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {r.created_at && (
                      <span className="shrink-0 text-[10px] text-zinc-600">{timeAgo(r.created_at)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
