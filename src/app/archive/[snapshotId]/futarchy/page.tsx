"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { listFutarchyMarkets } from "@/lib/api";
import type { Market } from "@/types/futarchy";
import { ArchiveSectionShell, EmptyState, LoadError } from "../_components";

export default function ArchiveFutarchyList({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = use(params);
  const { entry } = useArchive();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    listFutarchyMarkets()
      .then((res) => {
        if (!cancelled) setMarkets(res.market ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  return (
    <ArchiveSectionShell snapshotId={snapshotId} title="Futarchy">
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {!loading && !error && markets.length === 0 && <EmptyState what="markets" />}
      <ul className="space-y-2">
        {markets.map((m) => (
          <li key={m.index}>
            <Link
              href={`/archive/${snapshotId}/futarchy/${m.index}`}
              className="block rounded border border-white/10 hover:border-white/30 px-3 py-2"
            >
              <div className="flex items-baseline justify-between">
                <div className="font-medium">{m.symbol || `Market #${m.index}`}</div>
                <span className="text-xs font-mono opacity-70">
                  {m.status.replace("MARKET_STATUS_", "").toLowerCase()}
                </span>
              </div>
              {m.question && (
                <div className="text-sm opacity-80 mt-1 line-clamp-2">{m.question}</div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </ArchiveSectionShell>
  );
}
