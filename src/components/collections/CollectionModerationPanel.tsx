"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listCollectionFlaggedContent,
  listCollectionHideRecordsByTarget,
  getCollectionItem,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useIsEligibleSentinel } from "@/hooks/useIsEligibleSentinel";
import { useCommonsCouncil } from "@/hooks/useCommonsCouncil";
import { CollectMsgTypeUrls, ModerationAuthority } from "@/lib/tx";
import CopyableAddress from "@/components/CopyableAddress";
import BlockTime from "@/components/BlockTime";
import {
  FlagTargetType,
  MODERATION_REASONS,
  MODERATION_REASON_LABELS,
} from "@/types/collect";
import type { CollectionFlag, HideRecord } from "@/types/collect";
import ErrorState from "@/components/ErrorState";
import { isMissingEndpoint } from "@/lib/errors";

interface Props {
  onViewCollection?: (collectionId: string) => void;
}

function targetLabel(f: CollectionFlag): string {
  const isItem = Number(f.target_type) === FlagTargetType.ITEM
    || f.target_type === "FLAG_TARGET_TYPE_ITEM";
  return isItem ? `Item #${f.target_id}` : `Collection #${f.target_id}`;
}

function isItemTarget(f: CollectionFlag): boolean {
  return Number(f.target_type) === FlagTargetType.ITEM
    || f.target_type === "FLAG_TARGET_TYPE_ITEM";
}

