"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { MsgTypeUrls } from "@/lib/tx";
import type { Post } from "@/types/blog";
import { CONTENT_TYPE_INFO } from "@/types/blog";

interface EditPostFormProps {
  post: Post;
}

export default function EditPostForm({ post }: EditPostFormProps) {
  const router = useRouter();
  const { address, connected, signAndBroadcast } = useWallet();
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [contentType, setContentType] = useState<number>(parseInt(post.content_type) || 0);
  const [repliesEnabled, setRepliesEnabled] = useState(!!post.replies_enabled);
  const [minReplyTrustLevel, setMinReplyTrustLevel] = useState(post.min_reply_trust_level);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !title.trim() || !body.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await signAndBroadcast([
        {
          typeUrl: MsgTypeUrls.UpdatePost,
          value: {
            creator: address,
            title: title.trim(),
            body: body.trim(),
            id: parseInt(post.id),
            contentType,
            repliesEnabled,
            minReplyTrustLevel,
          },
        },
      ]);
      router.push(`/blog/${post.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update post");
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected || address !== post.creator) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <p className="text-zinc-400">You can only edit your own posts</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Title
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Post title"
          maxLength={256}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="contentType" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Content Type
        </label>
        <select
          id="contentType"
          value={contentType}
          onChange={(e) => setContentType(Number(e.target.value))}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {Object.entries(CONTENT_TYPE_INFO).map(([val, info]) => (
            <option key={val} value={val}>
              {info.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="body" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Content
        </label>
        <textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your post..."
          rows={10}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-zinc-600">
          {body.length} characters
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex items-center justify-between">
          <label htmlFor="repliesEnabled" className="text-sm font-medium text-zinc-300">
            Replies Enabled
          </label>
          <button
            type="button"
            id="repliesEnabled"
            onClick={() => setRepliesEnabled(!repliesEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              repliesEnabled ? "bg-indigo-600" : "bg-zinc-700"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                repliesEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <div>
          <label htmlFor="minReplyTrustLevel" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Minimum Reply Trust Level
          </label>
          <select
            id="minReplyTrustLevel"
            value={minReplyTrustLevel}
            onChange={(e) => setMinReplyTrustLevel(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value={-1}>-1 (No restriction)</option>
            <option value={0}>0 (Default)</option>
            <option value={1}>1 (Basic)</option>
            <option value={2}>2 (Established)</option>
            <option value={3}>3 (Trusted)</option>
            <option value={4}>4 (Highly Trusted)</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || !title.trim() || !body.trim()}
          className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/blog/${post.id}`)}
          className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
