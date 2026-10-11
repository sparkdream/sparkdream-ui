"use client";

import { useCallback, useEffect, useState } from "react";
import { listArtifactClasses, listArtifactClassesByOwner } from "@/lib/artifactApi";
import { isMissingEndpoint } from "@/lib/errors";
import { useWallet } from "@/contexts/WalletContext";
import NameOrAddress from "@/components/NameOrAddress";
import ErrorState from "@/components/ErrorState";
import type { ClassView } from "@/types/artifact";
import { ClassBadges, classTitle } from "./shared";

const PAGE_SIZE = "30";

interface Props {
  mode: "all" | "mine";
  search: string;
  sort: "newest" | "oldest";
  onSelect: (classId: string) => void;
  onCreate?: () => void;
}

export default function ClassList({ mode, search, sort, onSelect, onCreate }: Props) {
  const { address } = useWallet();
  const [views, setViews] = useState<ClassView[]>([]);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const fetchPage = useCallback(
    (key?: string) => {
      const p = { limit: PAGE_SIZE, key, reverse: sort === "newest" };
      if (mode === "mine") {
        if (!address) return Promise.resolve({ classes: [] as ClassView[], pagination: undefined });
        return listArtifactClassesByOwner(address, p);
      }
      return listArtifactClasses(p);
    },
    [mode, address, sort]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPage();
      setViews(res.classes || []);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      if (isMissingEndpoint(err)) setViews([]);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!nextKey) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage(nextKey);
      setViews((prev) => [...prev, ...(res.classes || [])]);
      setNextKey(res.pagination?.next_key || null);
    } catch {
      // Keep what we have; the button stays for a retry.
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={load} />;

  const q = search.trim().toLowerCase();
  const shown = views.filter((v) => {
    // Hidden classes stay out of public browsing; owners still see theirs.
    if (mode === "all" && v.withheld) return false;
    if (!q) return true;
    const c = v.class;
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.symbol || "").toLowerCase().includes(q) ||
      c.id === q.replace(/^#/, "") ||
      c.owner.toLowerCase() === q
    );
  });

  if (shown.length === 0) {
    return (
      <div className="sd-hull-tile rounded-xl p-12 text-center">
        <p className="text-zinc-400">
          {q ? "No classes match." : mode === "mine" ? "You don't own any classes yet." : "No classes yet."}
        </p>
        {onCreate && !q && (
          <button type="button" onClick={onCreate} className="mt-3 text-sm text-white hover:underline">
            Create a class
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {shown.map(({ class: c, withheld }) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className="sd-hull-tile interactive w-full rounded-xl px-4 py-3 text-left"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-zinc-100">{classTitle(c, withheld)}</span>
                {c.symbol && !withheld && <span className="font-mono text-xs text-zinc-500">{c.symbol}</span>}
                <span className="font-mono text-xs text-zinc-600">#{c.id}</span>
              </div>
              {c.description && !withheld && (
                <p className="mt-1 truncate text-sm text-zinc-400">{c.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>
                  {c.supply || "0"} live
                  {c.max_supply && c.max_supply !== "0" ? ` · cap ${c.max_supply}` : ""}
                </span>
                {mode === "all" && (
                  <span className="inline-flex items-center gap-1">
                    by <NameOrAddress address={c.owner} />
                  </span>
                )}
                <ClassBadges cls={c} withheld={withheld} />
              </div>
            </div>
            <svg className="mt-1 h-4 w-4 shrink-0 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </div>
        </button>
      ))}
      {nextKey && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
