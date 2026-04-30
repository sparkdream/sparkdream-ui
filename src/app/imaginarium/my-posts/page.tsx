"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Post } from "@/types/blog";
import { PostStatus } from "@/types/blog";
import { listPostsByCreator } from "@/lib/api";
import PostCard from "@/components/PostCard";
import CreatePostForm from "@/components/CreatePostForm";
import { useWallet } from "@/contexts/WalletContext";

export default function MyPostsPage() {
  const { address, connected, ready } = useWallet();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

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
        setError(err instanceof Error ? err.message : "Failed to load dreams");
      } finally {
        setLoading(false);
      }
    },
    [address]
  );

  useEffect(() => {
    if (!ready) return;
    if (connected && address) {
      fetchPosts();
    } else {
      setLoading(false);
    }
  }, [ready, connected, address, fetchPosts]);

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

  if (!ready) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-8">
          <div className="h-7 w-32 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-48 animate-pulse rounded bg-zinc-800/60" />
        </div>
        <div className="animate-pulse sd-hull-tile rounded-xl p-5">
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

  if (!connected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-white">My dreams</h1>
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">Connect your wallet to see your dreams</p>
        </div>
      </div>
    );
  }

  if (showCreate) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-white">New ✦dream</h1>
        <CreatePostForm
          onCreated={() => setShowCreate(false)}
          onCancel={() => setShowCreate(false)}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My dreams</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Dreams published by your account
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="sd-btn sd-btn-dream"
        >
          <img
            src="/vision.svg"
            alt=""
            aria-hidden="true"
            width={15}
            height={15}
            className="telescope"
          />
          New dream
        </button>
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
        <div className="animate-pulse sd-hull-tile rounded-xl p-5">
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
      ) : posts.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">You haven&apos;t published any dreams yet</p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300"
          >
            Publish your first dream
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>

          <div ref={sentinelRef} className="h-px" />
          {loading && posts.length > 0 && (
            <div className="mt-4 animate-pulse sd-hull-tile rounded-xl p-5">
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
