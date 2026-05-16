"use client";

import { useEffect, useState, useCallback } from "react";
import { listRepMembers, membersByTrustLevel } from "@/lib/api";
import NameOrAddress from "@/components/NameOrAddress";
import type { RepMember } from "@/types/rep";
import { TRUST_LEVEL_LABELS, MEMBER_STATUS_LABELS, MemberStatus, TrustLevel } from "@/types/rep";

function trustLevelBadge(level: string) {
  const colors: Record<string, string> = {
    [TrustLevel.CORE]: "bg-amber-500/15 text-amber-400",
    [TrustLevel.TRUSTED]: "bg-emerald-500/15 text-emerald-400",
    [TrustLevel.ESTABLISHED]: "bg-blue-500/15 text-blue-400",
    [TrustLevel.PROVISIONAL]: "bg-zinc-500/15 text-zinc-300",
    [TrustLevel.NEW]: "bg-zinc-800/50 text-zinc-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[level] || colors[TrustLevel.NEW]}`}>
      {TRUST_LEVEL_LABELS[level] || level}
    </span>
  );
}

function formatDream(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

const PAGE_SIZE = "50";

export default function MemberList() {
  const [members, setMembers] = useState<RepMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [nextKey, setNextKey] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = filterLevel === "all"
        ? await listRepMembers({ limit: PAGE_SIZE })
        : await membersByTrustLevel(filterLevel, { limit: PAGE_SIZE });
      const list = filterLevel === "all"
        ? (res as Awaited<ReturnType<typeof listRepMembers>>).member
        : (res as Awaited<ReturnType<typeof membersByTrustLevel>>).members;
      setMembers(list || []);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load members";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setMembers([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [filterLevel]);

  const loadMore = useCallback(async () => {
    if (!nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = filterLevel === "all"
        ? await listRepMembers({ limit: PAGE_SIZE, key: nextKey })
        : await membersByTrustLevel(filterLevel, { limit: PAGE_SIZE, key: nextKey });
      const list = filterLevel === "all"
        ? (res as Awaited<ReturnType<typeof listRepMembers>>).member
        : (res as Awaited<ReturnType<typeof membersByTrustLevel>>).members;
      setMembers((prev) => [...prev, ...(list || [])]);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextKey, loadingMore, filterLevel]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const filtered = members;

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl sd-hull-tile" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchMembers} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Members</h2>
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="sd-select"
        >
          <option value="all">All Trust Levels</option>
          <option value={TrustLevel.CORE}>Core</option>
          <option value={TrustLevel.TRUSTED}>Trusted</option>
          <option value={TrustLevel.ESTABLISHED}>Established</option>
          <option value={TrustLevel.PROVISIONAL}>Provisional</option>
          <option value={TrustLevel.NEW}>New</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No members found</p>
        </div>
      ) : (
        <div className="@container space-y-2">
          {filtered.map((m) => (
            <div key={m.address} className="rounded-xl sd-hull-tile">
              <button
                onClick={() => setExpanded(expanded === m.address ? null : m.address)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex items-center gap-3">
                    <NameOrAddress address={m.address} className="hidden font-mono text-sm text-zinc-300 @2xl:inline" full />
                    <NameOrAddress address={m.address} className="font-mono text-sm text-zinc-300 @2xl:hidden" />
                    {trustLevelBadge(m.trust_level)}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500 sm:ml-auto">
                    <span>{formatDream(m.dream_balance)} DREAM</span>
                    {m.status !== MemberStatus.ACTIVE && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-400">
                        {MEMBER_STATUS_LABELS[m.status] || m.status}
                      </span>
                    )}
                  </div>
                </div>
                <svg
                  className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${expanded === m.address ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expanded === m.address && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-zinc-500">Staked</dt>
                      <dd className="text-zinc-300">{formatDream(m.staked_dream)} DREAM</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Lifetime Earned</dt>
                      <dd className="text-zinc-300">{formatDream(m.lifetime_earned)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Invitation Credits</dt>
                      <dd className="text-zinc-300">{m.invitation_credits}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Initiatives</dt>
                      <dd className="text-zinc-300">{m.completed_initiatives_count}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Interims</dt>
                      <dd className="text-zinc-300">{m.completed_interims_count}</dd>
                    </div>
                    {m.invited_by && (
                      <div>
                        <dt className="text-xs text-zinc-500">Invited by</dt>
                        <dd className="font-mono text-xs text-zinc-300"><NameOrAddress address={m.invited_by} /></dd>
                      </div>
                    )}
                  </dl>
                  {Object.keys(m.reputation_scores || {}).length > 0 && (
                    <div className="mt-3 border-t border-zinc-800 pt-3">
                      <p className="text-xs font-medium text-zinc-500">Reputation</p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {Object.entries(m.reputation_scores).map(([tag, score]) => (
                          <span key={tag} className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs text-indigo-400">
                            {tag}: {parseFloat(score).toFixed(1)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
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
