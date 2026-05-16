"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { listPosts } from "@/lib/api";
import type { Post } from "@/types/blog";
import CopyableAddress from "@/components/CopyableAddress";
import { ArchiveSectionShell, EmptyState, LoadError } from "../_components";

export default function ArchiveImaginariumList({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = use(params);
  const { entry } = useArchive();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    listPosts()
      .then((res) => {
        if (!cancelled) setPosts(res.post ?? []);
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
    <ArchiveSectionShell snapshotId={snapshotId} title="Imaginarium">
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {!loading && !error && posts.length === 0 && <EmptyState what="posts" />}
      <ul className="space-y-2">
        {posts.map((p) => (
          <li key={p.id}>
            <Link
              href={`/archive/${snapshotId}/imaginarium/${p.id}`}
              className="block rounded border border-white/10 hover:border-white/30 px-3 py-2"
            >
              <div className="font-medium">
                {p.title || p.body?.slice(0, 80) || `Post #${p.id}`}
              </div>
              <div className="text-xs opacity-60 mt-1 flex gap-3">
                <span>#{p.id}</span>
                <CopyableAddress address={p.creator} />
                <span>{p.reply_count} replies</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </ArchiveSectionShell>
  );
}
