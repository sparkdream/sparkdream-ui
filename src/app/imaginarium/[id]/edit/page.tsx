"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Post } from "@/types/blog";
import { getPost } from "@/lib/api";
import EditPostForm from "@/components/EditPostForm";
import ErrorState from "@/components/ErrorState";

export default function EditPostPage() {
  const params = useParams();
  const id = params.id as string;
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    getPost(id)
      .then((res) => setPost(res.post))
      .catch((err) =>
        setError(err)
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="mt-6 h-64 animate-pulse sd-hull-tile rounded-xl" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorState error={error} fallback="Dream not found" />
        <Link
          href="/imaginarium"
          className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300"
        >
          Back to imaginarium
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-white">Edit dream</h1>
      <EditPostForm post={post} />
    </div>
  );
}
