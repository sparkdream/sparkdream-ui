"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { listForumPosts } from "@/lib/api";
import type { ForumPost } from "@/types/forum";
import CopyableAddress from "@/components/CopyableAddress";
import { ArchiveSectionShell, EmptyState, LoadError } from "../_components";

export default function ArchiveSwarmList({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = use(params);
  const { entry } = useArchive();
  const [threads, setThreads] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    listForumPosts()
      .then((res) => {
        if (cancelled) return;
        const all = res.post ?? [];
        // Only show thread roots in the list (parent_id "0" or post_id === root_id).
        setThreads(
          all.filter((p) => p.parent_id === "0" || p.post_id === p.root_id),
        );
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
    <ArchiveSectionShell snapshotId={snapshotId} title="Swarm">
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {!loading && !error && threads.length === 0 && <EmptyState what="threads" />}
      <ul className="space-y-2">
        {threads.map((t) => (
          <li key={t.post_id}>
            <Link
              href={`/archive/${snapshotId}/swarm/${t.post_id}`}
              className="block rounded border border-white/10 hover:border-white/30 px-3 py-2"
            >
              <div className="text-sm line-clamp-2">{t.content || `Thread #${t.post_id}`}</div>
              <div className="text-xs opacity-60 mt-1 flex gap-3">
                <CopyableAddress address={t.author} />
                <span>👍 {t.upvote_count} · 👎 {t.downvote_count}</span>
                {t.locked && <span className="text-amber-400">locked</span>}
                {t.pinned && <span className="text-indigo-400">pinned</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </ArchiveSectionShell>
  );
}
