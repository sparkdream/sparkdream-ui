"use client";

import { useEffect, useState, useCallback } from "react";
import { listBondedRolesByType, getCuratorActivity } from "@/lib/api";
import { formatTime } from "@/lib/utils";
import CopyableAddress from "@/components/CopyableAddress";
import {
  RoleType,
  BondedRoleStatus,
  BONDED_ROLE_STATUS_LABELS,
} from "@/types/rep";
import type { BondedRole } from "@/types/rep";
import type { CuratorActivity } from "@/types/collect";

const CURATOR_ROLE = RoleType.COLLECT_CURATOR;

function formatBond(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

function statusBadge(status: string) {
  if (status === BondedRoleStatus.NORMAL) {
    return "bg-emerald-500/15 text-emerald-400";
  }
  // UNBONDING is a transitional state (commit 6d7e7ce): bond still locked +
  // slashable, but authority refused. Amber matches the user-perception
  // "in flight" of RECOVERY.
  if (status === BondedRoleStatus.RECOVERY || status === BondedRoleStatus.UNBONDING) {
    return "bg-amber-500/15 text-amber-400";
  }
  return "bg-red-500/15 text-red-400";
}

const PAGE_SIZE = "50";

export default function CuratorList() {
  const [curators, setCurators] = useState<BondedRole[]>([]);
  const [activity, setActivity] = useState<Record<string, CuratorActivity>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchCurators = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listBondedRolesByType(CURATOR_ROLE, { limit: PAGE_SIZE });
      setCurators(res.bonded_roles || []);
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
      const res = await listBondedRolesByType(CURATOR_ROLE, { limit: PAGE_SIZE, key: nextKey });
      setCurators((prev) => [...prev, ...(res.bonded_roles || [])]);
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

  const loadActivity = useCallback(async (address: string) => {
    if (activity[address]) return;
    try {
      const res = await getCuratorActivity(address);
      setActivity((prev) => ({ ...prev, [address]: res.curator_activity }));
    } catch {
      // Activity may be 404 for a freshly bonded curator with no reviews yet.
    }
  }, [activity]);

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
      <h2 className="mb-4 text-lg font-semibold text-white">Bonded Curators</h2>

      {curators.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">No bonded curators found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {curators.map((c) => {
            const act = activity[c.address];
            return (
              <div key={c.address} className="sd-hull-tile rounded-xl">
                <button
                  onClick={() => {
                    const next = expanded === c.address ? null : c.address;
                    setExpanded(next);
                    if (next) loadActivity(c.address);
                  }}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-3">
                    <CopyableAddress className="font-mono text-sm text-zinc-300" address={c.address} nested />
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(c.bond_status)}`}>
                      {BONDED_ROLE_STATUS_LABELS[c.bond_status] || c.bond_status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-zinc-500">{formatBond(c.current_bond)} bonded</span>
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
                        <dt className="text-xs text-zinc-500">Current Bond</dt>
                        <dd className="text-zinc-300">{formatBond(c.current_bond)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-zinc-500">Committed</dt>
                        <dd className="text-zinc-300">{formatBond(c.total_committed_bond)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-zinc-500">Rewards</dt>
                        <dd className="text-amber-400">{formatBond(c.cumulative_rewards)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-zinc-500">Total Reviews</dt>
                        <dd className="text-zinc-300">{act?.total_reviews ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-zinc-500">Challenged</dt>
                        <dd className="text-zinc-300">{act?.challenged_reviews ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-zinc-500">Overturned</dt>
                        <dd className="text-zinc-300">{act?.overturned_reviews ?? "—"}</dd>
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
            );
          })}
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
