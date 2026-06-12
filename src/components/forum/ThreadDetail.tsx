"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  getForumPost,
  getForumThread,
  getForumThreadMetadata,
  getThreadFollowCount,
  isFollowingThread,
  getBountyByThread,
  getBondedRole,
  listCategories,
  listPostConvictionStakesByStaker,
  authorBondsByType,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useTrustRank } from "@/hooks/useTrustRank";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { useCommonsCouncil } from "@/hooks/useCommonsCouncil";
import { useSessionPermits } from "@/hooks/useSessionPermits";
import { ForumMsgTypeUrls } from "@/lib/tx";
import { timeAgo } from "@/lib/utils";
import NameOrAddress from "@/components/NameOrAddress";
import CreatePostForm from "@/components/forum/CreatePostForm";
import PostConvictionControl from "@/components/forum/PostConvictionControl";
import AuthorBondPanel from "@/components/AuthorBondPanel";
import type { Category } from "@/types/commons";
import type { ForumPost, ThreadMetadata, Bounty, PostConvictionStake } from "@/types/forum";
import { PostStatus, BountyStatus } from "@/types/forum";
import { RoleType, BondedRoleStatus } from "@/types/rep";

// Promoting an ephemeral post to permanent is a member action gated on
// make_permanent_min_trust_level (default PROVISIONAL). Pinning a thread,
// unlike blog/collect, is NOT trust-gated: forum MsgPinPost/MsgUnpinPost are
// restricted to the commons "operations" committee and apply only to root
// posts (it's a moderation/featuring action), so it's gated on ops-committee
// membership below rather than trust rank.
const MAKE_PERMANENT_RANK = 1;

// StakeTargetType numeric value for x/forum author bonds. Forum replies are
// posts with parent_id set, so posts and replies share this target type.
const FORUM_AUTHOR_BOND = 8;

// sparkdream.common.v1.ModerationReason values for MsgHidePost.reason_code
// (the msg field is a uint64, the LCD echoes the enum name on HideRecord).
// UNSPECIFIED (0) is excluded: a hide must state its reason, and OTHER must
// say it in reason_text.
const HIDE_REASONS = [
  { code: 1, label: "Spam" },
  { code: 2, label: "Harassment" },
  { code: 3, label: "Misinformation" },
  { code: 4, label: "Off-topic" },
  { code: 5, label: "Low quality" },
  { code: 6, label: "Inappropriate" },
  { code: 7, label: "Impersonation" },
  { code: 8, label: "Policy violation" },
  { code: 9, label: "Duplicate" },
  { code: 10, label: "Scam" },
  { code: 11, label: "Copyright" },
  { code: 12, label: "Other" },
] as const;
const REASON_OTHER = 12;