export default function CollectionModerationPanel({ onViewCollection }: Props) {
  const { address, connected, signAndBroadcast } = useWallet();
  const isEligible = useIsEligibleSentinel(address);
  const { isOpsCommitteeMember } = useCommonsCouncil(address);
  // Hide is open to either moderation authority; an account holding both
  // roles must pick which one it acts under (default: the accountable
  // sentinel path). Mirrors the forum ThreadDetail authority disambiguation.
  const canHide = isEligible || isOpsCommitteeMember;
  const hideAuthorityIsAmbiguous = isEligible && isOpsCommitteeMember;

  const [flags, setFlags] = useState<CollectionFlag[]>([]);
  // Active hide records keyed by `${target_type}:${target_id}`.
  const [hides, setHides] = useState<Record<string, HideRecord | null>>({});
  // For item flags, the resolved parent collection id (for the View link).
  const [itemCollections, setItemCollections] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Per-row hide form state.
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [reason, setReason] = useState<number>(MODERATION_REASONS[0].value);
  const [reasonText, setReasonText] = useState("");
  // When the account is both sentinel and committee, this opt-in switches the
  // hide from the default sentinel path to an explicit council hide.
  const [hideAsCouncil, setHideAsCouncil] = useState(false);

  const rowKey = (f: CollectionFlag) => `${f.target_type}:${f.target_id}`;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listCollectionFlaggedContent({ limit: "100" });
      const list = res.collection_flags || [];
      setFlags(list);

      // Pull hide state + (for items) parent collection in parallel.
      const hideEntries: Record<string, HideRecord | null> = {};
      const itemEntries: Record<string, string> = {};
      await Promise.all(
        list.map(async (f) => {
          const targetTypeNum = isItemTarget(f) ? FlagTargetType.ITEM : FlagTargetType.COLLECTION;
          const hideRes = await listCollectionHideRecordsByTarget(f.target_id, targetTypeNum).catch(() => null);
          const active = (hideRes?.hide_records || []).find((h) => !h.resolved) ?? null;
          hideEntries[rowKey(f)] = active;
          if (isItemTarget(f)) {
            const itemRes = await getCollectionItem(f.target_id).catch(() => null);
            if (itemRes?.item?.collection_id) itemEntries[f.target_id] = itemRes.item.collection_id;
          }
        })
      );
      setHides(hideEntries);
      setItemCollections(itemEntries);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setFlags([]);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleHide = async (f: CollectionFlag) => {
    if (!address) return;
    const key = rowKey(f);
    setActionLoading(`hide-${key}`);
    setActionError(null);
    try {
      const targetTypeNum = isItemTarget(f) ? FlagTargetType.ITEM : FlagTargetType.COLLECTION;
      // Send the authority explicitly so the chain never has to guess: an
      // account holding both roles defaults to the sentinel path and only
      // gov-hides when it opts in via the toggle. Single-role accounts get
      // the one path they are eligible for.
      const authority = hideAuthorityIsAmbiguous
        ? hideAsCouncil
          ? ModerationAuthority.COUNCIL
          : ModerationAuthority.SENTINEL
        : isEligible
          ? ModerationAuthority.SENTINEL
          : ModerationAuthority.COUNCIL;
      await signAndBroadcast([{
        typeUrl: CollectMsgTypeUrls.HideContent,
        value: {
          creator: address,
          targetId: BigInt(f.target_id),
          targetType: targetTypeNum,
          reasonCode: reason,
          reasonText: reasonText.trim(),
          authority,
        },
      }]);
      setOpenForm(null);
      setReasonText("");
      await fetchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Hide failed");
    } finally {
      setActionLoading(null);
    }
  };

  const viewLink = (f: CollectionFlag) => {
    const collectionId = isItemTarget(f) ? itemCollections[f.target_id] : f.target_id;
    if (!collectionId || !onViewCollection) return null;
    return (
      <button
        type="button"
        onClick={() => onViewCollection(collectionId)}
        className="text-xs text-indigo-400 hover:text-indigo-300"
      >
        View
      </button>
    );
  };

  if (!connected) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-white">Collection moderation</h2>
        <button onClick={fetchData} className="text-xs text-zinc-500 hover:text-zinc-300">Refresh</button>
      </div>

      {!canHide && (
        <div className="sd-hull-tile rounded-xl p-5 text-sm text-zinc-400">
          Hiding flagged collection content requires an eligible sentinel bond or an
          Operations Committee seat. Bond to become a sentinel using the card above.
          You can still review the flagged queue below.
        </div>
      )}

      {actionError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-400">
          <span className="break-all">{actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 text-red-300 hover:text-red-100" aria-label="Dismiss">✕</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={fetchData} />
      ) : flags.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">No flagged collection content.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {flags.map((f) => {
            const key = rowKey(f);
            const hide = hides[key];
            // Top reasons, most-cited first.
            const reasonCounts = new Map<string, number>();
            for (const r of f.flag_records || []) {
              reasonCounts.set(r.reason, (reasonCounts.get(r.reason) || 0) + 1);
            }
            const topReasons = Array.from(reasonCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3);
            return (
              <li key={key} className="sd-hull-tile rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-zinc-200">{targetLabel(f)}</span>
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                        {(f.flag_records || []).length} {(f.flag_records || []).length === 1 ? "flag" : "flags"}
                      </span>
                      {hide && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">
                          {hide.appealed ? "Hidden · appealed" : "Hidden"}
                        </span>
                      )}
                      {viewLink(f)}
                    </div>
                    {topReasons.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {topReasons.map(([r, n]) => (
                          <span key={r} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                            {MODERATION_REASON_LABELS[r] || r}{n > 1 ? ` ×${n}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[10px] text-zinc-600">
                      First flagged <BlockTime height={f.first_flag_at} relative /> · last <BlockTime height={f.last_flag_at} relative />
                      {f.flag_records?.[0]?.flagger && (
                        <> · by <CopyableAddress address={f.flag_records[0].flagger} nested /></>
                      )}
                    </p>
                  </div>
                  {canHide && !hide && (
                    <button
                      type="button"
                      onClick={() => {
                        setHideAsCouncil(false);
                        setOpenForm(openForm === key ? null : key);
                      }}
                      className="shrink-0 rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-700 hover:bg-red-900/20"
                    >
                      {openForm === key ? "Cancel" : "Hide"}
                    </button>
                  )}
                </div>

                {openForm === key && canHide && !hide && (
                  <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                    {/* Make the acting authority explicit and visible. When the
                        account holds both roles, gov-hiding is an opt-in toggle
                        (default: sentinel). Otherwise we label the single path
                        the account is eligible for. */}
                    {hideAuthorityIsAmbiguous ? (
                      <div className="space-y-1.5">
                        <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                          <input
                            type="radio"
                            name={`hide-authority-${key}`}
                            checked={!hideAsCouncil}
                            onChange={() => setHideAsCouncil(false)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-medium text-zinc-200">Hide as sentinel</span>
                            {" "}— commits your sentinel bond, the author can appeal, self-correctable within the unhide window.
                          </span>
                        </label>
                        <label className="flex items-start gap-2 text-[11px] text-amber-300/80">
                          <input
                            type="radio"
                            name={`hide-authority-${key}`}
                            checked={hideAsCouncil}
                            onChange={() => setHideAsCouncil(true)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-medium text-amber-300">Hide as committee</span>
                            {" "}— council hide: no bond committed, reversal only via a Commons Operations Committee proposal.
                          </span>
                        </label>
                      </div>
                    ) : isEligible ? (
                      <p className="text-[11px] text-zinc-500">
                        Acting as a bonded sentinel. This commits your sentinel bond and
                        can be self-corrected within the unhide window.
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-300/80">
                        Acting as Commons Operations Committee. Recorded as a council hide:
                        no sentinel bond is committed, and reversal goes through a council
                        proposal rather than the sentinel self-correct window.
                      </p>
                    )}
                    <select
                      value={reason}
                      onChange={(e) => setReason(Number(e.target.value))}
                      className="sd-select"
                    >
                      {MODERATION_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <input
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      placeholder="Reason detail (optional)"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleHide(f)}
                      disabled={actionLoading === `hide-${key}`}
                      className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-700 hover:bg-red-900/20 disabled:opacity-50"
                    >
                      {actionLoading === `hide-${key}` ? "Hiding…" : "Confirm hide"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
