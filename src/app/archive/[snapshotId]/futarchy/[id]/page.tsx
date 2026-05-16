"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { getFutarchyMarket, getFutarchyMarketPrice } from "@/lib/api";
import type { Market } from "@/types/futarchy";
import CopyableAddress from "@/components/CopyableAddress";
import { ArchiveSectionShell, LoadError } from "../../_components";

function pct(d: string): string {
  const n = Number(d);
  if (!Number.isFinite(n)) return d;
  return `${(n * 100).toFixed(1)}%`;
}

export default function ArchiveMarketDetail({
  params,
}: {
  params: Promise<{ snapshotId: string; id: string }>;
}) {
  const { snapshotId, id } = use(params);
  const { entry } = useArchive();
  const [market, setMarket] = useState<Market | null>(null);
  const [yesPrice, setYesPrice] = useState<string | null>(null);
  const [noPrice, setNoPrice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    (async () => {
      try {
        const [m, y, n] = await Promise.all([
          getFutarchyMarket(id),
          getFutarchyMarketPrice(id, true).catch(() => null),
          getFutarchyMarketPrice(id, false).catch(() => null),
        ]);
        if (cancelled) return;
        setMarket(m.market);
        setYesPrice(y?.price ?? null);
        setNoPrice(n?.price ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry, id]);

  return (
    <ArchiveSectionShell
      snapshotId={snapshotId}
      title={market?.symbol || `Market #${id}`}
    >
      <Link
        href={`/archive/${snapshotId}/futarchy`}
        className="text-sm opacity-70 hover:opacity-100 -mt-2 block"
      >
        ← back to futarchy
      </Link>
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {market && (
        <>
          <p className="text-sm whitespace-pre-wrap">{market.question}</p>
          <div className="text-xs opacity-60 flex gap-3 flex-wrap">
            <span>status: {market.status.replace("MARKET_STATUS_", "").toLowerCase()}</span>
            <span>denom: {market.denom}</span>
            <span>creator: <CopyableAddress address={market.creator} /></span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-emerald-700/40 px-3 py-2">
              <div className="text-xs opacity-70">YES marginal price</div>
              <div className="font-mono text-lg">{yesPrice ? pct(yesPrice) : "—"}</div>
            </div>
            <div className="rounded border border-red-700/40 px-3 py-2">
              <div className="text-xs opacity-70">NO marginal price</div>
              <div className="font-mono text-lg">{noPrice ? pct(noPrice) : "—"}</div>
            </div>
          </div>
          <div className="text-xs opacity-60 grid grid-cols-2 gap-2">
            <span>pool yes: {market.pool_yes}</span>
            <span>pool no: {market.pool_no}</span>
            <span>b: {market.b_value}</span>
            <span>end block: {market.end_block}</span>
          </div>
        </>
      )}
    </ArchiveSectionShell>
  );
}
