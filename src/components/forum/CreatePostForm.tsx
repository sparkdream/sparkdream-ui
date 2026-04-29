"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { ForumMsgTypeUrls } from "@/lib/tx";
import { listTags } from "@/lib/api";
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
  rootId,
  onCreated,
  onCancel,
}: CreatePostFormProps) {
  const { address, signAndBroadcast } = useWallet();

  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== "thread") return;
    setLoadingTags(true);
    listTags({ limit: "200" })
      .then((res) => {
        setAvailableTags((res.tag || []).map((t) => t.name));
      })
      .catch(() => setAvailableTags([]))
      .finally(() => setLoadingTags(false));
  }, [mode]);

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
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.CreatePost,
        value,
      }]);
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
              placeholder="Select tags..."
              loading={loadingTags}
            />
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
