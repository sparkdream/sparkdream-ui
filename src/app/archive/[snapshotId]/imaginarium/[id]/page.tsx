"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { getPost, listReplies, getReactionCounts } from "@/lib/api";
import type { Post, Reply, ReactionCounts } from "@/types/blog";
import CopyableAddress from "@/components/CopyableAddress";
import { formatTime } from "@/lib/utils";

export default function ArchivePostPage({
  params,
}: {
  params: Promise<{ snapshotId: string; id: string }>;
}) {
  const { snapshotId, id } = use(params);
  const { entry, manifestReady } = useArchive();
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [counts, setCounts] = useState<ReactionCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [p, r, c] = await Promise.all([
          getPost(id),
          listReplies(id).catch(() => null),
          getReactionCounts(id).catch(() => null),
        ]);
        if (cancelled) return;
        setPost(p.post);
        setReplies(r?.replies ?? []);
        setCounts(c?.counts ?? null);
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

  if (!manifestReady) return <div className="p-6 opacity-70">Loading manifest…</div>;
  if (!entry) return <div className="p-6">Snapshot not found.</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <Link
        href={`/archive/${snapshotId}/imaginarium`}
        className="text-sm opacity-70 hover:opacity-100"
      >
        ← back to imaginarium
      </Link>

      {loading && <p className="opacity-70">Loading…</p>}
      {error && <p className="text-red-400">{error}</p>}

      {post && (
        <article className="space-y-3">
          {post.title && <h1 className="text-2xl font-semibold">{post.title}</h1>}
          <div className="text-xs opacity-60 flex gap-3 flex-wrap">
            <span>#{post.id}</span>
            <CopyableAddress address={post.creator} />
            {post.created_at && <span>{formatTime(post.created_at)}</span>}
            {post.updated_at && post.updated_at !== post.created_at && (
              <span>edited {formatTime(post.updated_at)}</span>
            )}
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{post.body}</div>
          {counts && (
            <div className="flex gap-4 text-xs opacity-70">
              <span>👍 {counts.like_count}</span>
              <span>💡 {counts.insightful_count}</span>
              <span>😆 {counts.funny_count}</span>
              <span>👎 {counts.disagree_count}</span>
            </div>
          )}
        </article>
      )}

      {replies.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Replies ({replies.length})</h2>
          <ul className="space-y-2">
            {replies.map((r) => (
              <li key={r.id} className="rounded border border-white/10 px-3 py-2 text-sm">
                <div className="text-xs opacity-60 mb-1 flex gap-2 flex-wrap">
                  <CopyableAddress address={r.creator} />
                  {r.created_at && <span>{formatTime(r.created_at)}</span>}
                </div>
                <div className="whitespace-pre-wrap">{r.body}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
