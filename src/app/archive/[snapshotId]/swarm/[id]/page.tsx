"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { getForumThread, getForumThreadMetadata } from "@/lib/api";
import type { ForumPost, ThreadMetadata } from "@/types/forum";
import CopyableAddress from "@/components/CopyableAddress";
import { formatTime } from "@/lib/utils";
import { ArchiveSectionShell, LoadError } from "../../_components";

export default function ArchiveThreadDetail({
  params,
}: {
  params: Promise<{ snapshotId: string; id: string }>;
}) {
  const { snapshotId, id } = use(params);
  const { entry } = useArchive();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [metadata, setMetadata] = useState<ThreadMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    (async () => {
      try {
        const [t, m] = await Promise.all([
          getForumThread(id),
          getForumThreadMetadata(id).catch(() => null),
        ]);
        if (cancelled) return;
        setPosts(t.posts ?? []);
        setMetadata(m?.thread_metadata ?? null);
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

  const root = posts.find((p) => p.post_id === id) || posts[0];
  const replies = posts.filter((p) => p.post_id !== root?.post_id);
  const acceptedReplyId = metadata?.accepted_reply_id ?? "0";

  return (
    <ArchiveSectionShell snapshotId={snapshotId} title={`Thread #${id}`}>
      <Link
        href={`/archive/${snapshotId}/swarm`}
        className="text-sm opacity-70 hover:opacity-100 -mt-2 block"
      >
        ← back to swarm
      </Link>
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {root && (
        <article className="space-y-3 rounded border border-white/10 p-4">
          <div className="text-xs opacity-60 flex gap-3 flex-wrap">
            <CopyableAddress address={root.author} />
            <span>{formatTime(root.created_at)}</span>
            <span>👍 {root.upvote_count} · 👎 {root.downvote_count}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{root.content}</div>
        </article>
      )}

      {replies.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium opacity-70">Replies ({replies.length})</h2>
          <ul className="space-y-2">
            {replies.map((r) => {
              const accepted = r.post_id === acceptedReplyId && acceptedReplyId !== "0";
              return (
                <li
                  key={r.post_id}
                  className={`rounded border px-3 py-2 text-sm ${
                    accepted ? "border-emerald-700/60 bg-emerald-900/10" : "border-white/10"
                  }`}
                >
                  <div className="text-xs opacity-60 flex gap-3 flex-wrap mb-1">
                    <CopyableAddress address={r.author} />
                    <span>{formatTime(r.created_at)}</span>
                    {accepted && <span className="text-emerald-400">✓ accepted</span>}
                  </div>
                  <div className="whitespace-pre-wrap">{r.content}</div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </ArchiveSectionShell>
  );
}
