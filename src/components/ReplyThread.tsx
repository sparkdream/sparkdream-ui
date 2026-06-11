"use client";

import { useState } from "react";
import type { Reply } from "@/types/blog";
import ActionMenu, { ACTION_ICONS, type ActionMenuItem } from "./ActionMenu";
import { useSessionPermits } from "@/hooks/useSessionPermits";
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
import { invalidatePost, invalidateReplies } from "@/lib/api";
import AuthorBondPanel from "./AuthorBondPanel";

// StakeTargetType numeric value for x/blog reply author bonds (replies have
// their own id sequence, separate from post bonds at 7).
const BLOG_REPLY_AUTHOR_BOND = 10;

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
  // Reply ids carrying an author bond (BLOG_REPLY_AUTHOR_BOND). The bond
  // panel is only mounted under these, so unbonded replies cost no queries.
  bondedReplyIds?: Set<string>;
  onReplySubmitted?: () => void;
}

function ReplyItem({
  reply,
  postId,
  postCreator,
  postMinReplyTrustLevel,
  repliesEnabled = true,
  replyMap,
  bondedReplyIds,
  onReplySubmitted,
}: {
  reply: Reply;
  postId: string;
  postCreator?: string;
  postMinReplyTrustLevel?: number;
  repliesEnabled?: boolean;
  // parent reply id -> its (pre-sorted) children. Passed down whole so each
  // item can render its own descendants recursively at any depth.
  replyMap: Map<string, Reply[]>;
  bondedReplyIds?: Set<string>;
  onReplySubmitted?: () => void;
}) {
  const childReplies = replyMap.get(reply.id) || [];
  const { address, connected, signAndBroadcast } = useWallet();
  const permits = useSessionPermits();
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
      invalidateReplies(postId);
      invalidatePost(postId);
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
      invalidateReplies(postId);
      invalidatePost(postId);
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
      invalidateReplies(postId);
      invalidatePost(postId);
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
      invalidateReplies(postId);
      invalidatePost(postId);
      onReplySubmitted?.();
    } catch (err) {
      console.error("Make reply permanent failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const isEphemeral = Boolean(reply.expires_at && reply.expires_at !== "0");

  // Owner / moderator actions shown in the popup menu (icon + label). Reply is
  // kept top-level (next to reactions), not here. Each action is also gated on
  // the active session permitting its message type, so we don't surface a
  // button that the session key would reject at broadcast.
  const menuActions: ActionMenuItem[] = [];
  if (isOwner && !showEditForm) {
    if (permits(MsgTypeUrls.UpdateReply)) {
      menuActions.push({
        key: "edit",
        label: "Edit",
        onClick: () => setShowEditForm(true),
        icon: ACTION_ICONS.edit,
      });
    }
    if (permits(MsgTypeUrls.DeleteReply)) {
      menuActions.push({
        key: "delete",
        label: "Delete",
        onClick: handleDelete,
        icon: ACTION_ICONS.trash,
        className: "text-red-400",
      });
    }
  }
  if (isPostOwner && !isOwner && permits(isHidden ? MsgTypeUrls.UnhideReply : MsgTypeUrls.HideReply)) {
    menuActions.push({
      key: "hide",
      label: isHidden ? "Unhide" : "Hide",
      onClick: handleHideToggle,
      icon: ACTION_ICONS.eye,
    });
  }
  if (connected && isEphemeral && canMakePermanent === true && permits(MsgTypeUrls.MakeReplyPermanent)) {
    menuActions.push({
      key: "permanent",
      label: "Make Permanent",
      onClick: handleMakePermanent,
      icon: ACTION_ICONS.lock,
      className: "text-emerald-400",
    });
  }
  if (connected && !isEphemeral && canPin === true) {
    if (reply.pinned_by && permits(MsgTypeUrls.UnpinReply)) {
      menuActions.push({
        key: "unpin",
        label: "Unpin",
        onClick: () => handlePin(false),
        icon: ACTION_ICONS.pin,
      });
    } else if (!reply.pinned_by && permits(MsgTypeUrls.PinReply)) {
      menuActions.push({
        key: "pin",
        label: "Pin",
        onClick: () => handlePin(true),
        icon: ACTION_ICONS.pin,
        className: "text-amber-400",
      });
    }
  }

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
          {connected && depth < 3 && !showEditForm && repliesEnabled && permits(MsgTypeUrls.CreateReply) && (
            <button
              onClick={() => setShowReplyForm(!showReplyForm)}
              title="Reply"
              aria-label="Reply"
              className={`flex items-center rounded-lg border px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300 ${
                showReplyForm ? "border-zinc-600 bg-zinc-700" : "border-transparent bg-zinc-800"
              }`}
            >
              {ACTION_ICONS.reply}
            </button>
          )}
          <ActionMenu items={menuActions} disabled={actionLoading} />
        </div>

        {bondedReplyIds?.has(reply.id) && (
          <AuthorBondPanel
            postId={reply.id}
            targetType={BLOG_REPLY_AUTHOR_BOND}
            noun="reply"
          />
        )}

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
          replyMap={replyMap}
          bondedReplyIds={bondedReplyIds}
          onReplySubmitted={onReplySubmitted}
        />
      ))}
    </div>
  );
}

export default function ReplyThread({ replies, postId, postCreator, postMinReplyTrustLevel, repliesEnabled = true, bondedReplyIds, onReplySubmitted }: ReplyThreadProps) {
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

  // Pinned replies float to the top of their sibling group (top-level pins
  // above the thread, child pins above their siblings but still under their
  // parent). A reply is pinned when pinned_by is set; pinned_at isn't always
  // populated by the chain, so it's only a tiebreaker (most recent first).
  // Otherwise fall back to chain order.
  const byPinned = (a: Reply, b: Reply) => {
    const ap = a.pinned_by ? 1 : 0;
    const bp = b.pinned_by ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const at = a.pinned_at ? Date.parse(a.pinned_at) : 0;
    const bt = b.pinned_at ? Date.parse(b.pinned_at) : 0;
    if (at !== bt) return bt - at;
    return Number(a.id) - Number(b.id);
  };
  topLevel.sort(byPinned);
  for (const children of replyMap.values()) children.sort(byPinned);

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
          replyMap={replyMap}
          bondedReplyIds={bondedReplyIds}
          onReplySubmitted={onReplySubmitted}
        />
      ))}
    </div>
  );
}
