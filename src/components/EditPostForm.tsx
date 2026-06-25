"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { MsgTypeUrls } from "@/lib/tx";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import { invalidatePost, invalidatePostsLists } from "@/lib/api";
import type { Post } from "@/types/blog";
import { CONTENT_TYPE_INFO } from "@/types/blog";
import TagPicker from "@/components/contribute/TagPicker";

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
  const [tags, setTags] = useState<string[]>(post.tags || []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCreateTags = useCanCreateTags(address);
  const { tags: availableTags, loading: loadingTags, refresh: refreshTags } = useTagRegistry();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !title.trim() || !body.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      // x/blog's UpdatePost overwrites val.Tags = msg.Tags unconditionally and
      // diffs old vs new to drop the post from removed tags' index entries
      // (see x/blog/keeper/msg_server_update_post.go), so we must always
      // include the current tag set or every edit wipes the post's tags. Any
      // newly typed tag that isn't yet in the registry is pre-created via
      // MsgCreateTag — same pattern as CreatePostForm.
      const tagMsgs = buildCreateTagMsgs(address!, tags, availableTags);
      await signAndBroadcast([
        ...tagMsgs,
        {
          typeUrl: MsgTypeUrls.UpdatePost,
          value: {
            creator: address,
            title: title.trim(),
            body: body.trim(),
            // post id is uint64; pass BigInt so sparkdreamjs's amino override
            // `!== BigInt(0)` survives strict equality (Number !== BigInt is
            // always true, which would sign "id":"0" for any zero id and
            // mismatch the chain's omit-zero aminojson on sigverify).
            id: BigInt(post.id),
            contentType,
            repliesEnabled,
            minReplyTrustLevel,
            tags,
          },
        },
      ]);
      invalidatePost(post.id);
      invalidatePostsLists(address!);
      if (tagMsgs.length > 0) refreshTags();
      router.push(`/imaginarium/${post.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update dream");
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected || address !== post.creator) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <p className="text-zinc-400">You can only edit your own dreams</p>
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
          placeholder="Dream title"
          maxLength={256}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="contentType" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Content type
        </label>
        <select
          id="contentType"
          value={contentType}
          onChange={(e) => setContentType(Number(e.target.value))}
          className="sd-select w-full"
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
          placeholder="Write your dream..."
          rows={10}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-zinc-600">
          {body.length} characters
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">Tags</label>
        <TagPicker
          options={availableTags}
          value={tags}
          onChange={setTags}
          placeholder={canCreateTags ? "Select or create tags..." : "Select tags..."}
          loading={loadingTags}
          allowCreate={canCreateTags}
        />
      </div>

      <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="flex items-center justify-between">
          <label htmlFor="repliesEnabled" className="text-sm font-medium text-zinc-300">
            Replies enabled
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
            Minimum reply trust level
          </label>
          <select
            id="minReplyTrustLevel"
            value={minReplyTrustLevel}
            onChange={(e) => setMinReplyTrustLevel(Number(e.target.value))}
            className="sd-select w-full"
          >
            <option value={-1}>-1 (No restriction)</option>
            <option value={0}>0 (Default)</option>
            <option value={1}>1 (Basic)</option>
            <option value={2}>2 (Established)</option>
            <option value={3}>3 (Trusted)</option>
            <option value={4}>4 (Highly trusted)</option>
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
          className="sd-btn sd-btn-primary"
        >
          {submitting ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/imaginarium/${post.id}`)}
          className="sd-btn sd-btn-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
