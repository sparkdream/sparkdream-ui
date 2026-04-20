"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listForumPostsByCategory,
  listForumPosts,
  getUserForumPosts,
} from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import NameOrAddress from "@/components/NameOrAddress";
import { useWallet } from "@/contexts/WalletContext";
import type { ForumPost } from "@/types/forum";
import { PostStatus, PostStatusValue, POST_STATUS_LABELS } from "@/types/forum";
import type { Category } from "@/types/commons";

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    [PostStatus.ACTIVE]: "text-emerald-400",
    [PostStatus.HIDDEN]: "text-red-400",
    [PostStatus.DELETED]: "text-zinc-500",
    [PostStatus.ARCHIVED]: "text-amber-400",
  };
  return (
    <span className={`text-xs ${colors[status] || "text-zinc-500"}`}>
      {POST_STATUS_LABELS[status] || status}
    </span>
  );
}

const PAGE_SIZE = "20";

interface ThreadListProps {
  mode: "category" | "all" | "my-posts" | "top";
  category?: Category | null;
  onSelectThread: (post: ForumPost) => void;
}

export default function ThreadList({ mode, category, onSelectThread }: ThreadListProps) {
  const { address } = useWallet();
  const [threads, setThreads] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let posts: ForumPost[] = [];
      let nk: string | null = null;

      if (mode === "category" && category) {
        const res = await listForumPostsByCategory(
          category.category_id,
          PostStatusValue[PostStatus.ACTIVE],
          { limit: PAGE_SIZE }
        );
        posts = res.posts || [];
        nk = res.pagination?.next_key || null;
      } else if (mode === "my-posts" && address) {
        const res = await getUserForumPosts(address, { limit: PAGE_SIZE });
        posts = res.posts || [];
        nk = res.pagination?.next_key || null;
      } else if (mode === "top") {
        const res = await listForumPosts({ limit: "50", reverse: true });
        const rootPosts = (res.post || []).filter((p) => p.parent_id === "0" || !p.parent_id);
        // Sort by net votes descending
        rootPosts.sort((a, b) => {
          const va = parseInt(a.upvote_count || "0", 10) - parseInt(a.downvote_count || "0", 10);
          const vb = parseInt(b.upvote_count || "0", 10) - parseInt(b.downvote_count || "0", 10);
          return vb - va;
        });
        posts = rootPosts.slice(0, parseInt(PAGE_SIZE, 10));
        nk = null; // client-side sort, no server pagination
      } else {
        const res = await listForumPosts({ limit: PAGE_SIZE, reverse: true });
        // Filter to root posts only (threads)
        posts = (res.post || []).filter((p) => p.parent_id === "0" || !p.parent_id);
        nk = res.pagination?.next_key || null;
      }

      setThreads(posts);
      setNextKey(nk);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load threads";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setThreads([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [mode, category, address]);

  const loadMore = useCallback(async () => {
    if (!nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      let posts: ForumPost[] = [];
      let nk: string | null = null;

      if (mode === "category" && category) {
        const res = await listForumPostsByCategory(
          category.category_id,
          PostStatusValue[PostStatus.ACTIVE],
          { limit: PAGE_SIZE, key: nextKey }
        );
        posts = res.posts || [];
        nk = res.pagination?.next_key || null;
      } else if (mode === "my-posts" && address) {
        const res = await getUserForumPosts(address, { limit: PAGE_SIZE, key: nextKey });
        posts = res.posts || [];
        nk = res.pagination?.next_key || null;
      } else {
        const res = await listForumPosts({ limit: PAGE_SIZE, key: nextKey, reverse: true });
        posts = (res.post || []).filter((p) => p.parent_id === "0" || !p.parent_id);
        nk = res.pagination?.next_key || null;
      }

      setThreads((prev) => [...prev, ...posts]);
      setNextKey(nk);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextKey, loadingMore, mode, category, address]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchThreads} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  const title =
    mode === "category" && category
      ? category.title
      : mode === "my-posts"
        ? "My Posts"
        : mode === "top"
          ? "Top Posts"
          : "All Posts";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">
            {mode === "my-posts" ? "You have no forum posts yet" : "No posts found"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((post) => {
            const votes = (parseInt(post.upvote_count || "0", 10)) - (parseInt(post.downvote_count || "0", 10));
            const contentPreview = post.content?.length > 120
              ? post.content.slice(0, 120) + "..."
              : post.content;

            return (
              <button
                key={post.post_id}
                onClick={() => onSelectThread(post)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-zinc-100">
                        {contentPreview || `Thread #${post.post_id}`}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      <NameOrAddress address={post.author} />
                      {post.created_at && <span>{timeAgo(post.created_at)}</span>}
                      {statusBadge(post.status)}
                      {post.pinned && (
                        <span className="text-amber-400">Pinned</span>
                      )}
                      {post.locked && (
                        <span className="text-red-400">Locked</span>
                      )}
                      {post.tags?.length > 0 && (
                        <span className="truncate">{post.tags.slice(0, 3).join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-zinc-500">
                    {(votes !== 0) && (
                      <span className={votes >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {votes >= 0 ? "+" : ""}{votes}
                      </span>
                    )}
                    <svg className="h-4 w-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </div>
              </button>
            );
          })}
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
