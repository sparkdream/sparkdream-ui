"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { getCollection, listCollectionItems, getCollaborators } from "@/lib/api";
import type { Collection, CollectionItem, Collaborator } from "@/types/collect";
import CopyableAddress from "@/components/CopyableAddress";
import { formatTime } from "@/lib/utils";
import { ArchiveSectionShell, LoadError } from "../../_components";

export default function ArchiveCollectionDetail({
  params,
}: {
  params: Promise<{ snapshotId: string; id: string }>;
}) {
  const { snapshotId, id } = use(params);
  const { entry } = useArchive();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    (async () => {
      try {
        const [c, i, co] = await Promise.all([
          getCollection(id),
          listCollectionItems(id).catch(() => null),
          getCollaborators(id).catch(() => null),
        ]);
        if (cancelled) return;
        setCollection(c.collection);
        setItems(i?.items ?? []);
        setCollaborators(co?.collaborators ?? []);
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
      title={collection?.name || `Collection #${id}`}
    >
      <Link
        href={`/archive/${snapshotId}/wonders`}
        className="text-sm opacity-70 hover:opacity-100 -mt-2 block"
      >
        ← back to wonders
      </Link>
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {collection && (
        <>
          {collection.description && (
            <p className="text-sm whitespace-pre-wrap">{collection.description}</p>
          )}
          <div className="text-xs opacity-60 flex gap-3 flex-wrap">
            <span>type: {collection.type}</span>
            <span>visibility: {collection.visibility}</span>
            <span>owner: <CopyableAddress address={collection.owner} /></span>
            {collection.created_at && <span>created: {formatTime(collection.created_at)}</span>}
            {collection.updated_at && collection.updated_at !== collection.created_at && (
              <span>updated: {formatTime(collection.updated_at)}</span>
            )}
          </div>

          {collaborators.length > 0 && (
            <section>
              <h2 className="text-sm font-medium opacity-70 mb-1">Collaborators</h2>
              <ul className="text-xs space-y-1">
                {collaborators.map((c) => (
                  <li key={c.address} className="flex gap-3">
                    <CopyableAddress address={c.address} />
                    <span className="opacity-60">{c.role}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-sm font-medium opacity-70 mb-2">
              Items ({items.length})
            </h2>
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded border border-white/10 px-3 py-2 text-sm"
                >
                  <div className="font-medium">{item.title || `Item #${item.id}`}</div>
                  {item.description && (
                    <div className="text-xs opacity-70 mt-1">{item.description}</div>
                  )}
                  <div className="text-xs opacity-50 mt-1 flex gap-3">
                    <CopyableAddress address={item.added_by} />
                    <span>👍 {item.upvote_count} · 👎 {item.downvote_count}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </ArchiveSectionShell>
  );
}
