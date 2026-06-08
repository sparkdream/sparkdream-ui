"use client";

import { useState } from "react";
import type { Reply } from "@/types/blog";
import { ReplyStatus } from "@/types/blog";
import { timeAgo } from "@/lib/utils";
import ReactionBar from "./ReactionBar";
import NameOrAddress from "@/components/NameOrAddress";
import ReplyForm from "./ReplyForm";
import { useWallet } from "@/contexts/WalletContext";
import { useCanPin } from "@/hooks/useCanPin";
import { useCanMakePermanent } from "@/hooks/useCanMakePermanent";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { MsgTypeUrls } from "@/lib/tx";

interface ReplyThreadProps {
  replies: Reply[];
  postId: string;
  postCreator?: string;
  // The parent post's min_reply_trust_level — governs reaction eligibility
  // on this post's replies (the post author's audience choice applies to
  // both top-level and reply reactions). See ReactionBar for value semantics.
  postMinReplyTrustLevel?: number;
  // When false, existing replies still render (read-only) but the nested
  // "Reply" compose affordance is hidden — the parent post has replies
  // disabled, so the chain would reject any new reply.
  repliesEnabled?: boolean;
  onReplySubmitted?: () => void;
}

function ReplyItem({
  reply,
  postId,
  postCreator,
  postMinReplyTrustLevel,
  repliesEnabled = true,
  childReplies,
  onReplySubmitted,
}: {
  reply: Reply;
  postId: string;
  postCreator?: string;
  postMinReplyTrustLevel?: number;
  repliesEnabled?: boolean;
  childReplies: Reply[];
  onReplySubmitted?: () => void;
}) {
  const { address, connected, signAndBroadcast } = useWallet();
  const canPin = useCanPin(address);
  const canMakePermanent = useCanMakePermanent(address);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const isOwner = connected && address === reply.creator;
  const isPostOwner = connected && address === postCreator;

  if (reply.status === ReplyStatus.DELETED) {
    return (
      <div className="py-2 text-sm italic text-zinc-600">[deleted]</div>
    );
  }

  const isHidden = reply.status === ReplyStatus.HIDDEN;
  const depth = reply.depth || 0;

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this reply?")) return;
    setActionLoading(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: MsgTypeUrls.DeleteReply,
          // reply id is uint64; pass BigInt so the override's `!== BigInt(0)`
          // check stays sound under strict equality (a Number value would
          // sign "id":"0" for any zero-valued id while the chain omits).
          value: { creator: address, id: BigInt(reply.id) },
        },
      ]);
      onReplySubmitted?.();
    } catch (err) {
      console.error("Delete reply failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleHideToggle = async () => {
    setActionLoading(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: isHidden ? MsgTypeUrls.UnhideReply : MsgTypeUrls.HideReply,
          // reply id is uint64; pass BigInt so the override's `!== BigInt(0)`
          // check stays sound under strict equality (a Number value would
          // sign "id":"0" for any zero-valued id while the chain omits).
          value: { creator: address, id: BigInt(reply.id) },
        },
      ]);
      onReplySubmitted?.();
    } catch (err) {
      console.error("Hide/unhide reply failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  // Pin / Unpin are display-only "feature" markers and only apply to permanent
  // replies — the chain rejects pinning an ephemeral reply.
  const handlePin = async (pin: boolean) => {
    setActionLoading(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: pin ? MsgTypeUrls.PinReply : MsgTypeUrls.UnpinReply,
          // reply id is uint64; pass BigInt so the override's `!== BigInt(0)`
          // check stays sound under strict equality (a Number value would
          // sign "id":"0" for any zero-valued id while the chain omits).
          value: { creator: address, id: BigInt(reply.id) },
        },
      ]);
      onReplySubmitted?.();
    } catch (err) {
      console.error(pin ? "Pin reply failed:" : "Unpin reply failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  // Promote an ephemeral reply to permanent. Separate from pinning, gated on
  // the lower make_permanent_min_trust_level.
  const handleMakePermanent = async () => {
    setActionLoading(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: MsgTypeUrls.MakeReplyPermanent,
          value: { creator: address, id: BigInt(reply.id) },
        },
      ]);
      onReplySubmitted?.();
    } catch (err) {
      console.error("Make reply permanent failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const isEphemeral = Boolean(reply.expires_at && reply.expires_at !== "0");

  return (
    <div className={depth > 0 ? "ml-6 border-l border-zinc-800 pl-4" : ""}>
      <div className={`py-3 ${isHidden ? "opacity-50" : ""}`}>
        <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
          <NameOrAddress address={reply.creator} className="font-mono" />
          <span>&middot;</span>
          <span>{timeAgo(reply.created_at)}</span>
          {reply.edited && (
            <>
              <span>&middot;</span>
              <span className="italic">edited</span>
            </>
          )}
          {reply.pinned_by && (
            <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-amber-400">
              Pinned
            </span>
          )}
          {isHidden && (
            <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-red-400">
              Hidden
            </span>
          )}
          {reply.expires_at && reply.expires_at !== "0" && (
            <span className="rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-400">
              Ephemeral
            </span>
          )}
        </div>

        {showEditForm ? (
          <div className="mb-2">
            <ReplyForm
              postId={postId}
              editReplyId={reply.id}
              initialBody={reply.body}
              initialContentType={parseInt(reply.content_type) || undefined}
              variant="dream"
              compact
              onCancel={() => setShowEditForm(false)}
              onSubmitted={() => {
                setShowEditForm(false);
                onReplySubmitted?.();
              }}
            />
          </div>
        ) : (
          <p className="mb-2 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
            {reply.body}
          </p>
        )}

        <div className="flex items-center gap-3">
          <ReactionBar postId={postId} replyId={reply.id} minReplyTrustLevel={postMinReplyTrustLevel} postCreator={postCreator} />
          {connected && depth < 3 && !showEditForm && repliesEnabled && (
            <button
              onClick={() => setShowReplyForm(!showReplyForm)}
              className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            >
              Reply
            </button>
          )}
          {isOwner && !showEditForm && (
            <>
              <button
                onClick={() => setShowEditForm(true)}
                disabled={actionLoading}
                className="text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="text-xs text-red-500 transition-colors hover:text-red-400 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          )}
          {isPostOwner && !isOwner && (
            <button
              onClick={handleHideToggle}
              disabled={actionLoading}
              className="text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
            >
              {isHidden ? "Unhide" : "Hide"}
            </button>
          )}
          {connected && isEphemeral && canMakePermanent === true && (
            <button
              onClick={handleMakePermanent}
              disabled={actionLoading}
              title="Keep this ephemeral reply from expiring"
              className="text-xs text-emerald-500 transition-colors hover:text-emerald-400 disabled:opacity-50"
            >
              Make Permanent
            </button>
          )}
          {connected && !isEphemeral && !reply.pinned_by && canPin === true && (
            <button
              onClick={() => handlePin(true)}
              disabled={actionLoading}
              title="Feature this reply"
              className="text-xs text-amber-500 transition-colors hover:text-amber-400 disabled:opacity-50"
            >
              Pin
            </button>
          )}
          {connected && !isEphemeral && reply.pinned_by && canPin === true && (
            <button
              onClick={() => handlePin(false)}
              disabled={actionLoading}
              className="text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
            >
              Unpin
            </button>
          )}
        </div>

        {showReplyForm && (
          <div className="mt-3">
            <ReplyForm
              postId={postId}
              parentReplyId={reply.id}
              variant="dream"
              compact
              minReplyTrustLevel={postMinReplyTrustLevel}
              postCreator={postCreator}
              onCancel={() => setShowReplyForm(false)}
              onSubmitted={() => {
                setShowReplyForm(false);
                onReplySubmitted?.();
              }}
            />
          </div>
        )}
      </div>

      {childReplies.map((child) => (
        <ReplyItem
          key={child.id}
          reply={child}
          postId={postId}
          postCreator={postCreator}
          postMinReplyTrustLevel={postMinReplyTrustLevel}
          repliesEnabled={repliesEnabled}
          childReplies={[]}
          onReplySubmitted={onReplySubmitted}
        />
      ))}
    </div>
  );
}

export default function ReplyThread({ replies, postId, postCreator, postMinReplyTrustLevel, repliesEnabled = true, onReplySubmitted }: ReplyThreadProps) {
  const { address, connected } = useWallet();
  const isMember = useIsRepMember(address);
  // Same gate ReplyForm uses to swap in the member-only notice. When that
  // notice is showing, the "Be the first to reply!" empty-state contradicts
  // it ("can't reply" vs "be the first"), so hide it.
  const replyBlocked =
    postMinReplyTrustLevel !== -1 && connected && isMember === false;

  // Organize replies into parent-child structure
  const replyMap = new Map<string, Reply[]>();
  const topLevel: Reply[] = [];

  for (const reply of replies) {
    const parentId = reply.parent_reply_id || "0";
    if (parentId === "0") {
      topLevel.push(reply);
    } else {
      const children = replyMap.get(parentId) || [];
      children.push(reply);
      replyMap.set(parentId, children);
    }
  }

  if (replies.length === 0) {
    if (replyBlocked) return null;
    return (
      <div className="py-6 text-center text-sm text-zinc-600">
        No replies yet. Be the first to reply!
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-800/50">
      {topLevel.map((reply) => (
        <ReplyItem
          key={reply.id}
          reply={reply}
          postId={postId}
          postCreator={postCreator}
          postMinReplyTrustLevel={postMinReplyTrustLevel}
          repliesEnabled={repliesEnabled}
          childReplies={replyMap.get(reply.id) || []}
          onReplySubmitted={onReplySubmitted}
        />
      ))}
    </div>
  );
}
