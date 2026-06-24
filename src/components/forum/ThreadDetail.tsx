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
  getForumBounty,
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
import { ForumMsgTypeUrls, ModerationAuthority } from "@/lib/tx";
import { timeAgo, formatSpark } from "@/lib/utils";
import NameOrAddress from "@/components/NameOrAddress";
import CreatePostForm from "@/components/forum/CreatePostForm";
import PostConvictionControl from "@/components/forum/PostConvictionControl";
import BountyPanel, { MAX_BOUNTY_WINNERS, provisionalShares } from "@/components/forum/BountyPanel";
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
  // Thread lock / move moderator forms (root only).
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [lockFormOpen, setLockFormOpen] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [lockAsCouncil, setLockAsCouncil] = useState(false);
  const [moveFormOpen, setMoveFormOpen] = useState(false);
  const [moveCategoryId, setMoveCategoryId] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveAsCouncil, setMoveAsCouncil] = useState(false);
  // When the account is both sentinel and committee, this opt-in switches the
  // hide from the default sentinel path to an explicit council hide.
  const [hideAsCouncil, setHideAsCouncil] = useState(false);
  const [bountyAssignId, setBountyAssignId] = useState<string | null>(null);
  const [bountyReason, setBountyReason] = useState("");
  // Thread author's pin-dispute form, keyed by the pinned reply's post id.
  const [disputeFormId, setDisputeFormId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  // Thread author's reject-proposal form (open when set to the proposed reply's
  // post id). A reason is recorded with the rejection.
  const [rejectFormOpen, setRejectFormOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

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
      // bounty_by_thread returns a flat {bounty_id, amount, ...} summary
      // (zero values when the thread has no bounty — amount is the existence
      // signal since bounty ids start at 0), so chain into the full Bounty
      // fetch for creator/status/awards.
      const bountyP = getBountyByThread(threadId)
        .then((r) => (r.amount ? getForumBounty(r.bounty_id) : null))
        .catch(() => null);
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
      setBounty(bountyRes?.bounty ?? null);
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
  const isEligibleSentinel =
    sentinelStatus === BondedRoleStatus.NORMAL ||
    sentinelStatus === BondedRoleStatus.RECOVERY;
  const canHide =
    permits(ForumMsgTypeUrls.HidePost) &&
    (isOpsCommitteeMember || isEligibleSentinel);
  // An account that is both an eligible sentinel and a committee member must
  // choose which authority it acts under. Gov-hiding is opt-in and visible:
  // the default is the accountable (bonded, appealable) sentinel path.
  const hideAuthorityIsAmbiguous = isEligibleSentinel && isOpsCommitteeMember;
  // Lock and move carry the same sentinel-vs-council authority field as hide
  // (chain commit ca0508c). The disambiguation trigger is identical: only an
  // account holding both roles has a choice to make. The chain's per-action
  // eligibility (lock bond/rep floor, reserved-tag block on move) is still
  // enforced server-side and surfaces as a broadcast error.
  const moderationAuthorityIsAmbiguous = hideAuthorityIsAmbiguous;
  // Who may read a hidden post's content. Viewing isn't a tx, so this does not
  // require the session-key permit (canHide does). Moderators see it to review;
  // the author sees their own post to appeal it. Everyone else gets a
  // placeholder so hidden content stays out of public view even by direct link.
  const canModerate = isOpsCommitteeMember || isEligibleSentinel;
  // Thread lock / move / unlock authority mirrors the chain: the ops committee
  // or an eligible sentinel. Finer chain rules (lock rep-tier + 2x bond, move
  // reason + reserved-tag block, per-epoch limits and cooldowns) are enforced
  // chain-side and surface as broadcast errors. Unlock is additionally gated to
  // the sentinel who placed the lock (the ops committee can always unlock).
  const canLockThread =
    permits(ForumMsgTypeUrls.LockThread) && (isOpsCommitteeMember || isEligibleSentinel);
  const canMoveThread =
    permits(ForumMsgTypeUrls.MoveThread) && (isOpsCommitteeMember || isEligibleSentinel);
  const canUnlockThread =
    permits(ForumMsgTypeUrls.UnlockThread) && (isOpsCommitteeMember || isEligibleSentinel);

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
        const cats = res.category || [];
        setAllCategories(cats);
        setCategory(cats.find((c) => c.category_id === categoryId) || null);
      })
      .catch(() => {
        if (!cancelled) {
          setCategory(null);
          setAllCategories([]);
        }
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
    // Send the authority explicitly so the chain never has to guess: a council
    // member who is also a sentinel defaults to the sentinel path and only
    // gov-hides when they opt in. Sentinel-only and council-only accounts get
    // the one path they're eligible for.
    const authority = hideAuthorityIsAmbiguous
      ? hideAsCouncil
        ? ModerationAuthority.COUNCIL
        : ModerationAuthority.SENTINEL
      : isEligibleSentinel
        ? ModerationAuthority.SENTINEL
        : ModerationAuthority.COUNCIL;
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
          authority,
        },
      }]);
      setHideFormId(null);
      setHideReason(0);
      setHideReasonText("");
      setHideAsCouncil(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Hide failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Lock a thread (root only) so no new replies can be posted. Reason is
  // optional. rootId is the root post's id.
  const handleLock = async (rootId: string) => {
    if (!address) return;
    setActionLoading(`lock-${rootId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.LockThread,
        // root_id is uint64; BigInt keeps the amino override's omit-zero check sound.
        // authority disambiguates sentinel-vs-council exactly like hide (chain
        // commit ca0508c): default to the accountable sentinel path, council
        // only when the dual-role account opts in.
        value: {
          creator: address,
          rootId: BigInt(rootId),
          reason: lockReason.trim(),
          authority: moderationAuthorityIsAmbiguous
            ? lockAsCouncil
              ? ModerationAuthority.COUNCIL
              : ModerationAuthority.SENTINEL
            : isEligibleSentinel
              ? ModerationAuthority.SENTINEL
              : ModerationAuthority.COUNCIL,
        },
      }]);
      setLockFormOpen(false);
      setLockReason("");
      setLockAsCouncil(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lock failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnlock = async (rootId: string) => {
    if (!address) return;
    setActionLoading(`unlock-${rootId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.UnlockThread,
        value: { creator: address, rootId: BigInt(rootId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Move a thread to another category. The chain requires a reason and rejects
  // moving a thread that carries a reserved tag.
  const handleMove = async (rootId: string) => {
    if (!address || !moveCategoryId || !moveReason.trim()) return;
    setActionLoading(`move-${rootId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.MoveThread,
        // root_id / new_category_id are uint64; BigInt for the omit-zero check.
        value: {
          creator: address,
          rootId: BigInt(rootId),
          newCategoryId: BigInt(moveCategoryId),
          reason: moveReason.trim(),
          authority: moderationAuthorityIsAmbiguous
            ? moveAsCouncil
              ? ModerationAuthority.COUNCIL
              : ModerationAuthority.SENTINEL
            : isEligibleSentinel
              ? ModerationAuthority.SENTINEL
              : ModerationAuthority.COUNCIL,
        },
      }]);
      setMoveFormOpen(false);
      setMoveCategoryId("");
      setMoveReason("");
      setMoveAsCouncil(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Move failed");
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

  // Assign a bounty share to a reply (bounty creator only). Funds stay in
  // escrow until the creator finalizes with Pay Out in the bounty panel, at
  // which point the chain splits the escrow equally among all assigned awards.
  const handleAssignBounty = async (postId: string) => {
    if (!address) return;
    setActionLoading(`bounty-assign-${postId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.AssignBountyToReply,
        value: {
          creator: address,
          threadId: BigInt(threadId),
          replyId: BigInt(postId),
          reason: bountyReason.trim(),
        },
      }]);
      setBountyAssignId(null);
      setBountyReason("");
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bounty award failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Dispute a sentinel's reply pin (thread author only). Opens a jury appeal
  // through the moderation-appeal path: an upheld dispute releases the
  // sentinel's committed bond and keeps the pin, an overturned one slashes the
  // bond and unpins the reply. threadId is the root post id; replyId is the
  // pinned reply. The chain rejects disputing governance pins and re-disputes.
  const handleDisputePin = async (replyId: string) => {
    if (!address || !disputeReason.trim()) return;
    setActionLoading(`dispute-${replyId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.DisputePin,
        // thread_id / reply_id are uint64; BigInt keeps the amino omit-zero
        // strict-equality check aligned with the chain's aminojson.
        value: {
          creator: address,
          threadId: BigInt(threadId),
          replyId: BigInt(replyId),
          reason: disputeReason.trim(),
        },
      }]);
      setDisputeFormId(null);
      setDisputeReason("");
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Dispute failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Accepted-reply curation (chain commit c8be748, sparkdreamjs 0.0.25). One
  // message, two outcomes by who signs: the thread author accepts the reply
  // immediately; an eligible sentinel records a pending proposal that the author
  // confirms/rejects or that auto-confirms after accept_proposal_timeout.
  const handleMarkAccepted = async (replyId: string, asProposal: boolean) => {
    if (!address) return;
    setActionLoading(`accept-${replyId}`);
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.MarkAcceptedReply,
        // thread_id / reply_id are uint64; BigInt keeps the amino omit-zero
        // strict-equality check aligned with the chain's aminojson.
        value: {
          creator: address,
          threadId: BigInt(threadId),
          replyId: BigInt(replyId),
        },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : asProposal ? "Proposal failed" : "Accept failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Thread author clears the accepted reply (chain commit b991fc9). Same message
  // with reply_id 0; the author's direct choice supersedes any pending proposal.
  const handleClearAccepted = async () => {
    if (!address) return;
    setActionLoading("clear-accepted");
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.MarkAcceptedReply,
        value: {
          creator: address,
          threadId: BigInt(threadId),
          replyId: BigInt(0),
        },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Thread author opens/closes the thread to sentinel accepted-reply proposals
  // (chain commit b991fc9, sparkdreamjs 0.0.26). Locking lets the author close a
  // discussion thread (or one with no good answer) to curation without being
  // forced into an irreversible acceptance.
  const handleSetProposalsLock = async (locked: boolean) => {
    if (!address) return;
    setActionLoading("proposals-lock");
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.SetThreadProposalsLock,
        value: {
          creator: address,
          threadId: BigInt(threadId),
          locked,
        },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update curation lock");
    } finally {
      setActionLoading(null);
    }
  };

  // Thread author confirms the pending sentinel proposal, promoting the proposed
  // reply to the accepted answer and crediting the proposing sentinel.
  const handleConfirmProposed = async () => {
    if (!address) return;
    setActionLoading("confirm-proposal");
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.ConfirmProposedReply,
        value: { creator: address, threadId: BigInt(threadId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setActionLoading(null);
    }
  };

  // Thread author rejects the pending sentinel proposal. A reason is recorded.
  const handleRejectProposed = async () => {
    if (!address || !rejectReason.trim()) return;
    setActionLoading("reject-proposal");
    try {
      await signAndBroadcast([{
        typeUrl: ForumMsgTypeUrls.RejectProposedReply,
        value: { creator: address, threadId: BigInt(threadId), reason: rejectReason.trim() },
      }]);
      setRejectFormOpen(false);
      setRejectReason("");
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reject failed");
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
    // Pending sentinel accepted-reply proposal (sparkdreamjs 0.0.25). 0/empty
    // means no proposal is in flight.
    const proposedReplyId = metadata?.proposed_reply_id;
    const hasPendingProposal = !!proposedReplyId && proposedReplyId !== "0";
    const isProposedReply = hasPendingProposal && proposedReplyId === post.post_id;
    // Author has closed the thread to sentinel accepted-reply proposals
    // (chain commit b991fc9, sparkdreamjs 0.0.26).
    const proposalsLocked = !!metadata?.proposals_locked;
    const isEphemeral = Boolean(post.expiration_time && post.expiration_time !== "0");
    const isActive = post.status === PostStatus.ACTIVE;
    // Pinned-reply state (replies only; root pins use post.pinned). Drives the
    // "Pinned"/"Pin disputed" badges and the thread author's dispute affordance.
    const pinnedRecord = !isRoot
      ? metadata?.pinned_records?.find((r) => r.post_id === post.post_id)
      : undefined;
    // Only sentinel pins are disputable, only by the thread (root) author, and
    // only once — mirrors MsgDisputePin's gates on the chain.
    const canDisputePin =
      !!pinnedRecord &&
      pinnedRecord.is_sentinel_pin &&
      !pinnedRecord.disputed &&
      isActive &&
      !!address &&
      address === rootPost.author &&
      permits(ForumMsgTypeUrls.DisputePin);
    // Accepted-reply curation affordances (replies only). The thread author may
    // accept any active reply directly, change to a different one, or clear the
    // current pick — their direct choice supersedes any pending sentinel
    // proposal (chain commit b991fc9), so Accept stays offered even while a
    // proposal is in flight. It's only suppressed on the reply that is already
    // accepted (re-accepting it is a no-op error); that reply gets Clear instead.
    const canAcceptReply =
      !isRoot &&
      isActive &&
      !isAcceptedReply &&
      address === rootPost.author &&
      permits(ForumMsgTypeUrls.MarkAcceptedReply);
    const canClearAccepted =
      !isRoot &&
      isAcceptedReply &&
      address === rootPost.author &&
      permits(ForumMsgTypeUrls.MarkAcceptedReply);
    // An eligible sentinel on someone else's thread may propose a reply, unless
    // the author has closed the thread to curation (proposals_locked) — the
    // chain rejects a locked-thread proposal with ErrThreadProposalsLocked.
    const canProposeReply =
      !isRoot &&
      isActive &&
      !isAcceptedReply &&
      !hasPendingProposal &&
      !proposalsLocked &&
      !isAuthor &&
      address !== rootPost.author &&
      isEligibleSentinel &&
      permits(ForumMsgTypeUrls.MarkAcceptedReply);
    // Thread author resolves a pending proposal on this reply (confirm/reject).
    const canResolveProposal =
      isProposedReply &&
      isActive &&
      address === rootPost.author &&
      permits(ForumMsgTypeUrls.ConfirmProposedReply);
    // Conceal hidden content from non-author, non-moderator viewers (e.g. a
    // direct link to a hidden spark). The header still shows the "Hidden" badge.
    const concealContent =
      post.status === PostStatus.HIDDEN && !isAuthor && !canModerate;
    // Bounty creator's per-reply award affordance. Mirrors the chain's
    // AssignBountyToReply gates: active bounty, creator only, reply not yet
    // awarded, winner slots left. Awards show on the reply in any status.
    const awardIndex = bounty?.awards?.findIndex((a) => a.post_id === post.post_id) ?? -1;
    const bountyAward = awardIndex >= 0 ? bounty?.awards?.[awardIndex] : undefined;
    // Awards carry the actual paid amount only after payout; until then show the
    // provisional equal split of the current escrow (same math the chain uses).
    const bountyAwardPaid = bounty?.status === BountyStatus.AWARDED;
    const bountyAwardAmount =
      bountyAward?.amount && bountyAward.amount !== "0"
        ? bountyAward.amount
        : provisionalShares(bounty?.amount || "0", bounty?.awards?.length || 0)[awardIndex]?.toString() ?? "0";
    const canAssignBounty =
      !isRoot &&
      isActive &&
      !!bounty &&
      bounty.status === BountyStatus.ACTIVE &&
      !!address &&
      address === bounty.creator &&
      !bountyAward &&
      (bounty.awards?.length || 0) < MAX_BOUNTY_WINNERS &&
      permits(ForumMsgTypeUrls.AssignBountyToReply);

    return (
      <div
        key={post.post_id}
        className={`sd-hull-tile rounded-xl p-4 ${
          isAcceptedReply ? "border-emerald-700/50!" : ""
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
        {/* Thread author has closed this thread to sentinel answer proposals. */}
        {isRoot && proposalsLocked && (
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Curation closed
          </div>
        )}
        {/* A sentinel has proposed this reply as the accepted answer; the thread
            author can confirm or reject it, or it auto-confirms after the
            timeout. */}
        {isProposedReply && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs font-medium text-amber-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Proposed answer
            {metadata?.proposed_by && (
              <span className="font-normal text-zinc-500">
                by <NameOrAddress address={metadata.proposed_by} />
              </span>
            )}
          </div>
        )}

        {/* Post header */}
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <NameOrAddress address={post.author} />
          {post.created_at && <span>{timeAgo(post.created_at)}</span>}
          {post.edited && <span className="italic">edited</span>}
          {post.pinned && <span className="text-amber-400">Pinned</span>}
          {pinnedRecord && (
            <span className={pinnedRecord.disputed ? "text-orange-400" : "text-amber-400"}>
              {pinnedRecord.disputed ? "Pin disputed" : "Pinned"}
            </span>
          )}
          {bountyAward && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">
              {bountyAwardPaid ? "Bounty award" : "Pending award"}: {formatSpark(bountyAwardAmount)} SPARK
            </span>
          )}
          {isEphemeral && <span className="text-yellow-500">Ephemeral</span>}
          {post.status !== PostStatus.ACTIVE && (
            <span className="text-red-400">{post.status.replace("POST_STATUS_", "")}</span>
          )}
        </div>

        {/* Post content */}
        {concealContent ? (
          <div className="mt-2 text-sm italic text-zinc-500">
            This spark was hidden by moderation.
          </div>
        ) : (
          <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">
            {post.content}
          </div>
        )}

        {/* Tags */}
        {!concealContent && post.tags?.length > 0 && (
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
          {/* Thread lock / unlock / move (root only). Available to the ops
              committee and eligible sentinels; the chain enforces the finer
              bond / rep-tier / reason rules. */}
          {isRoot && isActive && !post.locked && canLockThread && (
            <button
              onClick={() => { setLockFormOpen((v) => !v); setLockReason(""); setLockAsCouncil(false); }}
              title="Lock this thread to stop new replies"
              className="text-xs text-orange-400 transition-colors hover:text-orange-300"
            >
              Lock
            </button>
          )}
          {isRoot && post.locked && canUnlockThread &&
            (isOpsCommitteeMember || post.locked_by === address) && (
            <button
              onClick={() => handleUnlock(post.post_id)}
              disabled={actionLoading === `unlock-${post.post_id}`}
              title="Unlock this thread"
              className="text-xs text-orange-400 transition-colors hover:text-orange-300 disabled:opacity-50"
            >
              {actionLoading === `unlock-${post.post_id}` ? "..." : "Unlock"}
            </button>
          )}
          {isRoot && isActive && canMoveThread && (
            <button
              onClick={() => {
                setMoveFormOpen((v) => !v);
                setMoveReason("");
                setMoveCategoryId("");
                setMoveAsCouncil(false);
              }}
              title="Move this thread to another category"
              className="text-xs text-indigo-400 transition-colors hover:text-indigo-300"
            >
              Move
            </button>
          )}
          {/* Thread author opens/closes the thread to sentinel accepted-reply
              proposals (chain commit b991fc9). Only meaningful while no reply is
              accepted; once one is, curation is moot. */}
          {isRoot && isActive && address === rootPost.author &&
            (!metadata?.accepted_reply_id || metadata.accepted_reply_id === "0") &&
            permits(ForumMsgTypeUrls.SetThreadProposalsLock) && (
            <button
              onClick={() => handleSetProposalsLock(!metadata?.proposals_locked)}
              disabled={actionLoading === "proposals-lock"}
              title={metadata?.proposals_locked
                ? "Reopen this thread to sentinel answer proposals"
                : "Close this thread to sentinel answer proposals"}
              className="text-xs text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-50"
            >
              {actionLoading === "proposals-lock"
                ? "..."
                : metadata?.proposals_locked ? "Reopen curation" : "Close curation"}
            </button>
          )}
          {/* Assign this reply a bounty share (bounty creator only). */}
          {canAssignBounty && (
            <button
              onClick={() => {
                setBountyAssignId(bountyAssignId === post.post_id ? null : post.post_id);
                setBountyReason("");
              }}
              title="Assign this reply a share of the bounty"
              className="text-xs text-amber-400 transition-colors hover:text-amber-300"
            >
              Award Bounty
            </button>
          )}
          {/* Thread author accepts a reply as the answer (immediate). */}
          {canAcceptReply && (
            <button
              onClick={() => handleMarkAccepted(post.post_id, false)}
              disabled={actionLoading === `accept-${post.post_id}`}
              title={metadata?.accepted_reply_id && metadata.accepted_reply_id !== "0"
                ? "Make this the accepted answer instead"
                : "Mark this reply as the accepted answer"}
              className="text-xs text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-50"
            >
              {actionLoading === `accept-${post.post_id}`
                ? "..."
                : metadata?.accepted_reply_id && metadata.accepted_reply_id !== "0"
                  ? "Accept instead"
                  : "Accept answer"}
            </button>
          )}
          {/* Thread author clears the accepted answer (chain commit b991fc9). */}
          {canClearAccepted && (
            <button
              onClick={handleClearAccepted}
              disabled={actionLoading === "clear-accepted"}
              title="Remove the accepted-answer mark from this reply"
              className="text-xs text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-50"
            >
              {actionLoading === "clear-accepted" ? "..." : "Clear accepted"}
            </button>
          )}
          {/* Eligible sentinel proposes a reply as the answer on another
              member's thread; the author confirms/rejects or it auto-confirms. */}
          {canProposeReply && (
            <button
              onClick={() => handleMarkAccepted(post.post_id, true)}
              disabled={actionLoading === `accept-${post.post_id}`}
              title="Propose this reply as the accepted answer (sentinel curation)"
              className="text-xs text-amber-400 transition-colors hover:text-amber-300 disabled:opacity-50"
            >
              {actionLoading === `accept-${post.post_id}` ? "..." : "Propose answer"}
            </button>
          )}
          {/* Thread author resolves a sentinel's pending proposal. */}
          {canResolveProposal && (
            <>
              <button
                onClick={handleConfirmProposed}
                disabled={actionLoading === "confirm-proposal"}
                title="Confirm this proposed answer"
                className="text-xs text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-50"
              >
                {actionLoading === "confirm-proposal" ? "..." : "Confirm answer"}
              </button>
              <button
                onClick={() => { setRejectFormOpen((v) => !v); setRejectReason(""); }}
                title="Reject this proposed answer"
                className="text-xs text-orange-400 transition-colors hover:text-orange-300"
              >
                Reject
              </button>
            </>
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
          {/* Thread author can dispute a sentinel's pin of a reply in their
              thread. Opens a jury appeal; the chain handles bond/unpin. */}
          {canDisputePin && (
            <button
              onClick={() => {
                setDisputeFormId(disputeFormId === post.post_id ? null : post.post_id);
                setDisputeReason("");
              }}
              title="Dispute this sentinel pin (thread author)"
              className="text-xs text-orange-400 transition-colors hover:text-orange-300"
            >
              Dispute pin
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

        {/* Bounty award form: optional reason, recorded on-chain with the
            award. The escrow is split equally among all assigned awards at
            payout, so only the reason is collected here. */}
        {bountyAssignId === post.post_id && canAssignBounty && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 p-3">
            <input
              type="text"
              value={bountyReason}
              onChange={(e) => setBountyReason(e.target.value)}
              placeholder="Reason (optional)"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
            <button
              onClick={() => handleAssignBounty(post.post_id)}
              disabled={actionLoading === `bounty-assign-${post.post_id}`}
              className="rounded-lg border border-amber-700/50 px-3 py-1.5 text-xs text-amber-400 transition-colors hover:border-amber-600 disabled:opacity-50"
            >
              {actionLoading === `bounty-assign-${post.post_id}` ? "Signing..." : "Assign award"}
            </button>
            <button
              onClick={() => setBountyAssignId(null)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Pin dispute form (thread author). A reason is required and is
            recorded with the appeal for the jury to review. */}
        {disputeFormId === post.post_id && canDisputePin && (
          <div className="mt-3 space-y-2 rounded-lg border border-orange-900/50 bg-orange-950/20 p-3">
            <p className="text-[11px] text-zinc-400">
              Disputing opens a jury appeal of this sentinel pin. If the jury
              sides with you the pin is removed and the sentinel&apos;s bond is
              slashed. If it is upheld, the pin stays and the sentinel&apos;s
              bond is released.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Why is this pin inappropriate? (required)"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                onClick={() => handleDisputePin(post.post_id)}
                disabled={!disputeReason.trim() || actionLoading === `dispute-${post.post_id}`}
                className="rounded-lg border border-orange-800/50 px-3 py-1.5 text-xs text-orange-400 transition-colors hover:border-orange-700 disabled:opacity-50"
              >
                {actionLoading === `dispute-${post.post_id}` ? "Submitting..." : "Submit dispute"}
              </button>
              <button
                onClick={() => { setDisputeFormId(null); setDisputeReason(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Reject-proposal form (thread author). A reason is recorded with the
            rejection for the proposing sentinel. */}
        {rejectFormOpen && canResolveProposal && (
          <div className="mt-3 space-y-2 rounded-lg border border-orange-900/50 bg-orange-950/20 p-3">
            <p className="text-[11px] text-zinc-400">
              Rejecting dismisses this sentinel&apos;s proposed answer. You can
              still accept a different reply yourself.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why reject this proposal? (required)"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                onClick={handleRejectProposed}
                disabled={!rejectReason.trim() || actionLoading === "reject-proposal"}
                className="rounded-lg border border-orange-800/50 px-3 py-1.5 text-xs text-orange-400 transition-colors hover:border-orange-700 disabled:opacity-50"
              >
                {actionLoading === "reject-proposal" ? "Submitting..." : "Submit rejection"}
              </button>
              <button
                onClick={() => { setRejectFormOpen(false); setRejectReason(""); }}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Hide reason form. A reason is required, and "Other" must be
            explained in the free-text field. */}
        {hideFormId === post.post_id && (
          <div className="mt-3 space-y-2 rounded-lg border border-red-900/50 bg-red-950/20 p-3">
            {/* Make the acting authority explicit and visible. When the account
                holds both roles, gov-hiding is an opt-in toggle (default:
                sentinel). Otherwise we label the single path the account is
                eligible for. Mirrors MsgHidePost.authority on the chain. */}
            {hideAuthorityIsAmbiguous ? (
              <div className="space-y-1.5">
                <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                  <input
                    type="radio"
                    name={`hide-authority-${post.post_id}`}
                    checked={!hideAsCouncil}
                    onChange={() => setHideAsCouncil(false)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-zinc-200">Hide as sentinel</span>
                    {" "}— commits your sentinel bond, author can appeal, self-correctable within the unhide window.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[11px] text-amber-300/80">
                  <input
                    type="radio"
                    name={`hide-authority-${post.post_id}`}
                    checked={hideAsCouncil}
                    onChange={() => setHideAsCouncil(true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-amber-300">Hide as committee</span>
                    {" "}— council hide: no bond committed, reversal only via a Commons Operations Committee proposal.
                  </span>
                </label>
              </div>
            ) : isEligibleSentinel ? (
              <p className="text-[11px] text-zinc-500">
                Acting as a bonded sentinel. This commits your sentinel bond and can
                be self-corrected within the unhide window.
              </p>
            ) : (
              <p className="text-[11px] text-amber-300/80">
                Acting as Commons Operations Committee. Recorded as a council hide:
                no sentinel bond is committed, and reversal goes through a council
                proposal rather than the sentinel self-correct window.
              </p>
            )}
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
                onClick={() => {
                  setHideFormId(null);
                  setHideAsCouncil(false);
                }}
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

        {/* Lock form (root only). Reason is optional. */}
        {isRoot && lockFormOpen && (
          <div className="mt-3 space-y-2 rounded-lg border border-orange-900/50 bg-orange-950/20 p-3">
            {/* Dual-role accounts choose the acting authority, same as hide. */}
            {moderationAuthorityIsAmbiguous && (
              <div className="space-y-1.5">
                <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                  <input
                    type="radio"
                    name={`lock-authority-${post.post_id}`}
                    checked={!lockAsCouncil}
                    onChange={() => setLockAsCouncil(false)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-zinc-200">Lock as sentinel</span>
                    {" "}— commits your sentinel bond, the author can appeal, and you can unlock within the appeal window.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[11px] text-amber-300/80">
                  <input
                    type="radio"
                    name={`lock-authority-${post.post_id}`}
                    checked={lockAsCouncil}
                    onChange={() => setLockAsCouncil(true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-amber-300">Lock as committee</span>
                    {" "}— council lock: no bond committed, reversal only via a Commons Operations Committee proposal.
                  </span>
                </label>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                placeholder="Reason (optional)"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                onClick={() => handleLock(post.post_id)}
                disabled={actionLoading === `lock-${post.post_id}`}
                className="rounded-lg border border-orange-800/50 px-3 py-1.5 text-xs text-orange-400 transition-colors hover:border-orange-700 disabled:opacity-50"
              >
                {actionLoading === `lock-${post.post_id}` ? "Locking..." : "Lock thread"}
              </button>
              <button
                onClick={() => setLockFormOpen(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-zinc-500">
              Locking stops new replies. Sentinels need the lock rep tier and a higher bond; you can unlock within the appeal window.
            </p>
          </div>
        )}

        {/* Move form (root only). Reason and a destination category required. */}
        {isRoot && moveFormOpen && (
          <div className="mt-3 space-y-2 rounded-lg border border-indigo-900/50 bg-indigo-950/20 p-3">
            {/* Dual-role accounts choose the acting authority, same as hide. */}
            {moderationAuthorityIsAmbiguous && (
              <div className="space-y-1.5">
                <label className="flex items-start gap-2 text-[11px] text-zinc-300">
                  <input
                    type="radio"
                    name={`move-authority-${post.post_id}`}
                    checked={!moveAsCouncil}
                    onChange={() => setMoveAsCouncil(false)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-zinc-200">Move as sentinel</span>
                    {" "}— commits your sentinel bond and the author can appeal.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-[11px] text-amber-300/80">
                  <input
                    type="radio"
                    name={`move-authority-${post.post_id}`}
                    checked={moveAsCouncil}
                    onChange={() => setMoveAsCouncil(true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-amber-300">Move as committee</span>
                    {" "}— council move: no bond committed, reversal only via a Commons Operations Committee proposal.
                  </span>
                </label>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={moveCategoryId}
                onChange={(e) => setMoveCategoryId(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
              >
                <option value="">Move to category...</option>
                {allCategories
                  .filter((c) => c.category_id !== post.category_id)
                  .map((c) => (
                    <option key={c.category_id} value={c.category_id}>{c.title}</option>
                  ))}
              </select>
              <input
                type="text"
                value={moveReason}
                onChange={(e) => setMoveReason(e.target.value)}
                placeholder="Reason (required)"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                onClick={() => handleMove(post.post_id)}
                disabled={
                  !moveCategoryId ||
                  !moveReason.trim() ||
                  actionLoading === `move-${post.post_id}`
                }
                className="rounded-lg border border-indigo-700/50 px-3 py-1.5 text-xs text-indigo-400 transition-colors hover:border-indigo-600 disabled:opacity-50"
              >
                {actionLoading === `move-${post.post_id}` ? "Moving..." : "Move thread"}
              </button>
              <button
                onClick={() => setMoveFormOpen(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-zinc-500">
              Threads carrying a reserved tag can&apos;t be moved by sentinels.
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
        {rootPost.locked && (
          <span className="rounded-lg border border-red-800/50 bg-red-900/15 px-3 py-1.5 text-xs text-red-400">
            Locked{rootPost.lock_reason ? `: ${rootPost.lock_reason}` : ""}
          </span>
        )}
      </div>

      {/* Bounty lifecycle: view the active bounty and its assigned awards;
          create / increase / cancel / pay out for the authorized roles. */}
      <BountyPanel
        threadId={threadId}
        bounty={bounty}
        isThreadAuthor={isThreadAuthor}
        onChanged={fetchData}
      />

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
