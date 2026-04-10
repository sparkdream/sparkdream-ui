"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { MsgTypeUrls } from "@/lib/tx";
import { ContentType, CONTENT_TYPE_INFO } from "@/types/blog";

export default function CreatePostForm() {
  const router = useRouter();
  const { address, connected, signAndBroadcast } = useWallet();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [contentType, setContentType] = useState<number>(ContentType.TEXT);
  const [minReplyTrustLevel, setMinReplyTrustLevel] = useState(0);
  const [authorBond, setAuthorBond] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !title.trim() || !body.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const value: Record<string, unknown> = {
        creator: address,
        title: title.trim(),
        body: body.trim(),
        contentType,
        minReplyTrustLevel,
        initiativeId: 0,
      };
      if (authorBond && parseInt(authorBond) > 0) {
        value.authorBond = authorBond;
      }

      await signAndBroadcast([
        { typeUrl: MsgTypeUrls.CreatePost, value },
      ]);
      router.push("/blog");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post");
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <p className="text-zinc-400">Connect your wallet to create a post</p>
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

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        {showAdvanced ? "Hide" : "Show"} advanced options
      </button>

      {showAdvanced && (
        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
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
            <p className="mt-1 text-xs text-zinc-600">
              Minimum trust level required to reply to this post
            </p>
          </div>

          <div>
            <label htmlFor="authorBond" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Author Bond (DREAM)
            </label>
            <input
              id="authorBond"
              type="number"
              min="0"
              value={authorBond}
              onChange={(e) => setAuthorBond(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-zinc-600">
              Optional DREAM amount to lock as an author bond
            </p>
          </div>
        </div>
      )}

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
          {submitting ? "Publishing..." : "Publish Post"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
