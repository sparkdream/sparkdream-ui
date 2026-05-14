"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { MsgTypeUrls } from "@/lib/tx";
import { ContentType, CONTENT_TYPE_INFO } from "@/types/blog";
import NumberInput from "@/components/NumberInput";

interface ReplyFormProps {
  postId: string;
  parentReplyId?: string;
  initialBody?: string;
  initialContentType?: number;
  editReplyId?: string;
  onSubmitted?: () => void;
  onCancel?: () => void;
  compact?: boolean;
  /** Entity palette for the submit button. Defaults to indigo. */
  variant?: "spark" | "dream" | "collection";
}

export default function ReplyForm({
  postId,
  parentReplyId = "0",
  initialBody = "",
  initialContentType,
  editReplyId,
  onSubmitted,
  onCancel,
  compact = false,
  variant,
}: ReplyFormProps) {
  const { address, connected, signAndBroadcast } = useWallet();
  const [body, setBody] = useState(initialBody);
  const [contentType, setContentType] = useState<number>(initialContentType ?? ContentType.TEXT);
  const [authorBond, setAuthorBond] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!editReplyId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !body.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      if (isEditing) {
        await signAndBroadcast([
          {
            typeUrl: MsgTypeUrls.UpdateReply,
            value: {
              creator: address,
              // Reply IDs are uint64; sparkdreamjs's amino override checks
              // `message.id !== BigInt(0)` and JS strict-inequality between
              // Number and BigInt is always true, so a 0-valued Number would
              // sign "id":"0" while the chain omits — wrap as BigInt so the
              // override's intended zero-omit branch fires correctly.
              id: BigInt(editReplyId),
              body: body.trim(),
              contentType,
            },
          },
        ]);
      } else {
        const value: Record<string, unknown> = {
          creator: address,
          // post_id / parent_reply_id are uint64. parentReplyId defaults to
          // "0" for top-level replies, so passing Number(0) signed
          // `"parent_reply_id":"0"` while aminojson on the chain omits the
          // uint64 zero — that broke every top-level reply submission with
          // "unauthorized" sigverify. Wrap both in BigInt so the override's
          // `!== BigInt(0)` check matches Number-vs-BigInt correctly.
          postId: BigInt(postId),
          parentReplyId: BigInt(parentReplyId),
          body: body.trim(),
          contentType,
        };
        if (authorBond && parseInt(authorBond) > 0) {
          value.authorBond = authorBond;
        }
        await signAndBroadcast([
          { typeUrl: MsgTypeUrls.CreateReply, value },
        ]);
      }
      setBody("");
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : isEditing ? "Failed to update reply" : "Failed to submit reply");
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500">
        Connect your wallet to reply
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={isEditing ? "Edit your reply..." : "Write a reply..."}
        rows={compact ? 2 : 3}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      {(showOptions || isEditing) && (
        <div className="flex items-center gap-3">
          <select
            value={contentType}
            onChange={(e) => setContentType(Number(e.target.value))}
            className="sd-select"
          >
            {Object.entries(CONTENT_TYPE_INFO).map(([val, info]) => (
              <option key={val} value={val}>
                {info.label}
              </option>
            ))}
          </select>
          {!isEditing && (
            <NumberInput
              min="0"
              value={authorBond}
              onChange={(e) => setAuthorBond(e.target.value)}
              placeholder="Author bond (DREAM)"
              className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2 justify-between">
        {!showOptions && !isEditing && (
          <button
            type="button"
            onClick={() => setShowOptions(true)}
            className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Options
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="sd-btn sd-btn-secondary"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className={
              variant === "spark"
                ? "sd-btn-ember px-4 py-1.5"
                : variant === "dream"
                  ? "sd-btn-gold px-4 py-1.5"
                  : variant === "collection"
                    ? "sd-btn-crystal px-4 py-1.5"
                    : "sd-btn sd-btn-primary"
            }
          >
            {submitting ? (isEditing ? "Saving..." : "Posting...") : (isEditing ? "Save" : "Reply")}
          </button>
        </div>
      </div>
    </form>
  );
}
