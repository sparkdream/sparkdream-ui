"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Post } from "@/types/blog";
import { PostStatus } from "@/types/blog";
import { listPostsByCreator } from "@/lib/api";
import PostCard from "@/components/PostCard";
import { useWallet } from "@/contexts/WalletContext";

export default function MyPostsPage() {
  const { address, connected } = useWallet();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);

  const fetchPosts = useCallback(
    async (paginationKey?: string) => {
      if (!address) return;
      try {
        setLoading(true);
        const res = await listPostsByCreator(address, {
          limit: "20",
          countTotal: true,
          reverse: true,
          ...(paginationKey ? { key: paginationKey } : {}),
        });
        const activePosts = (res.posts || []).filter(
          (p) => p.status !== PostStatus.DELETED
        );
        setPosts((prev) =>
          paginationKey ? [...prev, ...activePosts] : activePosts
        );
        setNextKey(res.pagination?.next_key || null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load posts");
      } finally {
        setLoading(false);
      }
    },
    [address]
  );

  useEffect(() => {
    if (connected && address) {
      fetchPosts();
    } else {
      setLoading(false);
    }
  }, [connected, address, fetchPosts]);

  if (!connected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-white">My Posts</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">Connect your wallet to see your posts</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My Posts</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Posts published by your account
          </p>
        </div>
        <Link
          href="/blog/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          New Post
        </Link>
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

      {loading && posts.length === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50"
            />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">You haven&apos;t published any posts yet</p>
          <Link
            href="/blog/new"
            className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300"
          >
            Create your first post
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          {nextKey && (
            <div className="mt-6 text-center">
              <button
                onClick={() => fetchPosts(nextKey)}
                disabled={loading}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-50"
              >
                {loading ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
