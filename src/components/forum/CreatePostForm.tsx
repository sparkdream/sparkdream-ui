"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { useEphemeralTtl, formatTtl } from "@/hooks/useEphemeralTtl";
import { ForumMsgTypeUrls } from "@/lib/tx";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import TagPicker from "@/components/contribute/TagPicker";

interface CreatePostFormProps {
  mode: "thread" | "reply";
  categoryId: string;
  parentId?: string;
  rootId?: string;
  onCreated: () => void;
  onCancel: () => void;
}

export default function CreatePostForm({
  mode,
  categoryId,
  parentId,
  onCreated,
  onCancel,
}: CreatePostFormProps) {
  const { address, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const { ttl: ephemeralTtl } = useEphemeralTtl("forum");
  const showEphemeralHint = isMember === false && ephemeralTtl !== null;

  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { tags: availableTags, loading: loadingTags, refresh: refreshTags } = useTagRegistry();
  const canCreateTags = useCanCreateTags(address);

  const handleSubmit = async () => {
    if (!address || !content.trim()) return;
    setSubmitting(true);
    try {
      const value: Record<string, unknown> = {
        creator: address,
        categoryId: BigInt(categoryId),
        content: content.trim(),
        parentId: mode === "reply" ? BigInt(parentId || "0") : BigInt(0),
        tags,
        contentType: 1, // CONTENT_TYPE_STANDARD
      };
      const tagMsgs =
        mode === "thread" ? buildCreateTagMsgs(address, tags, availableTags) : [];
      await signAndBroadcast([
        ...tagMsgs,
        { typeUrl: ForumMsgTypeUrls.CreatePost, value },
      ]);
      if (tagMsgs.length > 0) refreshTags();
      setContent("");
      setTags([]);
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send spark");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sd-hull-tile rounded-xl p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">
        {mode === "thread" ? "New ´spark" : "Reply"}
      </h3>
      <div className="space-y-3">
        {showEphemeralHint && ephemeralTtl !== null && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">
            Heads up: as a non-member, your {mode === "thread" ? "spark" : "reply"} is ephemeral and expires in {formatTtl(ephemeralTtl)}. Once a member replies in the thread, it becomes permanent.
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={mode === "thread" ? "What's on your mind?" : "Write a reply..."}
          rows={mode === "thread" ? 5 : 3}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        {mode === "thread" && (
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Tags</label>
            <TagPicker
              options={availableTags}
              value={tags}
              onChange={setTags}
              placeholder={canCreateTags ? "Select or create tags..." : "Select tags..."}
              loading={loadingTags}
              allowCreate={canCreateTags}
            />
            {canCreateTags && (
              <p className="mt-1 text-xs text-zinc-600">
                New tags burn a small DREAM fee per tag and are added to the shared registry.
              </p>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
            className="sd-btn-ember px-4 py-2"
          >
            {submitting ? "Sending..." : mode === "thread" ? "Send spark" : "Send reply"}
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
