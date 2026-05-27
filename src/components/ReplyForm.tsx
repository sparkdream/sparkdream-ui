"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@/contexts/WalletContext";
import { useIsReadOnly } from "@/contexts/ArchiveContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { useTrustRank } from "@/hooks/useTrustRank";
import { useEphemeralTtl, formatTtl } from "@/hooks/useEphemeralTtl";
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
  // Parent post's min_reply_trust_level — governs the new-reply audience.
  // -1 lets non-members reply; 0 (default) requires active membership.
  // Ignored when editing an existing reply (chain only enforces authorship
  // on UpdateReply, not membership).
  minReplyTrustLevel?: number;
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
  minReplyTrustLevel = 0,
}: ReplyFormProps) {
  const { address, connected, signAndBroadcast } = useWallet();
  const isReadOnly = useIsReadOnly();
  const isMember = useIsRepMember(address);
  const trustRank = useTrustRank(address);
  const ephemeralTtl = useEphemeralTtl("blog");
  const [body, setBody] = useState(initialBody);
  const [contentType, setContentType] = useState<number>(initialContentType ?? ContentType.TEXT);
  const [authorBond, setAuthorBond] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!editReplyId;
  // For new replies, mirror the chain's MsgCreateReply gate. Editing bypasses
  // this because chain UpdateReply only checks creator == reply.creator.
  const openToAll = minReplyTrustLevel === -1;
  const memberBlocked = !isEditing && !openToAll && connected && isMember === false;
  // Per commit 1124a9b: when min_reply_trust_level >= 1 a *member* must still
  // meet the trust bar. Distinct error path so we can render a different
  // remediation ("earn trust") vs. "join the conversation".
  const trustBlocked =
    !isEditing &&
    !openToAll &&
    minReplyTrustLevel >= 1 &&
    connected &&
    isMember === true &&
    trustRank !== null &&
    trustRank < minReplyTrustLevel;
  const replyBlocked = memberBlocked || trustBlocked;
  // Only show the ephemeral hint when the form is actually usable by a
  // non-member — i.e. open posts. Editing keeps the existing TTL, and on
  // member-only posts the form is replaced by the "members only" notice.
  const showEphemeralHint =
    !isEditing && openToAll && connected && isMember === false && ephemeralTtl !== null;

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
        // Defensive: only attach the bond for confirmed members. The input is
        // hidden for non-members above, but a stale state value (e.g. typed
        // while isMember was loading, then resolved to false) shouldn't sneak
        // into the broadcast and tank the whole reply tx.
        if (isMember === true && authorBond && parseInt(authorBond) > 0) {
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

  if (isReadOnly) return null;
  if (!connected) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500">
        Connect your wallet to reply
      </div>
    );
  }
  if (replyBlocked) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">
        {trustBlocked ? (
          <>
            Replies to this post require trust level {minReplyTrustLevel} or
            higher. Keep contributing to raise your trust — see{" "}
            <Link
              href="/contribute"
              className="text-indigo-400 hover:text-indigo-300 underline"
            >
              Contribute
            </Link>
            .
          </>
        ) : (
          <>
            Want to reply? Replies to this post are open to members. Ask any
            existing{" "}
            <Link
              href="/contribute?view=members"
              className="text-indigo-400 hover:text-indigo-300 underline"
            >
              member
            </Link>
            {" "}to invite you in. We&apos;d love to have you join the
            conversation.
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {showEphemeralHint && ephemeralTtl !== null && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">
          Heads up: as a non-member, your reply is ephemeral and expires in {formatTtl(ephemeralTtl)} unless you become a member or a member pins it.
        </div>
      )}
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
          {/* Author bond is a member-only affordance: x/rep's CreateAuthorBond
              calls GetMember() and rejects non-members, which would tank the
              whole reply tx. Hide the field for confirmed non-members so they
              can't type a value that's guaranteed to fail. */}
          {!isEditing && isMember !== false && (
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
