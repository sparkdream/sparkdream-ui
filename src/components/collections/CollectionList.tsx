"use client";

import { useEffect, useState, useCallback } from "react";
import { listPublicCollections, getCollectionsByOwner } from "@/lib/api";
import NameOrAddress from "@/components/NameOrAddress";
import BlockTime from "@/components/BlockTime";
import type { Collection } from "@/types/collect";
import {
  COLLECTION_TYPE_LABELS,
  COLLECTION_STATUS_LABELS,
  CollectionStatus,
  CollectionType,
} from "@/types/collect";
import { useWallet } from "@/contexts/WalletContext";

function typeBadge(type: string) {
  const colors: Record<string, string> = {
    [CollectionType.NFT]: "bg-purple-500/15 text-purple-400",
    [CollectionType.LINK]: "bg-blue-500/15 text-blue-400",
    [CollectionType.ONCHAIN]: "bg-emerald-500/15 text-emerald-400",
    [CollectionType.MIXED]: "bg-amber-500/15 text-amber-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[type] || "bg-zinc-800/50 text-zinc-400"}`}>
      {COLLECTION_TYPE_LABELS[type] || type}
    </span>
  );
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    [CollectionStatus.ACTIVE]: "text-emerald-400",
    [CollectionStatus.PENDING]: "text-amber-400",
    [CollectionStatus.HIDDEN]: "text-red-400",
  };
  return (
    <span className={`text-xs ${colors[status] || "text-zinc-500"}`}>
      {COLLECTION_STATUS_LABELS[status] || status}
    </span>
  );
}

const PAGE_SIZE = "20";

interface CollectionListProps {
  mode: "public" | "my";
  onSelect: (collection: Collection) => void;
  filterType?: string;
  tagFilter?: string | null;
  /** Optional CTA shown in the empty state to open the new-collection form. */
  onCreate?: () => void;
}

export default function CollectionList({ mode, onSelect, filterType = "all", tagFilter, onCreate }: CollectionListProps) {
  const { address } = useWallet();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let res;
      if (mode === "my" && address) {
        res = await getCollectionsByOwner(address, { limit: PAGE_SIZE });
      } else {
        res = await listPublicCollections({ limit: PAGE_SIZE });
      }
      setCollections(res.collections || []);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load collections";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setCollections([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [mode, address]);

  const loadMore = useCallback(async () => {
    if (!nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      let res;
      if (mode === "my" && address) {
        res = await getCollectionsByOwner(address, { limit: PAGE_SIZE, key: nextKey });
      } else {
        res = await listPublicCollections({ limit: PAGE_SIZE, key: nextKey });
      }
      setCollections((prev) => [...prev, ...(res.collections || [])]);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextKey, loadingMore, mode, address]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  let filtered = filterType === "all"
    ? collections
    : collections.filter((c) => c.type === filterType);
  if (tagFilter) {
    filtered = filtered.filter((c) => (c.tags || []).includes(tagFilter));
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchCollections} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div>
      {filtered.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">
            {mode === "my" ? "You have no collections yet" : "No public collections found"}
          </p>
          {onCreate && !tagFilter && (
            <button
              type="button"
              onClick={onCreate}
              style={{
                display: "inline-block",
                marginTop: 12,
                background: "transparent",
                border: 0,
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {mode === "my" ? "Curate your first collection" : "Curate the first collection"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="sd-hull-tile interactive w-full rounded-xl px-4 py-3 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-zinc-100">{c.name || `Collection #${c.id}`}</span>
                    {typeBadge(c.type)}
                    {statusBadge(c.status)}
                  </div>
                  {c.description && (
                    <p className="mt-1 truncate text-sm text-zinc-400">{c.description}</p>
                  )}
                  <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
                    <span>{c.item_count} item{c.item_count !== 1 ? "s" : ""}</span>
                    {mode !== "my" && <NameOrAddress address={c.owner} />}
                    {c.created_at && <span><BlockTime height={c.created_at} relative /></span>}
                    {c.tags?.length > 0 && (
                      <span className="truncate">{c.tags.slice(0, 3).join(", ")}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  {(c.upvote_count > 0 || c.downvote_count > 0) && (
                    <span>{c.upvote_count - c.downvote_count >= 0 ? "+" : ""}{c.upvote_count - c.downvote_count}</span>
                  )}
                  <svg className="h-4 w-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </div>
            </button>
          ))}
          {nextKey && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