function formatAmount(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

interface ThreadDetailProps {
  threadId: string;
  onBack: () => void;
}

export default function ThreadDetail({ threadId, onBack }: ThreadDetailProps) {
  const { address, signAndBroadcast } = useWallet();
  const rank = useTrustRank(address);
  const isMember = useIsRepMember(address);
  const { isOpsCommitteeMember } = useCommonsCouncil(address);
  const permits = useSessionPermits();
  const canMakePermanent = rank !== null && rank >= MAKE_PERMANENT_RANK;

  const [rootPost, setRootPost] = useState<ForumPost | null>(null);
  const [replies, setReplies] = useState<ForumPost[]>([]);
  const [metadata, setMetadata] = useState<ThreadMetadata | null>(null);
  const [followCount, setFollowCount] = useState<string>("0");
  const [isFollowing, setIsFollowing] = useState(false);
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [myStakes, setMyStakes] = useState<PostConvictionStake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyToId, setReplyToId] = useState<string>(threadId);
  const [category, setCategory] = useState<Category | null>(null);
  // Post ids in this thread carrying an author bond. Fetched as one indexed
  // query so we only mount the (self-querying) bond panel under posts that
  // actually have one, instead of two LCD calls per reply.
  const [bondedIds, setBondedIds] = useState<Set<string>>(new Set());
  // Viewer's sentinel bond status (null when not a sentinel). Fetched once
  // per address rather than per post, so moderation gating costs one LCD call.
  const [sentinelStatus, setSentinelStatus] = useState<string | null>(null);
  const [hideFormId, setHideFormId] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState(0);
  const [hideReasonText, setHideReasonText] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [postRes, threadRes] = await Promise.all([
        getForumPost(threadId),
        getForumThread(threadId, { limit: "100" }),
      ]);

      setRootPost(postRes.post);
      // Replies are all posts in the thread except the root
      const allPosts = threadRes.posts || [];
      setReplies(allPosts.filter((p) => p.post_id !== threadId));

      // Fetch metadata, follow count, bounty in parallel (non-critical)
      const metaP = getForumThreadMetadata(threadId).catch(() => null);
      const followP = getThreadFollowCount(threadId).catch(() => null);
      const bountyP = getBountyByThread(threadId).catch(() => null);
      const bondsP = (async () => {
        const ids = new Set<string>();
        let key: string | undefined;
        do {
          const res = await authorBondsByType(FORUM_AUTHOR_BOND, {
            limit: "200",
            ...(key ? { key } : {}),
          });
          for (const b of res.bonds || []) ids.add(b.target_id);
          key = res.pagination?.next_key || undefined;
        } while (key);
        return ids;
      })().catch(() => new Set<string>());

      const [metaRes, followRes, bountyRes, bondIds] = await Promise.all([metaP, followP, bountyP, bondsP]);

      if (metaRes) setMetadata(metaRes.thread_metadata);
      if (followRes) setFollowCount(followRes.thread_follow_count?.follower_count || "0");
      if (bountyRes) setBounty(bountyRes.bounty);
      setBondedIds(bondIds);

      // Check if current user follows this thread
      if (address) {
        isFollowingThread(threadId, address)
          .then((r) => setIsFollowing(r.is_following))
          .catch(() => setIsFollowing(false));

        // The viewer's own open conviction stakes, fetched once and passed down
        // to each post's control (filtered per-post below). Released stakes are
        // dropped so only releasable/locked positions surface.
        listPostConvictionStakesByStaker(address, { limit: "200" })
          .then((r) => setMyStakes((r.stakes || []).filter((s) => !s.released)))
          .catch(() => setMyStakes([]));
      } else {
        setMyStakes([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load spark");
    } finally {
      setLoading(false);
    }
  }, [threadId, address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!address) {
      setSentinelStatus(null);
      return;
    }
    let cancelled = false;
    getBondedRole(RoleType.FORUM_SENTINEL, address)
      .then((res) => {
        if (!cancelled) setSentinelStatus(res?.bonded_role?.bond_status ?? null);
      })
      .catch(() => {
        if (!cancelled) setSentinelStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Mirrors x/forum MsgHidePost authorization: a bonded sentinel in NORMAL or
  // RECOVERY (DEMOTED/UNBONDING are refused), or the commons operations
  // committee via the governance route. Also gated on the active session key
  // permitting the message type, matching the rest of the action buttons.
  // Epoch hide limits and cooldowns are still enforced chain-side and surface
  // as broadcast errors.
  const canHide =
    permits(ForumMsgTypeUrls.HidePost) &&
    (isOpsCommitteeMember ||
      sentinelStatus === BondedRoleStatus.NORMAL ||
      sentinelStatus === BondedRoleStatus.RECOVERY);

  // The thread's category decides who may post: members_only_write blocks
  // non-members, admin_only_write blocks everyone but the ops committee. We
  // list categories (there are few) and match by id so the reply affordance
  // reflects the chain's CreatePost gate instead of offering a form the chain
  // would reject.
  const categoryId = rootPost?.category_id;
  useEffect(() => {
    if (!categoryId) {
      setCategory(null);
      return;
    }
    let cancelled = false;
    listCategories({ limit: "200" })
      .then((res) => {
        if (cancelled) return;
        setCategory((res.category || []).find((c) => c.category_id === categoryId) || null);
      })
      .catch(() => {
        if (!cancelled) setCategory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  // Mirrors x/forum CreatePost: the ops committee and the thread author may
  // always reply (the author exception matches the chain's creator self-reply
  // rule); otherwise admin-only locks out everyone and members-only locks out
  // confirmed non-members. `isMember !== false` keeps the form available while
  // membership is still resolving rather than flashing the notice.
  const adminOnlyWrite = category?.admin_only_write ?? false;
  const membersOnlyWrite = category?.members_only_write ?? false;
  const isThreadAuthor = !!address && address === rootPost?.author;
  const canReply =
    isOpsCommitteeMember ||
    isThreadAuthor ||
    (!adminOnlyWrite && (!membersOnlyWrite || isMember !== false));

  // Group the viewer's open stakes by the post they back, so each control gets
  // only its post's stakes without each one re-querying the chain.
  const stakesByPost = useMemo(() => {
    const map = new Map<string, PostConvictionStake[]>();
    for (const s of myStakes) {
      const list = map.get(s.post_id);
      if (list) list.push(s);
      else map.set(s.post_id, [s]);
    }
    return map;
  }, [myStakes]);

  const handleVote = async (postId: string, direction: "up" | "down") => {
    if (!address) return;
    setActionLoading(`vote-${postId}`);
    try {
      const typeUrl = direction === "up"
        ? ForumMsgTypeUrls.UpvotePost
        : ForumMsgTypeUrls.DownvotePost;
      await signAndBroadcast([{
        typeUrl,
        value: { creator: address, postId: BigInt(postId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Vote failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleFollow = async () => {
    if (!address) return;
    setActionLoading("follow");
    try {
      const typeUrl = isFollowing
        ? ForumMsgTypeUrls.UnfollowThread
        : ForumMsgTypeUrls.FollowThread;
      await signAndBroadcast([{
        typeUrl,
        value: { creator: address, threadId: BigInt(threadId) },
      }]);
      setIsFollowing(!isFollowing);
      const res = await getThreadFollowCount(threadId).catch(() => null);
      if (res) setFollowCount(res.thread_follow_count?.follower_count || "0");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Follow action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (postId: string) => {
    if (!address || !confirm("Delete this spark? This cannot be undone.")) return;
    setActionLoading(`delete-${postId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.DeletePost,
        value: { creator: address, postId: BigInt(postId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Sentinel moderation: hide a spark with a stated reason. The chain reserves
  // a slash amount from the sentinel's available bond per hide, releasable by
  // self-correcting via Unhide (in the Sentinel panel) inside the
  // sentinel_unhide_window.
  const handleHide = async (postId: string) => {
    if (!address || !hideReason) return;
    setActionLoading(`hide-${postId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.HidePost,
        // post_id/reason_code are uint64; pass BigInt so the amino override's
        // omit-zero strict-equality check matches the chain's aminojson.
        value: {
          creator: address,
          postId: BigInt(postId),
          reasonCode: BigInt(hideReason),
          reasonText: hideReasonText.trim(),
        },
      }]);
      setHideFormId(null);
      setHideReason(0);
      setHideReasonText("");
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Hide failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Pin/Unpin are display-only "feature" markers requiring a permanent target;
  // the chain rejects pinning an ephemeral post (ErrCannotPinEphemeral).
  const handlePin = async (postId: string, pin: boolean) => {
    if (!address) return;
    setActionLoading(`pin-${postId}`);
    try {
      await signAndBroadcast([{
        typeUrl: pin ? ForumMsgTypeUrls.PinPost : ForumMsgTypeUrls.UnpinPost,
        // MsgPinPost carries a pin_priority (higher sorts first); 0 keeps the
        // chain's default ordering. MsgUnpinPost takes no priority.
        value: pin
          ? { creator: address, postId: BigInt(postId), priority: BigInt(0) }
          : { creator: address, postId: BigInt(postId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : pin ? "Pin failed" : "Unpin failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Promote an ephemeral post to permanent — separate lifecycle action from
  // pinning, on the lower make_permanent_min_trust_level gate.
  const handleMakePermanent = async (postId: string) => {
    if (!address) return;
    setActionLoading(`permanent-${postId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.MakePostPermanent,
        value: { creator: address, postId: BigInt(postId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Make permanent failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReplyCreated = () => {
    setShowReplyForm(false);
    setReplyToId(threadId);
    fetchData();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="h-40 animate-pulse sd-hull-tile rounded-xl" />
        <div className="h-24 animate-pulse sd-hull-tile rounded-xl" />
      </div>
    );
  }

  if (error || !rootPost) {
    return (
      <div>
        <button onClick={onBack} className="mb-4 text-sm text-zinc-400 hover:text-zinc-200">
          &larr; Back
        </button>
        <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error || "Spark not found"}
          <button onClick={fetchData} className="ml-2 underline hover:text-red-300">Retry</button>
        </div>
      </div>
    );
  }

  const renderPost = (post: ForumPost, isRoot: boolean) => {
    const votes = parseInt(post.upvote_count || "0", 10) - parseInt(post.downvote_count || "0", 10);
    const isAuthor = post.author === address;
    const depth = parseInt(post.depth || "0", 10);
    const indent = isRoot ? 0 : Math.min(depth - 1, 3);
    const isAcceptedReply = metadata?.accepted_reply_id === post.post_id;
    const isEphemeral = Boolean(post.expiration_time && post.expiration_time !== "0");
    const isActive = post.status === PostStatus.ACTIVE;

    return (
      <div
        key={post.post_id}
        className={`sd-hull-tile rounded-xl p-4 ${
          isAcceptedReply ? "!border-emerald-700/50" : ""
        }`}
        style={{ marginLeft: `${indent * 24}px` }}
      >
        {isAcceptedReply && (
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-emerald-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Accepted Answer
          </div>
        )}

        {/* Post header */}
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <NameOrAddress address={post.author} />
          {post.created_at && <span>{timeAgo(post.created_at)}</span>}
          {post.edited && <span className="italic">edited</span>}
          {post.pinned && <span className="text-amber-400">Pinned</span>}
          {isEphemeral && <span className="text-yellow-500">Ephemeral</span>}
          {post.status !== PostStatus.ACTIVE && (
            <span className="text-red-400">{post.status.replace("POST_STATUS_", "")}</span>
          )}
        </div>

        {/* Post content */}
        <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">
          {post.content}
        </div>

        {/* Tags */}
        {post.tags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">{tag}</span>
            ))}
          </div>
        )}

        {/* Post actions */}
        <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
          <button
            onClick={() => handleVote(post.post_id, "up")}
            disabled={actionLoading === `vote-${post.post_id}`}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-emerald-700 hover:text-emerald-400 disabled:opacity-50"
          >
            +{post.upvote_count || 0}
          </button>
          <button
            onClick={() => handleVote(post.post_id, "down")}
            disabled={actionLoading === `vote-${post.post_id}`}
            className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-red-700 hover:text-red-400 disabled:opacity-50"
          >
            -{post.downvote_count || 0}
          </button>
          <span className={`text-xs font-medium ${votes >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {votes >= 0 ? "+" : ""}{votes}
          </span>
          <div className="flex-1" />
          {!isRoot && !rootPost.locked && canReply && (
            <button
              onClick={() => { setReplyToId(post.post_id); setShowReplyForm(true); }}
              className="text-xs text-zinc-400 transition-colors hover:text-indigo-400"
            >
              Reply
            </button>
          )}
          {/* Back the author with a DREAM conviction stake (ESTABLISHED+, not
              the author). The component self-hides when ineligible. */}
          {isActive && (
            <PostConvictionControl
              postId={post.post_id}
              author={post.author}
              stakes={stakesByPost.get(post.post_id) ?? []}
              onChanged={fetchData}
            />
          )}
          {/* Promote an ephemeral post to permanent. */}
          {isActive && isEphemeral && (
            <button
              onClick={() => handleMakePermanent(post.post_id)}
              disabled={actionLoading === `permanent-${post.post_id}` || !canMakePermanent}
              title={canMakePermanent ? "Keep this ephemeral spark from expiring" : "Requires Provisional trust level or higher"}
              className="text-xs text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-50"
            >
              {actionLoading === `permanent-${post.post_id}` ? "..." : "Make Permanent"}
            </button>
          )}
          {/* Feature (pin) a permanent thread, or remove the marker. Forum
              pinning is an ops-committee moderation action limited to root
              posts, so only surface it to authorized members on the root. */}
          {isRoot && isOpsCommitteeMember && isActive && !isEphemeral && !post.pinned && (
            <button
              onClick={() => handlePin(post.post_id, true)}
              disabled={actionLoading === `pin-${post.post_id}`}
              title="Feature this thread (operations committee)"
              className="text-xs text-amber-400 transition-colors hover:text-amber-300 disabled:opacity-50"
            >
              {actionLoading === `pin-${post.post_id}` ? "..." : "Pin"}
            </button>
          )}
          {isRoot && isOpsCommitteeMember && isActive && !isEphemeral && post.pinned && (
            <button
              onClick={() => handlePin(post.post_id, false)}
              disabled={actionLoading === `pin-${post.post_id}`}
              title="Remove the feature marker (operations committee)"
              className="text-xs text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-50"
            >
              {actionLoading === `pin-${post.post_id}` ? "..." : "Unpin"}
            </button>
          )}
          {/* Sentinel moderation. Authors already have Delete, so don't offer
              hiding one's own spark. */}
          {canHide && isActive && !isAuthor && (
            <button
              onClick={() => {
                setHideFormId(hideFormId === post.post_id ? null : post.post_id);
                setHideReason(0);
                setHideReasonText("");
              }}
              title="Hide this spark (sentinel moderation)"
              className="text-xs text-red-400 transition-colors hover:text-red-300"
            >
              Hide
            </button>
          )}
          {isAuthor && (
            <button
              onClick={() => handleDelete(post.post_id)}
              disabled={actionLoading === `delete-${post.post_id}`}
              className="text-xs text-red-400 transition-colors hover:text-red-300 disabled:opacity-50"
            >
              {actionLoading === `delete-${post.post_id}` ? "..." : "Delete"}
            </button>
          )}
        </div>

        {/* Hide reason form. A reason is required, and "Other" must be
            explained in the free-text field. */}
        {hideFormId === post.post_id && (
          <div className="mt-3 space-y-2 rounded-lg border border-red-900/50 bg-red-950/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={hideReason}
                onChange={(e) => setHideReason(parseInt(e.target.value, 10))}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
              >
                <option value={0}>Select a reason...</option>
                {HIDE_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={hideReasonText}
                onChange={(e) => setHideReasonText(e.target.value)}
                placeholder={hideReason === REASON_OTHER ? "Reason (required)" : "Details (optional)"}
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                onClick={() => handleHide(post.post_id)}
                disabled={
                  !hideReason ||
                  (hideReason === REASON_OTHER && !hideReasonText.trim()) ||
                  actionLoading === `hide-${post.post_id}`
                }
                className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-700 disabled:opacity-50"
              >
                {actionLoading === `hide-${post.post_id}` ? "Hiding..." : "Hide spark"}
              </button>
              <button
                onClick={() => setHideFormId(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-zinc-500">
              Hiding commits part of your sentinel bond. You can self-correct from the Sentinel panel while the unhide window is open.
            </p>
          </div>
        )}

        {/* Always mounted on the root (it self-hides when unbonded, matching
            the blog detail view); replies only when the bond index says one
            exists, to avoid per-reply queries. */}
        {(isRoot || bondedIds.has(post.post_id)) && (
          <AuthorBondPanel
            postId={post.post_id}
            targetType={FORUM_AUTHOR_BOND}
            noun={isRoot ? "spark" : "reply"}
          />
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Back button */}
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {/* Thread header with follow / bounty info */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={handleFollow}
            disabled={actionLoading === "follow"}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
              isFollowing
                ? "border-indigo-600 bg-indigo-600/15 text-indigo-400 hover:bg-indigo-600/25"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            }`}
          >
            {actionLoading === "follow" ? "..." : isFollowing ? "Following" : "Follow"}
          </button>
          <span className="text-xs text-zinc-500">{followCount} follower{followCount !== "1" ? "s" : ""}</span>
        </div>
        {bounty && bounty.status === BountyStatus.ACTIVE && (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-700/50 bg-amber-900/15 px-3 py-1.5">
            <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-medium text-amber-400">
              Bounty: {formatAmount(bounty.amount)} DREAM
            </span>
          </div>
        )}
        {rootPost.locked && (
          <span className="rounded-lg border border-red-800/50 bg-red-900/15 px-3 py-1.5 text-xs text-red-400">
            Locked{rootPost.lock_reason ? `: ${rootPost.lock_reason}` : ""}
          </span>
        )}
      </div>

      {/* Root post */}
      {renderPost(rootPost, true)}

      {/* Reply button for root */}
      {!rootPost.locked && (
        <div className="mt-3">
          {canReply ? (
            !showReplyForm ? (
              <button
                onClick={() => { setReplyToId(threadId); setShowReplyForm(true); }}
                className="sd-btn-ember px-4 py-2"
              >
                Reply
              </button>
            ) : (
              <CreatePostForm
                mode="reply"
                parentId={replyToId}
                categoryId={rootPost.category_id}
                rootId={threadId}
                onCreated={handleReplyCreated}
                onCancel={() => setShowReplyForm(false)}
              />
            )
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-sm text-zinc-500">
              {adminOnlyWrite ? (
                "This channel is restricted. Only administrators can post here."
              ) : (
                <>
                  Replies in this channel are open to members. Ask any existing{" "}
                  <Link href="/contribute?view=members" className="text-indigo-400 underline hover:text-indigo-300">
                    member
                  </Link>
                  {" "}to invite you in.
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Replies */}
      {replies.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-zinc-300">
            {replies.length} Repl{replies.length === 1 ? "y" : "ies"}
          </h3>
          <div className="space-y-2">
            {replies.map((reply) => renderPost(reply, false))}
          </div>
        </div>
      )}
    </div>
  );
}
