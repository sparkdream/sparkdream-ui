"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getBondedRole,
  getBondedRoleConfig,
  getCollectParams,
  getCollectionItem,
  getLatestBlockHeight,
  listCollectionFlaggedContent,
  listCollectionHideRecordsByTarget,
  listPublicCollections,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { CollectMsgTypeUrls, RepMsgTypeUrls } from "@/lib/tx";
import NumberInput from "@/components/NumberInput";
import BlockTime from "@/components/BlockTime";
import CollectionModerationPanel from "@/components/collections/CollectionModerationPanel";
import {
  CollectionStatus,
  FlagTargetType,
  MODERATION_REASON_LABELS,
} from "@/types/collect";
import type { HideRecord } from "@/types/collect";
import {
  RoleType,
  BondedRoleStatus,
  BONDED_ROLE_STATUS_LABELS,
} from "@/types/rep";
import type { BondedRole, BondedRoleConfig } from "@/types/rep";

interface Props {
  onViewCollection?: (collectionId: string) => void;
}

// One content sentinel corps (ROLE_TYPE_CONTENT_SENTINEL, renamed from
// FORUM_SENTINEL in chain commit 4ad8e38) spans forum and collect: the same
// bond and shared x/rep accountability record gate moderation here and on
// Swarm, so becoming a sentinel here also unlocks Swarm moderation, and vice
// versa.
const SENTINEL_ROLE = RoleType.CONTENT_SENTINEL;

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

