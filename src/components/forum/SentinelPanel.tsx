"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getBondedRole,
  getBondedRoleConfig,
  getForumParams,
  getRepParams,
  getLatestBlockHeight,
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

// Read a uint64 rep param (LCD returns them as decimal strings), falling back
// to the chain's compile-time default when unset/0.
function numParam(params: Record<string, unknown> | null, key: string, def: number): number {
  const raw = params?.[key];
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

// Reward accuracy over the rolling window x/rep actually uses to gate and size
// sentinel rewards (chain commit 00552f4): upheld / decided summed over the last
// `window` reward epochs ending at the current reward epoch (inclusive). Mirrors
// keeper.GetSentinelWindowedAccuracy — ring slots stamped outside that range
// (stale entries, or epochs older than the window) are ignored, so a sentinel
// who stops resolving appeals ages out to zero decided rather than coasting on a
// good lifetime record. The lifetime upheld_*/overturned_* counters are no
// longer used for reward accuracy.
function windowedAccuracy(
  activity: SentinelActivity | null,
  currentEpoch: number,
  window: number,
): { upheld: number; overturned: number; total: number; rate: number | null } {
  const empty = { upheld: 0, overturned: 0, total: 0, rate: null };
  if (!activity?.accuracy_window || window <= 0) return empty;
  const lo = currentEpoch + 1 > window ? currentEpoch - window + 1 : 0;
  let up = 0;
  let ov = 0;
  for (const b of activity.accuracy_window) {
    const e = parseInt(b.epoch, 10);
    if (!Number.isFinite(e) || e < lo || e > currentEpoch) continue;
    up += parseInt(b.upheld || "0", 10) || 0;
    ov += parseInt(b.overturned || "0", 10) || 0;
  }
  const total = up + ov;
  return { upheld: up, overturned: ov, total, rate: total > 0 ? up / total : null };
}

// Per-epoch breakdown of the same window, oldest → newest, with empty epochs
// (no resolved appeals) kept in place so the gaps that drag down a windowed
// rate are visible. One entry per epoch in [currentEpoch - window + 1,
// currentEpoch]; never more than `window` entries.
function accuracySeries(
  activity: SentinelActivity | null,
  currentEpoch: number,
  window: number,
): { epoch: number; upheld: number; overturned: number; total: number }[] {
  if (!activity?.accuracy_window || window <= 0 || currentEpoch < 0) return [];
  const lo = currentEpoch + 1 > window ? currentEpoch - window + 1 : 0;
  const byEpoch = new Map<number, { upheld: number; overturned: number }>();
  for (const b of activity.accuracy_window) {
    const e = parseInt(b.epoch, 10);
    if (!Number.isFinite(e) || e < lo || e > currentEpoch) continue;
    byEpoch.set(e, {
      upheld: parseInt(b.upheld || "0", 10) || 0,
      overturned: parseInt(b.overturned || "0", 10) || 0,
    });
  }
  const out: { epoch: number; upheld: number; overturned: number; total: number }[] = [];
  for (let e = lo; e <= currentEpoch; e++) {
    const v = byEpoch.get(e) ?? { upheld: 0, overturned: 0 };
    out.push({ epoch: e, upheld: v.upheld, overturned: v.overturned, total: v.upheld + v.overturned });
  }
  return out;
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
  // Rep params + chain height drive the reward-accuracy window: the reference
  // reward epoch is height / sentinel_reward_epoch_blocks (NOT the forum epoch),
  // and the window length / min sample come from rep params.
  const [repParams, setRepParams] = useState<Record<string, unknown> | null>(null);
  const [blockHeight, setBlockHeight] = useState<string | null>(null);

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
      const [hidesRes, paramsRes, repParamsRes, heightRes] = await Promise.all([
        listHideRecords({ limit: "200" }).catch(() => null),
        getForumParams().catch(() => null),
        getRepParams().catch(() => null),
        getLatestBlockHeight().catch(() => null),
      ]);
      setRepParams(repParamsRes?.params ?? null);
      setBlockHeight(heightRes ?? null);
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

  // Reward-accuracy window inputs. epochBlocks/window/minAppeals fall back to the
  // chain defaults when rep params are unavailable; the reference reward epoch
  // needs the live height, so accuracy reads "—" until height resolves.
  const epochBlocks = numParam(repParams, "sentinel_reward_epoch_blocks", 14400);
  const accuracyWindowEpochs = numParam(repParams, "sentinel_accuracy_window_epochs", 6);
  const minAppeals = numParam(repParams, "min_appeals_for_accuracy", 10);
  const currentEpoch = blockHeight ? Math.floor(parseInt(blockHeight, 10) / epochBlocks) : null;
  const winAcc = windowedAccuracy(activity, currentEpoch ?? 0, accuracyWindowEpochs);
  const belowSample = winAcc.total > 0 && winAcc.total < minAppeals;

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
                <p className="text-xs text-zinc-500">Reward Accuracy</p>
                <p className="font-medium text-zinc-200">
                  {currentEpoch === null
                    ? "—"
                    : winAcc.rate !== null
                      ? `${(winAcc.rate * 100).toFixed(1)}%`
                      : "—"}
                </p>
                <p className={`text-[10px] ${belowSample ? "text-amber-500" : "text-zinc-600"}`}>
                  {currentEpoch === null
                    ? "loading…"
                    : winAcc.total === 0
                      ? `no decided appeals in last ${accuracyWindowEpochs} epochs`
                      : `${winAcc.total} decided / last ${accuracyWindowEpochs} epochs${
                          belowSample ? ` · need ${minAppeals}` : ""
                        }`}
                </p>
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

            {/* Per-epoch breakdown of the reward-accuracy window. Each bar is one
                reward epoch (oldest → now); green is upheld, red overturned, bar
                height scales with the decided count, and empty epochs show as a
                bare track so an inactivity gap is visible at a glance. */}
            {currentEpoch !== null && (() => {
              const series = accuracySeries(activity, currentEpoch, accuracyWindowEpochs);
              if (!series.some((s) => s.total > 0)) return null;
              const maxTotal = Math.max(1, ...series.map((s) => s.total));
              const BAR_PX = 32;
              return (
                <div className="mt-3 border-t border-zinc-800/60 pt-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-[11px] font-medium text-zinc-400">Accuracy by epoch</p>
                    <p className="text-[10px] text-zinc-600">upheld vs overturned, oldest → now</p>
                  </div>
                  <div className="mt-2 flex items-end gap-1.5">
                    {series.map((s) => {
                      const h = s.total > 0 ? Math.max(4, Math.round((s.total / maxTotal) * BAR_PX)) : 0;
                      const upH = s.total > 0 ? Math.round(h * (s.upheld / s.total)) : 0;
                      const ovH = h - upH;
                      const isNow = s.epoch === currentEpoch;
                      return (
                        <div
                          key={s.epoch}
                          className="flex flex-1 flex-col items-center gap-1"
                          title={`Epoch ${s.epoch}: ${s.upheld} upheld, ${s.overturned} overturned`}
                        >
                          <div
                            className="flex w-full max-w-[28px] flex-col justify-end overflow-hidden rounded-sm bg-zinc-800/40"
                            style={{ height: `${BAR_PX}px` }}
                          >
                            {ovH > 0 && <div className="w-full bg-red-500/70" style={{ height: `${ovH}px` }} />}
                            {upH > 0 && <div className="w-full bg-emerald-500/70" style={{ height: `${upH}px` }} />}
                          </div>
                          <span className={`text-[9px] ${isNow ? "text-zinc-300" : "text-zinc-600"}`}>
                            {isNow ? "now" : `-${currentEpoch - s.epoch}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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
                  {/* Accepted-reply curation config (chain commit c8be748). Read
                      directly: a non-positive reward disables it. */}
                  <div>
                    <p className="text-zinc-500">Curation reward</p>
                    <p className="text-amber-400">
                      {forumParams.curation_dream_reward && forumParams.curation_dream_reward !== "0"
                        ? `${formatAmount(forumParams.curation_dream_reward)} DREAM`
                        : "disabled"}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Proposal timeout</p>
                    <p className="text-zinc-200">
                      {forumParams.accept_proposal_timeout && forumParams.accept_proposal_timeout !== "0"
                        ? formatDuration(parseInt(forumParams.accept_proposal_timeout, 10))
                        : "—"}
                    </p>
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
                {/* Accepted-reply curation (chain commit c8be748). Proposals a
                    sentinel made on other members' threads, and how many the
                    authors confirmed. epoch_curations feeds the reward score. */}
                <div>
                  <p className="text-xs text-zinc-500">Curation Proposals</p>
                  <p className="text-zinc-200">{activity.total_proposals ?? "0"}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Confirmed</p>
                  <p className="text-emerald-400">{activity.confirmed_proposals ?? "0"}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Rejected</p>
                  <p className="text-red-400">{activity.rejected_proposals ?? "0"}</p>
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
