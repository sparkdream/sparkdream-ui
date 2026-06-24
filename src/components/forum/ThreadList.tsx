"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listForumPostsByCategory,
  listForumPosts,
  getUserForumPosts,
  getForumPost,
  authorBondsByType,
  listPostFlags,
} from "@/lib/api";
import { timeAgo, formatSpark } from "@/lib/utils";
import NameOrAddress from "@/components/NameOrAddress";
import { useWallet } from "@/contexts/WalletContext";
import type { ForumPost, PostFlag } from "@/types/forum";
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

// StakeTargetType numeric value for x/forum author bonds.
const FORUM_AUTHOR_BOND = 8;

interface ThreadListProps {
  mode: "category" | "all" | "my-posts" | "top" | "bonded" | "flagged";
  category?: Category | null;
  onSelectThread: (post: ForumPost) => void;
  tagFilter?: string | null;
  /** Authors at or above the selected trust level; null/undefined disables the filter. */
  trustAddresses?: Set<string> | null;
  /** Optional CTA shown in the empty state to open the new-spark form. */
  onCreate?: () => void;
}

export default function ThreadList({ mode, category, onSelectThread, tagFilter, trustAddresses, onCreate }: ThreadListProps) {
  const { address } = useWallet();
  const [threads, setThreads] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);
  // Bonded mode: post_id → bonded amount (micro-DREAM), and the chosen order.
  const [bondAmounts, setBondAmounts] = useState<Map<string, string>>(new Map());
  const [bondSort, setBondSort] = useState<"date" | "high" | "low">("date");
  // Flagged mode: post_id → its flag record, and the chosen order.
  const [flagInfo, setFlagInfo] = useState<Map<string, PostFlag>>(new Map());
  const [flagSort, setFlagSort] = useState<"weight" | "date">("weight");

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
        posts = (res.posts || []).filter((p) => p.status !== PostStatus.DELETED);
        nk = res.pagination?.next_key || null;
      } else if (mode === "bonded") {
        // All forum author bonds from the rep index, then the bonded posts
        // themselves. Replies can carry bonds too; they're listed and the
        // click handler resolves them to their root thread via root_id.
        const bonds = [];
        let key: string | undefined;
        do {
          const res = await authorBondsByType(FORUM_AUTHOR_BOND, {
            limit: "200",
            ...(key ? { key } : {}),
          });
          bonds.push(...(res.bonds || []));
          key = res.pagination?.next_key || undefined;
        } while (key);
        setBondAmounts(new Map(bonds.map((b) => [b.target_id, b.amount])));
        const fetched = await Promise.all(
          bonds.map((b) => getForumPost(b.target_id).then((r) => r.post).catch(() => null))
        );
        posts = fetched.filter(
          (p): p is ForumPost =>
            !!p && p.status !== PostStatus.DELETED && p.status !== PostStatus.HIDDEN
        );
        nk = null;
      } else if (mode === "flagged") {
        // Every flag record from the chain, then the flagged posts themselves.
        // Replies can be flagged too; the click handler resolves them to their
        // root thread via root_id. Already-hidden/deleted posts are dropped:
        // the feed is the queue of still-actionable reports.
        const flags: PostFlag[] = [];
        let key: string | undefined;
        do {
          const res = await listPostFlags({ limit: "200", ...(key ? { key } : {}) });
          flags.push(...(res.post_flag || []));
          key = res.pagination?.next_key || undefined;
        } while (key);
        setFlagInfo(new Map(flags.map((f) => [f.post_id, f])));
        const fetched = await Promise.all(
          flags.map((f) => getForumPost(f.post_id).then((r) => r.post).catch(() => null))
        );
        posts = fetched.filter(
          (p): p is ForumPost =>
            !!p && p.status !== PostStatus.DELETED && p.status !== PostStatus.HIDDEN
        );
        nk = null;
      } else if (mode === "top") {
        const res = await listForumPosts({ limit: "50", reverse: true });
        const rootPosts = (res.post || []).filter(
          (p) =>
            (p.parent_id === "0" || !p.parent_id) &&
            p.status !== PostStatus.DELETED &&
            p.status !== PostStatus.HIDDEN
        );
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
        // Filter to root posts only (threads), excluding deleted and hidden.
        // Hidden posts stay out of the public "All sparks" feed; moderators see
        // them via the Sentinel panel and authors via "My sparks".
        posts = (res.post || []).filter(
          (p) =>
            (p.parent_id === "0" || !p.parent_id) &&
            p.status !== PostStatus.DELETED &&
            p.status !== PostStatus.HIDDEN
        );
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
        posts = (res.posts || []).filter((p) => p.status !== PostStatus.DELETED);
        nk = res.pagination?.next_key || null;
      } else {
        const res = await listForumPosts({ limit: PAGE_SIZE, key: nextKey, reverse: true });
        posts = (res.post || []).filter(
          (p) =>
            (p.parent_id === "0" || !p.parent_id) &&
            p.status !== PostStatus.DELETED &&
            p.status !== PostStatus.HIDDEN
        );
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
          <div key={i} className="h-20 animate-pulse sd-hull-tile rounded-xl" />
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

  let visible = tagFilter
    ? threads.filter((p) => (p.tags || []).includes(tagFilter))
    : threads;
  if (trustAddresses) {
    visible = visible.filter((p) => trustAddresses.has(p.author));
  }
  if (mode === "bonded") {
    visible = [...visible].sort((a, b) => {
      if (bondSort === "date") {
        return parseInt(b.created_at || "0", 10) - parseInt(a.created_at || "0", 10);
      }
      const av = BigInt(bondAmounts.get(a.post_id) || "0");
      const bv = BigInt(bondAmounts.get(b.post_id) || "0");
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return bondSort === "high" ? -cmp : cmp;
    });
  }
  if (mode === "flagged") {
    visible = [...visible].sort((a, b) => {
      if (flagSort === "date") {
        const at = parseInt(flagInfo.get(a.post_id)?.last_flag_at || "0", 10);
        const bt = parseInt(flagInfo.get(b.post_id)?.last_flag_at || "0", 10);
        return bt - at;
      }
      // Weight desc, with posts already in the review queue surfaced first.
      const aq = flagInfo.get(a.post_id)?.in_review_queue ? 1 : 0;
      const bq = flagInfo.get(b.post_id)?.in_review_queue ? 1 : 0;
      if (aq !== bq) return bq - aq;
      const aw = BigInt(flagInfo.get(a.post_id)?.total_weight || "0");
      const bw = BigInt(flagInfo.get(b.post_id)?.total_weight || "0");
      return aw < bw ? 1 : aw > bw ? -1 : 0;
    });
  }

  const title =
    mode === "category" && category
      ? category.title
      : mode === "my-posts"
        ? "My sparks"
        : mode === "top"
          ? "Top sparks"
          : mode === "bonded"
            ? "Bonded sparks"
            : mode === "flagged"
              ? "Flagged sparks"
              : "All sparks";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {mode === "bonded" && (
          <select
            className="sd-select"
            value={bondSort}
            onChange={(e) => setBondSort(e.target.value as "date" | "high" | "low")}
            title="Order bonded sparks"
          >
            <option value="date">By date</option>
            <option value="high">Highest bond</option>
            <option value="low">Lowest bond</option>
          </select>
        )}
        {mode === "flagged" && (
          <select
            className="sd-select"
            value={flagSort}
            onChange={(e) => setFlagSort(e.target.value as "weight" | "date")}
            title="Order flagged sparks"
          >
            <option value="weight">Most flagged</option>
            <option value="date">Recently flagged</option>
          </select>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">
            {mode === "my-posts"
              ? "You have no sparks yet"
              : mode === "flagged"
                ? "No flagged sparks"
                : "No sparks found"}
          </p>
          {onCreate && !tagFilter && !trustAddresses && (
            <button
              type="button"
              onClick={onCreate}
              style={{
                display: "inline-block",
                marginTop: 12,
                background: "transparent",
                border: 0,
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {mode === "my-posts" ? "Light your first spark" : "Light the first spark"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((post) => {
            const votes = (parseInt(post.upvote_count || "0", 10)) - (parseInt(post.downvote_count || "0", 10));
            const contentPreview = post.content?.length > 120
              ? post.content.slice(0, 120) + "..."
              : post.content;

            return (
              <button
                key={post.post_id}
                onClick={() => onSelectThread(post)}
                className="sd-hull-tile interactive w-full rounded-xl px-4 py-3 text-left"
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
                      {bondAmounts.has(post.post_id) && (
                        <span
                          className="sd-pill"
                          style={{ background: "var(--amber-soft)", color: "var(--amber)" }}
                          title="DREAM locked by the author as a bond"
                        >
                          {formatSpark(bondAmounts.get(post.post_id)!)} DREAM bond
                        </span>
                      )}
                      {flagInfo.has(post.post_id) && (() => {
                        const f = flagInfo.get(post.post_id)!;
                        const count = f.flaggers?.length ?? 0;
                        return (
                          <>
                            <span
                              className="text-red-400"
                              title={`Flag weight ${f.total_weight} from ${count} ${count === 1 ? "flagger" : "flaggers"}`}
                            >
                              {count} {count === 1 ? "flag" : "flags"}
                            </span>
                            {f.in_review_queue && (
                              <span className="text-orange-400" title="Reached the review threshold">
                                In review
                              </span>
                            )}
                          </>
                        );
                      })()}
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