// Read a positive integer param out of the untyped collect params blob.
function numParam(params: Record<string, unknown> | null, key: string): number | null {
  const raw = params?.[key];
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Read a uDREAM math.Int param and render it in whole DREAM.
function dreamParam(params: Record<string, unknown> | null, key: string): string | null {
  const raw = params?.[key];
  if (typeof raw !== "string" || raw === "" || raw === "0") return null;
  return formatAmount(raw);
}

// One active hide, joined with enough target context to label and link it.
interface HideEntry {
  record: HideRecord;
  label: string;
  // Parent collection for the View link (the collection itself, or an item's
  // collection). Null when the item lookup failed.
  collectionId: string | null;
}

function isItemType(targetType: string): boolean {
  return Number(targetType) === FlagTargetType.ITEM
    || targetType === "FLAG_TARGET_TYPE_ITEM";
}

/**
 * Wonders moderation home. Mirrors the structure of Swarm's SentinelPanel -- a
 * bond/become-a-sentinel card on top, then moderation limits, the sentinel's
 * own active hides, and the flagged-content queue -- but the queue and actions
 * are collection-specific (flag/hide on items and collections via x/collect),
 * so this is a dedicated panel rather than the forum one.
 */
export default function CollectionSentinelPanel({ onViewCollection }: Props) {
  const { address, connected, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const cannotBond = address ? isMember === false : false;

  const [bond, setBond] = useState<BondedRole | null>(null);
  const [config, setConfig] = useState<BondedRoleConfig | null>(null);
  const [isSentinel, setIsSentinel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showBondForm, setShowBondForm] = useState(false);
  const [bondAmount, setBondAmount] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Collect moderation params + live height (hide/appeal params are
  // block-denominated, so appeal windows resolve against the current height).
  const [collectParams, setCollectParams] = useState<Record<string, unknown> | null>(null);
  const [latestHeight, setLatestHeight] = useState<number | null>(null);

  // All active (unresolved) hide records we can discover, most recent first.
  // x/collect has no global or by-sentinel hide-record index (unlike x/forum's
  // hide_record endpoint), so this is assembled from two visible surfaces:
  // hidden public collections and the flagged-content queue. Hidden private
  // collections, or hidden items whose flags have expired out of the queue,
  // won't surface here until the chain grows a HideRecordsBySentinel index.
  const [hideEntries, setHideEntries] = useState<HideEntry[]>([]);
  const [hidesLoading, setHidesLoading] = useState(true);

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
      if (bondRes?.bonded_role) {
        setIsSentinel(true);
        setBond(bondRes.bonded_role);
      } else {
        setIsSentinel(false);
        setBond(null);
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

  const fetchModeration = useCallback(async () => {
    try {
      setHidesLoading(true);
      const [pubRes, flaggedRes, paramsRes, heightRes] = await Promise.all([
        listPublicCollections({ limit: "200" }).catch(() => null),
        listCollectionFlaggedContent({ limit: "100" }).catch(() => null),
        getCollectParams().catch(() => null),
        getLatestBlockHeight().catch(() => null),
      ]);
      setCollectParams(paramsRes?.params ?? null);
      const h = heightRes ? parseInt(heightRes, 10) : NaN;
      setLatestHeight(Number.isFinite(h) ? h : null);

      const collections = pubRes?.collections ?? [];
      const nameById = new Map(collections.map((c) => [c.id, c.name]));

      // Union of targets that could carry an active hide record.
      const targets = new Map<string, { id: string; type: number }>();
      for (const c of collections) {
        if (c.status === CollectionStatus.HIDDEN) {
          targets.set(`${FlagTargetType.COLLECTION}:${c.id}`, {
            id: c.id,
            type: FlagTargetType.COLLECTION,
          });
        }
      }
      for (const f of flaggedRes?.collection_flags ?? []) {
        const type = isItemType(f.target_type) ? FlagTargetType.ITEM : FlagTargetType.COLLECTION;
        targets.set(`${type}:${f.target_id}`, { id: f.target_id, type });
      }

      const entries: HideEntry[] = [];
      await Promise.all(
        Array.from(targets.values()).map(async (t) => {
          const res = await listCollectionHideRecordsByTarget(t.id, t.type).catch(() => null);
          const active = (res?.hide_records || []).filter((r) => !r.resolved);
          if (active.length === 0) return;
          let label: string;
          let collectionId: string | null;
          if (t.type === FlagTargetType.COLLECTION) {
            collectionId = t.id;
            const name = nameById.get(t.id);
            label = name ? `Collection #${t.id} · ${name}` : `Collection #${t.id}`;
          } else {
            const itemRes = await getCollectionItem(t.id).catch(() => null);
            collectionId = itemRes?.item?.collection_id ?? null;
            const title = itemRes?.item?.title;
            label = title ? `Item #${t.id} · ${title}` : `Item #${t.id}`;
          }
          for (const record of active) entries.push({ record, label, collectionId });
        })
      );
      // hidden_at is a block height; most recent first.
      entries.sort((a, b) => Number(BigInt(b.record.hidden_at || "0") - BigInt(a.record.hidden_at || "0")));
      setHideEntries(entries);
    } catch {
      setHideEntries([]);
    } finally {
      setHidesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchModeration();
  }, [fetchModeration]);

  const handleBond = async () => {
    if (!address || !bondAmount.trim()) return;
    setActionLoading("bond");
    try {
      const amountUdream = BigInt(Math.floor(parseFloat(bondAmount) * 1_000_000)).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.BondRole,
        value: { creator: address, roleType: SENTINEL_ROLE, amount: amountUdream },
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
      const amountUdream = BigInt(Math.floor(parseFloat(bondAmount) * 1_000_000)).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.UnbondRole,
        value: { creator: address, roleType: SENTINEL_ROLE, amount: amountUdream },
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

  // Cancel (reduce) an in-flight unbond, returning the cancelled DREAM to
  // active bond without waiting out the cooldown. Same shared-role semantics
  // as the Swarm panel: pending is only an earmark, so cancelling restores
  // authority immediately. Cancels the full pending amount.
  const handleCancelUnbond = async () => {
    if (!address || !bond?.pending_unbond_amount || bond.pending_unbond_amount === "0") return;
    setActionLoading("cancel-unbond");
    try {
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.CancelUnbondRole,
        value: {
          creator: address,
          roleType: SENTINEL_ROLE,
          amount: bond.pending_unbond_amount,
        },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cancel unbond failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Sentinel self-correct (MsgUnhideContent, chain commit 4ad8e38): the hiding
  // sentinel reverses its own hide inside params.sentinel_unhide_window_blocks,
  // before an appeal is filed. Restores the author's slashed bond + rep; the
  // committed sentinel bond stays reserved until the original appeal_deadline.
  const handleUnhide = async (hideRecordId: string) => {
    if (!address) return;
    setActionLoading(`unhide-${hideRecordId}`);
    try {
      await signAndBroadcast([{
        typeUrl: CollectMsgTypeUrls.UnhideContent,
        value: { creator: address, hideRecordId: BigInt(hideRecordId) },
      }]);
      await fetchModeration();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unhide failed");
    } finally {
      setActionLoading(null);
    }
  };

  if (!connected) return null;

  const bondStatus = bond?.bond_status ?? "";
  const currentBond = bond?.current_bond ?? "0";
  const totalCommitted = bond?.total_committed_bond ?? "0";
  const availableBond = bond
    ? (BigInt(currentBond) - BigInt(totalCommitted)).toString()
    : "0";

  const myHides = hideEntries.filter((e) => e.record.sentinel === address);

  // Self-correct window in blocks (collect timestamps are heights, unlike
  // forum's seconds-denominated sentinel_unhide_window).
  const unhideWindow = numParam(collectParams, "sentinel_unhide_window_blocks");

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Sentinel status</h2>

      {loading ? (
        <div className="h-32 animate-pulse sd-hull-tile rounded-xl" />
      ) : error ? (
        <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={fetchData} className="ml-2 underline hover:text-red-300">Retry</button>
        </div>
      ) : !isSentinel ? (
        <div className="sd-hull-tile rounded-xl p-6">
          <p className="mb-2 text-sm text-zinc-400">
            You are not a sentinel. Bond DREAM tokens to become a sentinel and help moderate
            collections. The same bond also lets you moderate{" "}
            <Link href="/swarm" className="text-indigo-400 underline hover:text-indigo-300">Swarm</Link>.
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
              Bonding as a sentinel is open to members. Ask any existing{" "}
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
              title={cannotBond ? "Only existing members can become a sentinel" : undefined}
              className="sd-btn sd-btn-primary"
            >
              Become a sentinel
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
                  title={cannotBond ? "Only existing members can become a sentinel" : undefined}
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
        <>
          <div className="sd-hull-tile rounded-xl p-5">
            {/* Same reversible-unbond semantics as the Swarm panel: pending is
                an earmark, authority continues while the staying bond covers
                the minimum, and the unbond can be cancelled before maturity. */}
            {bondStatus === BondedRoleStatus.UNBONDING && bond?.unbond_completion_time && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-xs text-amber-300">
                <span>
                  Unbond in progress. <b>{formatAmount(bond.pending_unbond_amount || "0")} DREAM</b> stays locked + slashable for {formatCooldownRemaining(bond.unbond_completion_time) || "—"}. You keep acting as a sentinel while your staying bond covers the minimum.
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
              {bond?.cumulative_rewards && bond.cumulative_rewards !== "0" && (
                <div>
                  <p className="text-xs text-zinc-500">Rewards</p>
                  <p className="font-medium text-amber-400">{formatAmount(bond.cumulative_rewards)} DREAM</p>
                </div>
              )}
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
              </div>
            )}
            <p className="mt-3 border-t border-zinc-800/60 pt-3 text-xs text-zinc-500">
              Reward accuracy lives on the{" "}
              <Link href="/swarm" className="text-indigo-400 underline hover:text-indigo-300">Swarm</Link>{" "}
              moderation panel and counts your hides here too, since one sentinel
              bond covers both surfaces. Here you act on flagged collection
              content below.
            </p>
            <div className="mt-4 flex gap-2">
              {!showBondForm ? (
                <button
                  onClick={() => setShowBondForm(true)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                >
                  Bond / unbond
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

          {/* Collect moderation limits, mirroring the Swarm panel's card. All
              params are chain-enforced; block-denominated windows are shown in
              blocks since collect timestamps are heights. */}
          {collectParams && (() => {
            const threshold = numParam(collectParams, "flag_review_threshold");
            const maxFlags = numParam(collectParams, "max_flags_per_day");
            const commit = dreamParam(collectParams, "sentinel_commit_amount");
            const hideExpiry = numParam(collectParams, "hide_expiry_blocks");
            const appealFee = dreamParam(collectParams, "appeal_fee");
            const appealDeadline = numParam(collectParams, "appeal_deadline_blocks");
            const appealCooldown = numParam(collectParams, "appeal_cooldown_blocks");
            // New moderation throttles from chain commit 4ad8e38 (0.0.27).
            const maxHides = numParam(collectParams, "max_hides_per_sentinel_per_day");
            const rows: { label: string; value: string; amber?: boolean }[] = [];
            if (threshold !== null) rows.push({ label: "Flags to enter queue", value: threshold.toLocaleString() });
            if (maxFlags !== null) rows.push({ label: "Flags / day", value: maxFlags.toLocaleString() });
            if (maxHides !== null) rows.push({ label: "Hides / day", value: maxHides.toLocaleString() });
            if (commit !== null) rows.push({ label: "Commit / hide", value: `${commit} DREAM`, amber: true });
            if (hideExpiry !== null) rows.push({ label: "Hide expiry", value: `${hideExpiry.toLocaleString()} blocks` });
            if (unhideWindow !== null) rows.push({ label: "Self-correct window", value: `${unhideWindow.toLocaleString()} blocks` });
            if (appealFee !== null) rows.push({ label: "Appeal fee", value: `${appealFee} DREAM`, amber: true });
            if (appealDeadline !== null) rows.push({ label: "Appeal deadline", value: `${appealDeadline.toLocaleString()} blocks` });
            if (appealCooldown !== null) rows.push({ label: "Appeal cooldown", value: `${appealCooldown.toLocaleString()} blocks` });
            if (rows.length === 0) return null;
            return (
              <div className="sd-hull-tile rounded-xl p-5">
                <h3 className="text-sm font-semibold text-zinc-300">Moderation limits</h3>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Flag-queue entry threshold, the bond committed per hide, and the
                  appeal windows. Enforced chain-side.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                  {rows.map((r) => (
                    <div key={r.label}>
                      <p className="text-zinc-500">{r.label}</p>
                      <p className={r.amber ? "text-amber-400" : "text-zinc-200"}>{r.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Hides by this sentinel — self-correct via MsgUnhideContent (chain
              commit 4ad8e38) while inside sentinel_unhide_window_blocks and
              before an appeal is filed; the window is height-denominated so it
              resolves against latestHeight. Past the window or once appealed,
              the hide stands until it expires or the appeal decides it. */}
          <div className="sd-hull-tile rounded-xl p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-zinc-300">My hides</h3>
              <span className="text-xs text-zinc-500">
                {unhideWindow !== null
                  ? `Self-correct window: ${unhideWindow.toLocaleString()} blocks`
                  : "A hide stands until it expires or an appeal overturns it"}
              </span>
            </div>
            {hidesLoading ? (
              <div className="h-16 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/50" />
            ) : myHides.length === 0 ? (
              <p className="text-xs text-zinc-500">No active hides on file.</p>
            ) : (
              <ul className="space-y-2">
                {myHides.map((e) => {
                  const r = e.record;
                  const deadline = parseInt(r.appeal_deadline || "0", 10);
                  const appealOpen =
                    latestHeight !== null && Number.isFinite(deadline) && deadline > latestHeight;
                  // Chain gate mirrored: original sentinel, no appeal filed,
                  // and still inside the height-denominated window. Disabled
                  // (not hidden) past the window so it's obvious why.
                  const hiddenAt = parseInt(r.hidden_at || "0", 10);
                  const inWindow =
                    unhideWindow !== null &&
                    latestHeight !== null &&
                    Number.isFinite(hiddenAt) &&
                    hiddenAt > 0 &&
                    latestHeight - hiddenAt <= unhideWindow;
                  const canUnhide = !r.appealed && inWindow;
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="truncate text-zinc-300">{e.label}</span>
                          {r.reason_code && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                              {MODERATION_REASON_LABELS[r.reason_code] || r.reason_code}
                            </span>
                          )}
                          {r.appealed ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                              Appealed
                            </span>
                          ) : (
                            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
                              {appealOpen ? "Appeal window open" : "Appeal window closed"}
                            </span>
                          )}
                        </div>
                        {r.reason_text && (
                          <p className="mt-0.5 truncate text-xs text-zinc-500">{r.reason_text}</p>
                        )}
                        <p className="mt-0.5 text-[10px] text-zinc-600">
                          Hidden <BlockTime height={r.hidden_at} relative />
                          {r.committed_amount && r.committed_amount !== "0" && (
                            <> · {formatAmount(r.committed_amount)} DREAM committed</>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {unhideWindow !== null && (
                          <button
                            type="button"
                            onClick={() => handleUnhide(r.id)}
                            disabled={!canUnhide || !!actionLoading}
                            title={
                              r.appealed
                                ? "An appeal was filed; the jury decides this hide"
                                : inWindow
                                  ? "Reverse this hide and restore the author's slashed bond and rep. Your committed bond stays reserved until the original appeal deadline."
                                  : "Self-correct window has closed"
                            }
                            className="rounded-lg border border-emerald-700/50 px-3 py-1.5 text-xs text-emerald-400 transition-colors hover:bg-emerald-900/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {actionLoading === `unhide-${r.id}` ? "Unhiding…" : "Unhide"}
                          </button>
                        )}
                        {e.collectionId && onViewCollection && (
                          <button
                            type="button"
                            onClick={() => onViewCollection(e.collectionId!)}
                            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100"
                          >
                            View
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Collection-specific moderation queue: flagged items/collections + Hide. */}
      <CollectionModerationPanel onViewCollection={onViewCollection} />
    </div>
  );
}
