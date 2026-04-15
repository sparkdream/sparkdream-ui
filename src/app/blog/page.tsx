"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { Post } from "@/types/blog";
import { PostStatus } from "@/types/blog";
import { listPosts, getAllMemberAddresses } from "@/lib/api";
import PostCard from "@/components/PostCard";
import { useWallet } from "@/contexts/WalletContext";

type SortOption = "newest" | "oldest";
type FilterOption = "my-posts" | "members" | "all";

export default function BlogPage() {
  const { connected, address } = useWallet();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [memberAddresses, setMemberAddresses] = useState<Set<string>>(
    new Set()
  );
  const [membersLoading, setMembersLoading] = useState(true);

  const [filter, setFilter] = useState<FilterOption>("members");
  const [sort, setSort] = useState<SortOption>("newest");
  const [filterRestored, setFilterRestored] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("blog-filter");
    if (saved === "my-posts" || saved === "members" || saved === "all") {
      // Only restore "my-posts" if connected
      if (saved === "my-posts" && !connected) {
        setFilter("members");
      } else {
        setFilter(saved);
      }
    }
    setFilterRestored(true);
  }, []);

  useEffect(() => {
    if (filterRestored) localStorage.setItem("blog-filter", filter);
  }, [filter, filterRestored]);

  // Fetch all member addresses once
  useEffect(() => {
    getAllMemberAddresses()
      .then(setMemberAddresses)
      .catch(() => {})
      .finally(() => setMembersLoading(false));
  }, []);

  const fetchPosts = useCallback(async (paginationKey?: string) => {
    try {
      setLoading(true);
      const res = await listPosts({
        limit: "20",
        countTotal: true,
        reverse: true,
        ...(paginationKey ? { key: paginationKey } : {}),
      });
      const activePosts = (res.post || []).filter(
        (p) => p.status !== PostStatus.DELETED
      );
      setPosts((prev) =>
        paginationKey ? [...prev, ...activePosts] : activePosts
      );
      setNextKey(res.pagination?.next_key || null);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load posts"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Infinite scroll
  const nextKeyRef = useRef(nextKey);
  nextKeyRef.current = nextKey;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && nextKeyRef.current && !loadingRef.current) {
          fetchPosts(nextKeyRef.current);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchPosts]);

  const filteredAndSorted = useMemo(() => {
    let result = posts;

    if (filter === "my-posts" && address) {
      result = result.filter((p) => p.creator === address);
    } else if (filter === "members" && memberAddresses.size > 0) {
      result = result.filter((p) => memberAddresses.has(p.creator));
    }

    if (sort === "oldest") {
      result = [...result].sort(
        (a, b) => parseInt(a.created_at, 10) - parseInt(b.created_at, 10)
      );
    }
    // "newest" is already the default API order

    return result;
  }, [posts, filter, sort, memberAddresses, address]);

  if (!filterRestored) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 animate-pulse">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-transparent">Blog</h1>
            <p className="mt-1 text-sm text-transparent">
              On-chain posts from the Spark Dream community
            </p>
          </div>
        </div>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
            <div className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-transparent">Members</div>
            <div className="rounded-md px-3 py-1.5 text-xs font-medium text-transparent">All Posts</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-transparent">Newest first</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-3 w-24 rounded bg-zinc-800" />
            <div className="h-3 w-3 rounded-full bg-zinc-800" />
            <div className="h-3 w-16 rounded bg-zinc-800" />
          </div>
          <div className="mb-3 h-5 w-3/5 rounded bg-zinc-800" />
          <div className="mb-1.5 h-3.5 w-full rounded bg-zinc-800" />
          <div className="h-3.5 w-4/5 rounded bg-zinc-800" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Blog</h1>
          <p className="mt-1 text-sm text-zinc-500">
            On-chain posts from the Spark Dream community
          </p>
        </div>
        {connected && (
          <Link
            href="/blog/new"
            className="w-fit rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            New Post
          </Link>
        )}
      </div>

      {/* Filter & Sort Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
          {connected && (
            <button
              onClick={() => setFilter("my-posts")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === "my-posts"
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-zinc-300"
              }`}
            >
              My Posts
            </button>
          )}
          <button
            onClick={() => setFilter("members")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "members"
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-zinc-300"
            }`}
          >
            Members
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === "all"
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-zinc-300"
            }`}
          >
            All Posts
          </button>
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-400 focus:border-zinc-600 focus:outline-none"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>

        {membersLoading && filter === "members" && posts.length > 0 && (
          <span className="text-xs text-zinc-600">Loading members...</span>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button
            onClick={() => fetchPosts()}
            className="ml-2 underline hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {(loading && posts.length === 0) || (membersLoading && filter === "members") ? (
        <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-3 w-24 rounded bg-zinc-800" />
            <div className="h-3 w-3 rounded-full bg-zinc-800" />
            <div className="h-3 w-16 rounded bg-zinc-800" />
          </div>
          <div className="mb-3 h-5 w-3/5 rounded bg-zinc-800" />
          <div className="mb-1.5 h-3.5 w-full rounded bg-zinc-800" />
          <div className="mb-4 h-3.5 w-4/5 rounded bg-zinc-800" />
          <div className="flex items-center justify-between">
            <div className="flex gap-3">
              <div className="h-3 w-8 rounded bg-zinc-800" />
              <div className="h-3 w-8 rounded bg-zinc-800" />
            </div>
            <div className="h-3 w-16 rounded bg-zinc-800" />
          </div>
        </div>
      ) : filteredAndSorted.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">
            {filter === "members" && posts.length > 0
              ? "No member posts found"
              : "No posts yet"}
          </p>
          {filter === "members" && posts.length > 0 ? (
            <button
              onClick={() => setFilter("all")}
              className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300"
            >
              Show all posts
            </button>
          ) : (
            connected && (
              <Link
                href="/blog/new"
                className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300"
              >
                Create the first post
              </Link>
            )
          )}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {filteredAndSorted.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          <div ref={sentinelRef} className="h-px" />
          {loading && posts.length > 0 && (
            <div className="mt-4 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="h-3 w-24 rounded bg-zinc-800" />
                <div className="h-3 w-3 rounded-full bg-zinc-800" />
                <div className="h-3 w-16 rounded bg-zinc-800" />
              </div>
              <div className="mb-3 h-5 w-3/5 rounded bg-zinc-800" />
              <div className="mb-1.5 h-3.5 w-full rounded bg-zinc-800" />
              <div className="h-3.5 w-4/5 rounded bg-zinc-800" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
