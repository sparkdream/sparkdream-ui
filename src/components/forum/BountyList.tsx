"use client";

import { useEffect, useState, useCallback } from "react";
import { listForumBounties } from "@/lib/api";
import { timeAgo, timeRemaining, formatSpark } from "@/lib/utils";
import NameOrAddress from "@/components/NameOrAddress";
import { useWallet } from "@/contexts/WalletContext";
import type { Bounty } from "@/types/forum";
import { BountyStatus, BOUNTY_STATUS_LABELS } from "@/types/forum";

function bountyStatusBadge(status: string) {
  const colors: Record<string, string> = {
    [BountyStatus.ACTIVE]: "bg-emerald-500/15 text-emerald-400",
    [BountyStatus.AWARDED]: "bg-blue-500/15 text-blue-400",
    [BountyStatus.EXPIRED]: "bg-zinc-800/50 text-zinc-400",
    [BountyStatus.CANCELLED]: "bg-red-500/15 text-red-400",
    [BountyStatus.MODERATION_PENDING]: "bg-amber-500/15 text-amber-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || "bg-zinc-800/50 text-zinc-400"}`}>
      {BOUNTY_STATUS_LABELS[status] || status}
    </span>
  );
}

const PAGE_SIZE = "20";

interface BountyListProps {
  mode: "active" | "my";
  onSelectThread: (threadId: string) => void;
}

export default function BountyList({ mode, onSelectThread }: BountyListProps) {
  const { address } = useWallet();
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);

  // The chain's dedicated active_bounties/user_bounties queries return a
  // single flat record instead of a list, so both modes read the full bounty
  // list and filter client-side (status for "active", creator for "my").
  const matchesMode = useCallback(
    (b: Bounty) =>
      mode === "my" ? !!address && b.creator === address : b.status === BountyStatus.ACTIVE,
    [mode, address]
  );

  const fetchBounties = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await listForumBounties({ limit: PAGE_SIZE });
      setBounties((res.bounty || []).filter(matchesMode));
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load bounties";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setBounties([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [matchesMode]);

  const loadMore = useCallback(async () => {
    if (!nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await listForumBounties({ limit: PAGE_SIZE, key: nextKey });
      setBounties((prev) => [...prev, ...(res.bounty || []).filter(matchesMode)]);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextKey, loadingMore, matchesMode]);

  useEffect(() => {
    fetchBounties();
  }, [fetchBounties]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse sd-hull-tile rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchBounties} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">
        {mode === "my" ? "My bounties" : "Active bounties"}
      </h2>

      {bounties.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">
            {mode === "my" ? "You have no bounties" : "No active bounties"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {bounties.map((b) => (
            <button
              key={b.id}
              onClick={() => onSelectThread(b.thread_id)}
              className="sd-hull-tile interactive w-full rounded-xl px-4 py-3 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-100">
                      Spark #{b.thread_id}
                    </span>
                    {bountyStatusBadge(b.status)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                    <NameOrAddress address={b.creator} />
                    {b.created_at && <span>{timeAgo(b.created_at)}</span>}
                    {b.status === BountyStatus.ACTIVE && b.expires_at && (
                      <span className="text-amber-400">{timeRemaining(b.expires_at)}</span>
                    )}
                    {b.awards?.length > 0 && (
                      <span className="text-emerald-400">{b.awards.length} award{b.awards.length !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-medium text-amber-400">
                    {formatSpark(b.amount)} SPARK
                  </span>
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
