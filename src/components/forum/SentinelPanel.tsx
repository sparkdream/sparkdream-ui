"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getBondedRole,
  getBondedRoleConfig,
  getSentinelActivity,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { RepMsgTypeUrls } from "@/lib/tx";
import type { SentinelActivity } from "@/types/forum";
import {
  RoleType,
  BondedRoleStatus,
  BONDED_ROLE_STATUS_LABELS,
} from "@/types/rep";
import type { BondedRole, BondedRoleConfig } from "@/types/rep";
import NumberInput from "@/components/NumberInput";

const SENTINEL_ROLE = RoleType.FORUM_SENTINEL;

function formatAmount(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

function accuracyRate(activity: SentinelActivity | null): string {
  if (!activity) return "—";
  const upheld = BigInt(activity.upheld_hides || "0");
  const overturned = BigInt(activity.overturned_hides || "0");
  const total = upheld + overturned;
  if (total === BigInt(0)) return "—";
  const pct = (upheld * BigInt(10000)) / total;
  return `${(Number(pct) / 100).toFixed(1)}%`;
}

export default function SentinelPanel() {
  const { address, signAndBroadcast } = useWallet();

  const [bond, setBond] = useState<BondedRole | null>(null);
  const [config, setConfig] = useState<BondedRoleConfig | null>(null);
  const [activity, setActivity] = useState<SentinelActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSentinel, setIsSentinel] = useState(false);

  const [showBondForm, setShowBondForm] = useState(false);
  const [bondAmount, setBondAmount] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);

      const [bondRes, configRes] = await Promise.all([
        getBondedRole(SENTINEL_ROLE, address).catch(() => null),
        getBondedRoleConfig(SENTINEL_ROLE).catch(() => null),
      ]);
      setConfig(configRes?.bonded_role_config ?? null);

      if (bondRes) {
        setIsSentinel(true);
        setBond(bondRes.bonded_role);
        const activityRes = await getSentinelActivity(address).catch(() => null);
        setActivity(activityRes?.sentinel_activity ?? null);
      } else {
        setIsSentinel(false);
        setBond(null);
        setActivity(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load sentinel data";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setIsSentinel(false);
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

  const handleBond = async () => {
    if (!address || !bondAmount.trim()) return;
    setActionLoading("bond");
    try {
      const amountUdream = (BigInt(Math.floor(parseFloat(bondAmount) * 1_000_000))).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.BondRole,
        value: {
          creator: address,
          roleType: SENTINEL_ROLE,
          amount: amountUdream,
        },
      }]);
      setBondAmount("");
      setShowBondForm(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bond failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnbond = async () => {
    if (!address || !bondAmount.trim()) return;
    setActionLoading("unbond");
    try {
      const amountUdream = (BigInt(Math.floor(parseFloat(bondAmount) * 1_000_000))).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.UnbondRole,
        value: {
          creator: address,
          roleType: SENTINEL_ROLE,
          amount: amountUdream,
        },
      }]);
      setBondAmount("");
      setShowBondForm(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unbond failed");
    } finally {
      setActionLoading(null);
    }
  };

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

  const currentBond = bond?.current_bond ?? "0";
  const totalCommitted = bond?.total_committed_bond ?? "0";
  const availableBond = bond
    ? (BigInt(currentBond) - BigInt(totalCommitted)).toString()
    : "0";
  const bondStatus = bond?.bond_status ?? "";

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">Sentinel Status</h2>

      {!isSentinel ? (
        <div className="sd-hull-tile rounded-xl p-6">
          <p className="mb-2 text-sm text-zinc-400">
            You are not a sentinel. Bond DREAM tokens to become a sentinel and help moderate the forum.
          </p>
          {config && (
            <p className="mb-4 text-xs text-zinc-500">
              Minimum bond: {formatAmount(config.min_bond)} DREAM
              {config.min_trust_level && config.min_trust_level !== "TRUST_LEVEL_UNSPECIFIED" &&
                ` · Min trust: ${config.min_trust_level.replace("TRUST_LEVEL_", "")}`}
            </p>
          )}
          {!showBondForm ? (
            <button
              type="button"
              onClick={() => setShowBondForm(true)}
              className="sd-btn sd-btn-primary"
            >
              Become a Sentinel
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
                  disabled={!bondAmount.trim() || actionLoading === "bond"}
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
      ) : (
        <div className="space-y-4">
          {/* Bond overview */}
          <div className="sd-hull-tile rounded-xl p-5">
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-zinc-500">Status</p>
                <p className={`font-medium ${
                  bondStatus === BondedRoleStatus.NORMAL ? "text-emerald-400"
                    : bondStatus === BondedRoleStatus.RECOVERY ? "text-amber-400"
                      : "text-red-400"
                }`}>
                  {BONDED_ROLE_STATUS_LABELS[bondStatus] || bondStatus}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Current Bond</p>
                <p className="font-medium text-zinc-200">{formatAmount(currentBond)} DREAM</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Available</p>
                <p className="font-medium text-zinc-200">{formatAmount(availableBond)} DREAM</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Accuracy</p>
                <p className="font-medium text-zinc-200">{accuracyRate(activity)}</p>
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
                {bond?.cumulative_rewards && bond.cumulative_rewards !== "0" && (
                  <div>
                    <span className="text-zinc-600">Rewards: </span>
                    <span className="text-amber-400">{formatAmount(bond.cumulative_rewards)} DREAM</span>
                  </div>
                )}
                {bond?.last_active_epoch && (
                  <div>
                    <span className="text-zinc-600">Last active epoch: </span>
                    <span className="text-zinc-400">{bond.last_active_epoch}</span>
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
                  Bond / Unbond
                </button>
              ) : (
                <div className="flex w-full items-center gap-2">
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
                    disabled={!bondAmount.trim() || !!actionLoading}
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

          {/* Activity stats */}
          {activity && (
            <div className="sd-hull-tile rounded-xl p-5">
              <h3 className="mb-3 text-sm font-semibold text-zinc-300">Activity</h3>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-zinc-500">Total Hides</p>
                  <p className="text-zinc-200">{activity.total_hides}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Upheld</p>
                  <p className="text-emerald-400">{activity.upheld_hides}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Overturned</p>
                  <p className="text-red-400">{activity.overturned_hides}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Total Locks</p>
                  <p className="text-zinc-200">{activity.total_locks}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Total Moves</p>
                  <p className="text-zinc-200">{activity.total_moves}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Total Pins</p>
                  <p className="text-zinc-200">{activity.total_pins}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Proposals</p>
                  <p className="text-zinc-200">{activity.total_proposals}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Confirmed</p>
                  <p className="text-emerald-400">{activity.confirmed_proposals}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Pending Hides</p>
                  <p className="text-zinc-200">{activity.pending_hide_count}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
