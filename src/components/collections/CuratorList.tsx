"use client";

import { useEffect, useState, useCallback } from "react";
import { listActiveCurators } from "@/lib/api";
import { truncateAddress, formatTime } from "@/lib/utils";
import type { Curator } from "@/types/collect";

function formatBond(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

const PAGE_SIZE = "50";

export default function CuratorList() {
  const [curators, setCurators] = useState<Curator[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchCurators = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listActiveCurators({ limit: PAGE_SIZE });
      setCurators(res.curators || []);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load curators";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setCurators([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await listActiveCurators({ limit: PAGE_SIZE, key: nextKey });
      setCurators((prev) => [...prev, ...(res.curators || [])]);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextKey, loadingMore]);

  useEffect(() => {
    fetchCurators();
  }, [fetchCurators]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchCurators} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">Active Curators</h2>

      {curators.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">No active curators found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {curators.map((c) => (
            <div key={c.address} className="rounded-xl border border-zinc-800 bg-zinc-900/50">
              <button
                onClick={() => setExpanded(expanded === c.address ? null : c.address)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-zinc-300">{truncateAddress(c.address)}</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
                    Active
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-zinc-500">{formatBond(c.bond_amount)} bonded</span>
                  <span className="text-xs text-zinc-500">{c.total_reviews} reviews</span>
                  <svg
                    className={`h-4 w-4 text-zinc-500 transition-transform ${expanded === c.address ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {expanded === c.address && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-zinc-500">Bond Amount</dt>
                      <dd className="text-zinc-300">{formatBond(c.bond_amount)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Total Reviews</dt>
                      <dd className="text-zinc-300">{c.total_reviews}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Challenged</dt>
                      <dd className="text-zinc-300">{c.challenged_reviews}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Pending Challenges</dt>
                      <dd className="text-zinc-300">{c.pending_challenges}</dd>
                    </div>
                    {c.registered_at && (
                      <div>
                        <dt className="text-xs text-zinc-500">Registered</dt>
                        <dd className="text-zinc-300">{formatTime(c.registered_at)}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </div>
          ))}
          {nextKey && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
