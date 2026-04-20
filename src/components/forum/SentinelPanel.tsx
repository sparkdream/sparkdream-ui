"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getSentinelStatus,
  getSentinelActivity,
  getSentinelBondCommitment,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { ForumMsgTypeUrls } from "@/lib/tx";
import type { SentinelActivity } from "@/types/forum";
import { SENTINEL_BOND_STATUS_LABELS, SentinelBondStatus } from "@/types/forum";

function formatAmount(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

export default function SentinelPanel() {
  const { address, signAndBroadcast } = useWallet();

  const [bondStatus, setBondStatus] = useState<string>("");
  const [currentBond, setCurrentBond] = useState<string>("0");
  const [accuracyRate, setAccuracyRate] = useState<string>("0");
  const [availableBond, setAvailableBond] = useState<string>("0");
  const [totalCommitted, setTotalCommitted] = useState<string>("0");
  const [activity, setActivity] = useState<SentinelActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSentinel, setIsSentinel] = useState(false);

  // Bond/unbond form
  const [showBondForm, setShowBondForm] = useState(false);
  const [bondAmount, setBondAmount] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);

      const statusRes = await getSentinelStatus(address).catch(() => null);
      if (statusRes) {
        setIsSentinel(true);
        setBondStatus(statusRes.bond_status || "");
        setCurrentBond(statusRes.current_bond || "0");
        setAccuracyRate(statusRes.accuracy_rate || "0");

        const [commitRes, activityRes] = await Promise.all([
          getSentinelBondCommitment(address).catch(() => null),
          getSentinelActivity(address).catch(() => null),
        ]);

        if (commitRes) {
          setAvailableBond(commitRes.available_bond || "0");
          setTotalCommitted(commitRes.total_committed_bond || "0");
        }
        if (activityRes) {
          setActivity(activityRes.sentinel_activity);
        }
      } else {
        setIsSentinel(false);
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
        typeUrl: ForumMsgTypeUrls.BondSentinel,
        value: {
          creator: address,
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
        typeUrl: ForumMsgTypeUrls.UnbondSentinel,
        value: {
          creator: address,
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
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
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

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">Sentinel Status</h2>

      {!isSentinel ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <p className="mb-4 text-sm text-zinc-400">
            You are not a sentinel. Bond DREAM tokens to become a sentinel and help moderate the forum.
          </p>
          {!showBondForm ? (
            <button
              onClick={() => setShowBondForm(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
            >
              Become a Sentinel
            </button>
          ) : (
            <div className="space-y-3">
              <input
                value={bondAmount}
                onChange={(e) => setBondAmount(e.target.value)}
                placeholder="Amount (DREAM)"
                type="number"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleBond}
                  disabled={!bondAmount.trim() || actionLoading === "bond"}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                >
                  {actionLoading === "bond" ? "Bonding..." : "Bond"}
                </button>
                <button
                  onClick={() => setShowBondForm(false)}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
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
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-zinc-500">Status</p>
                <p className={`font-medium ${
                  bondStatus === SentinelBondStatus.NORMAL ? "text-emerald-400"
                    : bondStatus === SentinelBondStatus.RECOVERY ? "text-amber-400"
                      : "text-red-400"
                }`}>
                  {SENTINEL_BOND_STATUS_LABELS[bondStatus] || bondStatus}
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
                <p className="font-medium text-zinc-200">{accuracyRate}%</p>
              </div>
            </div>

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
                  <input
                    value={bondAmount}
                    onChange={(e) => setBondAmount(e.target.value)}
                    placeholder="Amount (DREAM)"
                    type="number"
                    className="w-32 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                  />
                  <button
                    onClick={handleBond}
                    disabled={!bondAmount.trim() || !!actionLoading}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
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
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
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
                  <p className="text-xs text-zinc-500">Rewards</p>
                  <p className="text-amber-400">{formatAmount(activity.cumulative_rewards)} DREAM</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
