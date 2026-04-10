"use client";

import { useState } from "react";
import type { Reply } from "@/types/blog";
import { ReplyStatus } from "@/types/blog";
import { truncateAddress, timeAgo } from "@/lib/utils";
import ReactionBar from "./ReactionBar";
import ReplyForm from "./ReplyForm";
import { useWallet } from "@/contexts/WalletContext";
import { MsgTypeUrls } from "@/lib/tx";

interface ReplyThreadProps {
  replies: Reply[];
  postId: string;
  postCreator?: string;
  onReplySubmitted?: () => void;
}

function ReplyItem({
  reply,
  postId,
  postCreator,
  childReplies,
  onReplySubmitted,
}: {
  reply: Reply;
  postId: string;
  postCreator?: string;
  childReplies: Reply[];
  onReplySubmitted?: () => void;
}) {
  const { address, connected, signAndBroadcast } = useWallet();
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
          value: { creator: address, id: parseInt(reply.id) },
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
          value: { creator: address, id: parseInt(reply.id) },
        },
      ]);
      onReplySubmitted?.();
    } catch (err) {
      console.error("Hide/unhide reply failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePin = async () => {
    setActionLoading(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: MsgTypeUrls.PinReply,
          value: { creator: address, id: parseInt(reply.id) },
        },
      ]);
      onReplySubmitted?.();
    } catch (err) {
      console.error("Pin reply failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className={depth > 0 ? "ml-6 border-l border-zinc-800 pl-4" : ""}>
      <div className={`py-3 ${isHidden ? "opacity-50" : ""}`}>
        <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
          <span className="font-mono">{truncateAddress(reply.creator)}</span>
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
          <ReactionBar postId={postId} replyId={reply.id} />
          {connected && depth < 3 && !showEditForm && (
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
          {connected && !reply.pinned_by && reply.expires_at && reply.expires_at !== "0" && (
            <button
              onClick={handlePin}
              disabled={actionLoading}
              className="text-xs text-amber-500 transition-colors hover:text-amber-400 disabled:opacity-50"
            >
              Pin
            </button>
          )}
        </div>

        {showReplyForm && (
          <div className="mt-3">
            <ReplyForm
              postId={postId}
              parentReplyId={reply.id}
              compact
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
          childReplies={[]}
          onReplySubmitted={onReplySubmitted}
        />
      ))}
    </div>
  );
}

export default function ReplyThread({ replies, postId, postCreator, onReplySubmitted }: ReplyThreadProps) {
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
          childReplies={replyMap.get(reply.id) || []}
          onReplySubmitted={onReplySubmitted}
        />
      ))}
    </div>
  );
}
