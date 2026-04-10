"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Post } from "@/types/blog";
import { getPost } from "@/lib/api";
import EditPostForm from "@/components/EditPostForm";

export default function EditPostPage() {
  const params = useParams();
  const id = params.id as string;
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPost(id)
      .then((res) => setPost(res.post))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load post")
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="mt-6 h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border border-red-800 bg-red-900/20 p-6 text-center">
          <p className="text-red-400">{error || "Post not found"}</p>
          <Link
            href="/blog"
            className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300"
          >
            Back to blog
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-white">Edit Post</h1>
      <EditPostForm post={post} />
    </div>
  );
}
