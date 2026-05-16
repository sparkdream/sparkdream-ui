"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { listPublicCollections } from "@/lib/api";
import type { Collection } from "@/types/collect";
import { ArchiveSectionShell, EmptyState, LoadError } from "../_components";

export default function ArchiveWondersList({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = use(params);
  const { entry } = useArchive();
  const [items, setItems] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    listPublicCollections()
      .then((res) => {
        if (cancelled) return;
        setItems(res.collections ?? []);
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
    <ArchiveSectionShell snapshotId={snapshotId} title="Wonders">
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {!loading && !error && items.length === 0 && <EmptyState what="collections" />}
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.id}>
            <Link
              href={`/archive/${snapshotId}/wonders/${c.id}`}
              className="block rounded border border-white/10 hover:border-white/30 px-3 py-2"
            >
              <div className="flex items-baseline justify-between">
                <div className="font-medium">{c.name || `Collection #${c.id}`}</div>
                <div className="text-xs opacity-60 font-mono">
                  {c.item_count} items · {c.collaborator_count} collabs
                </div>
              </div>
              {c.description && (
                <div className="text-sm opacity-70 mt-1 line-clamp-2">{c.description}</div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </ArchiveSectionShell>
  );
}
