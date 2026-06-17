"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getBondedRole,
  getBondedRoleConfig,
  getForumParams,
  getSentinelActivity,
  listHideRecords,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useCommonsCouncil } from "@/hooks/useCommonsCouncil";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { ForumMsgTypeUrls, RepMsgTypeUrls } from "@/lib/tx";
import CopyableAddress from "@/components/CopyableAddress";
import type { ForumParams, HideRecord, SentinelActivity } from "@/types/forum";
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

// Render unbond_completion_time (unix seconds) as a human-friendly "Xd Yh"
// countdown. Empty when already matured or unset.
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

// Sentinel moderation params use "0 = unset → compile-time default" semantics
// (chain commit ca0508c) so existing chains keep today's behavior with no
// migration. These resolvers mirror that, flagging the default so the UI can
// label it. The defaults must match the chain's constants.
function intWithDefault(raw: string | undefined, def: number): { value: number; isDefault: boolean } {
  const n = raw ? parseInt(raw, 10) : 0;
  if (Number.isFinite(n) && n > 0) return { value: n, isDefault: false };
  return { value: def, isDefault: true };
}

// DREAM-denominated (uDREAM math.Int string); default given in whole DREAM.
function dreamWithDefault(raw: string | undefined, defDream: number): { display: string; isDefault: boolean } {
  if (raw && raw !== "0") return { display: formatAmount(raw), isDefault: false };
  return { display: defDream.toLocaleString(), isDefault: true };
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
  const isMember = useIsRepMember(address);
  const cannotBond = address ? isMember === false : false;
  const { isOpsCommitteeMember } = useCommonsCouncil(address);

  const [bond, setBond] = useState<BondedRole | null>(null);
  const [config, setConfig] = useState<BondedRoleConfig | null>(null);
  const [activity, setActivity] = useState<SentinelActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSentinel, setIsSentinel] = useState(false);

  const [showBondForm, setShowBondForm] = useState(false);
  const [bondAmount, setBondAmount] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // All currently-hidden posts (one HideRecord each) + sentinel self-correct
  // window (in seconds, from forum params). Listed via the global hide_record
  // endpoint; we filter client-side for the two views below. Fine for current
  // forum size — if hide volume grows the chain should add secondary indexes
  // (`HideRecordsBySentinel`, `HideRecordsByExpiry`).
  const [allHides, setAllHides] = useState<HideRecord[]>([]);
  const [unhideWindow, setUnhideWindow] = useState<number | null>(null);
  const [forumParams, setForumParams] = useState<ForumParams | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

      // Sentinel-only bits: bond + activity.
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

      // Hide records + sentinel-unhide-window are fetched for everyone — both
      // the sentinel's "My recent hides" view and the COC "Override queue"
      // view derive from this data, and a connected user can be a COC member
      // without being a sentinel.
      const [hidesRes, paramsRes] = await Promise.all([
        listHideRecords({ limit: "200" }).catch(() => null),
        getForumParams().catch(() => null),
      ]);
      const hides = [...(hidesRes?.hide_record ?? [])];
      // Most-recent first so actionable rows surface at the top.
      hides.sort((a, b) => Number(BigInt(b.hidden_at) - BigInt(a.hidden_at)));
      setAllHides(hides);
      setForumParams(paramsRes?.params ?? null);
      const winRaw = paramsRes?.params?.sentinel_unhide_window;
      let win: number | null = null;
      if (typeof winRaw === "string") {
        const n = parseInt(winRaw, 10);
        if (Number.isFinite(n) && n > 0) win = n;
      } else if (typeof winRaw === "number" && Number.isFinite(winRaw) && winRaw > 0) {
        win = winRaw;
      }
      setUnhideWindow(win);
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

  const handleUnhide = async (postId: string) => {
    if (!address) return;
    setActionLoading(`unhide-${postId}`);
    setActionError(null);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.UnhidePost,
        value: {
          creator: address,
          postId: BigInt(postId),
        },
      }]);
      await fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Unhide of post #${postId} failed: ${msg}`);
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

  // Split allHides into the two views: mine (sentinel self-correct) and
  // past-window (COC override queue). Empty hidden_at or unknown window
  // are treated as "past window" so the COC always has a path to act.
  const nowSec = Math.floor(Date.now() / 1000);
  const myHides = allHides.filter((r) => r.sentinel !== "" && r.sentinel === address);
  const pastWindowHides = allHides.filter((r) => {
    // Gov-authority hides (empty sentinel marker) are council-domain from the
    // moment they're created: there's no sentinel self-correct window for them,
    // so they belong in the override queue regardless of age. Without this they
    // never surfaced anywhere in the UI until they happened to age past the
    // (unrelated) sentinel window.
    if (r.sentinel === "") return true;
    if (unhideWindow === null) return true;
    const hiddenAt = Number(r.hidden_at);
    if (!Number.isFinite(hiddenAt) || hiddenAt <= 0) return true;
    return nowSec - hiddenAt > unhideWindow;
  });
  const bondStatus = bond?.bond_status ?? "";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Sentinel Status</h2>

      {!isSentinel && (
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
          {cannotBond && (
            <p className="mb-3 text-xs text-zinc-500">
              Want to become a Sentinel? Bonding as a Sentinel is open to members. Ask any existing{" "}
              <Link href="/contribute?view=members" className="text-indigo-400 hover:text-indigo-300 underline">
                member
              </Link>
              {" "}to invite you in. We&apos;d love to have you help moderate.
            </p>
          )}
          {!showBondForm ? (
            <button
              type="button"
              onClick={() => setShowBondForm(true)}
              disabled={cannotBond}
              title={cannotBond ? "Only existing members can become a Sentinel" : undefined}
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
                  disabled={!bondAmount.trim() || actionLoading === "bond" || cannotBond}
                  title={cannotBond ? "Only existing members can become a Sentinel" : undefined}
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

      {isSentinel && (
        <>
          {/* Bond overview */}
          <div className="sd-hull-tile rounded-xl p-5">
            {/* Per chain commit 6d7e7ce, MsgUnbondRole now queues a withdrawal
                that stays slashable until unbond_completion_time and flips
                bond_status to UNBONDING. The owning module refuses authority
                during that window. Surface both the chip and the cooldown
                here so sentinels aren't surprised when their actions bounce. */}
            {bondStatus === BondedRoleStatus.UNBONDING && bond?.unbond_completion_time && (
              <div className="mb-3 rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-xs text-amber-300">
                Unbond in progress. <b>{formatAmount(bond.pending_unbond_amount || "0")} DREAM</b> stays locked + slashable for {formatCooldownRemaining(bond.unbond_completion_time) || "—"}. Sentinel actions are refused until cooldown matures.
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
                {config.unbond_cooldown && config.unbond_cooldown !== "0" && (
                  <div>
                    <span className="text-zinc-600">Unbond cooldown: </span>
                    <span className="text-zinc-400">
                      {Math.round(parseInt(config.unbond_cooldown, 10) / 86400)}d
                    </span>
                  </div>
                )}
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
                    disabled={!bondAmount.trim() || !!actionLoading || cannotBond}
                    title={cannotBond ? "Only existing members can bond" : undefined}
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

          {/* Moderation limits (chain commit ca0508c). Per-epoch rate caps and
              per-action slash are Operations-Committee tunable; lock floors are
              governance-only. A param of 0 means unset → the chain default,
              flagged here so a sentinel knows whether it was tuned. */}
          {forumParams && (() => {
            const hides = intWithDefault(forumParams.max_hides_per_epoch, 50);
            const locks = intWithDefault(forumParams.max_sentinel_locks_per_epoch, 5);
            const moves = intWithDefault(forumParams.max_sentinel_moves_per_epoch, 10);
            const slash = dreamWithDefault(forumParams.sentinel_slash_amount, 100);
            const lockMult = intWithDefault(forumParams.lock_bond_multiplier, 4);
            const lockBacking = dreamWithDefault(forumParams.lock_backing_amount, 20000);
            const lockTier = intWithDefault(forumParams.lock_min_rep_tier, 4);
            const def = (isDefault: boolean) =>
              isDefault ? <span className="text-zinc-600"> (default)</span> : null;
            return (
              <div className="sd-hull-tile rounded-xl p-5">
                <h3 className="text-sm font-semibold text-zinc-300">Moderation limits</h3>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Per-day action caps and the per-action bond slash, plus the
                  thread-lock eligibility floor. Enforced chain-side.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <p className="text-zinc-500">Hides / day</p>
                    <p className="text-zinc-200">{hides.value.toLocaleString()}{def(hides.isDefault)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Locks / day</p>
                    <p className="text-zinc-200">{locks.value.toLocaleString()}{def(locks.isDefault)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Moves / day</p>
                    <p className="text-zinc-200">{moves.value.toLocaleString()}{def(moves.isDefault)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Slash / overturn</p>
                    <p className="text-amber-400">{slash.display} DREAM{def(slash.isDefault)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Lock bond</p>
                    <p className="text-zinc-200">{lockMult.value}&times; min bond{def(lockMult.isDefault)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Lock backing</p>
                    <p className="text-zinc-200">{lockBacking.display} DREAM{def(lockBacking.isDefault)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Lock rep tier</p>
                    <p className="text-zinc-200">{lockTier.value}{def(lockTier.isDefault)}</p>
                  </div>
                </div>
              </div>
            );
          })()}

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
                  <p className="text-xs text-zinc-500">Pins Upheld</p>
                  <p className="text-emerald-400">{activity.upheld_pins}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Pins Overturned</p>
                  <p className="text-red-400">{activity.overturned_pins}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Pending Hides</p>
                  <p className="text-zinc-200">{activity.pending_hide_count}</p>
                </div>
              </div>
            </div>
          )}

          {/* Hides by this sentinel — self-correct via MsgUnhidePost while still
              inside params.sentinel_unhide_window. Past the window the chain
              rejects with ErrUnhideWindowExpired; we surface that as a tooltip
              and disable the button so it's obvious why it's no longer
              clickable rather than silently failing on submit. */}
          <div className="sd-hull-tile rounded-xl p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-zinc-300">My recent hides</h3>
              {unhideWindow !== null && (
                <span className="text-xs text-zinc-500">
                  Self-correct window: {formatDuration(unhideWindow)}
                </span>
              )}
            </div>
            {actionError && (
              <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-400">
                <span className="break-all">{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  className="shrink-0 text-red-300 hover:text-red-100"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}
            {myHides.length === 0 ? (
              <p className="text-xs text-zinc-500">No active hides on file.</p>
            ) : (
              <ul className="space-y-2">
                {myHides.map((r) => {
                  const hiddenAt = Number(r.hidden_at);
                  const now = Math.floor(Date.now() / 1000);
                  const elapsed = now - hiddenAt;
                  const inWindow = unhideWindow !== null && elapsed <= unhideWindow;
                  const remaining = unhideWindow !== null ? unhideWindow - elapsed : 0;
                  return (
                    <li
                      key={r.post_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-zinc-300">#{r.post_id}</span>
                          {r.reason_code && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                              {r.reason_code}
                            </span>
                          )}
                        </div>
                        {r.reason_text && (
                          <p className="mt-0.5 truncate text-xs text-zinc-500">{r.reason_text}</p>
                        )}
                        <p className="mt-0.5 text-[10px] text-zinc-600">
                          Hidden {formatDuration(elapsed)} ago
                          {inWindow
                            ? ` · ${formatDuration(remaining)} remaining to self-correct`
                            : " · self-correct window expired"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnhide(r.post_id)}
                        disabled={!inWindow || actionLoading === `unhide-${r.post_id}`}
                        title={
                          inWindow
                            ? "Reverse this hide and release the committed bond"
                            : "Past the self-correct window; only a Commons Ops Committee proposal can unhide now"
                        }
                        className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {actionLoading === `unhide-${r.post_id}` ? "Unhiding…" : "Unhide"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* COC override queue: hides past the sentinel self-correct window
          (only the COC / governance can now unhide them). Visible to Commons
          Operations Committee members regardless of whether they're sentinels;
          each "Propose unhide" link deep-links into /governance with the
          create-proposal form pre-opened and the post_id pre-filled. */}
      {isOpsCommitteeMember && (
        <div className="sd-hull-tile rounded-xl p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-zinc-300">Council override queue</h3>
            <span className="text-xs text-zinc-500">
              Hides past the self-correct window
            </span>
          </div>
          {pastWindowHides.length === 0 ? (
            <p className="text-xs text-zinc-500">No hides past the self-correct window.</p>
          ) : (
            <ul className="space-y-2">
              {pastWindowHides.map((r) => {
                const hiddenAt = Number(r.hidden_at);
                const elapsed = nowSec - hiddenAt;
                return (
                  <li
                    key={r.post_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-zinc-300">#{r.post_id}</span>
                        {r.reason_code && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            {r.reason_code}
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-500">
                          {r.sentinel === "" ? (
                            "council hide"
                          ) : (
                            <>by <CopyableAddress address={r.sentinel} /></>
                          )}
                        </span>
                      </div>
                      {r.reason_text && (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">{r.reason_text}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-zinc-600">
                        Hidden {formatDuration(elapsed)} ago
                      </p>
                    </div>
                    <Link
                      href={`/governance?group=${encodeURIComponent("Commons Operations Committee")}&action=unhide-post&post_id=${r.post_id}`}
                      className="shrink-0 rounded-lg border border-indigo-500/30 bg-indigo-600/10 px-3 py-1.5 text-xs text-indigo-300 transition-colors hover:border-indigo-400 hover:text-indigo-200"
                      title="Open a Commons Operations Committee proposal to unhide this post"
                    >
                      Propose unhide
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Approximate a seconds-duration as a compact human-readable string.
// Used for hide-record timestamps and the sentinel unhide window.
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
