// Truncate a bech32 address for display: sprkdrm1234...5678
export function truncateAddress(address: string, prefixLen = 11, suffixLen = 4): string {
  if (address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

// Format a timestamp string to a readable date.
// Accepts both RFC 3339 / ISO 8601 strings and unix seconds.
export function formatTime(timestampStr: string): string {
  if (!timestampStr) return "";
  let date: Date;
  if (/^\d+$/.test(timestampStr)) {
    const ts = parseInt(timestampStr, 10);
    if (ts === 0) return "";
    date = new Date(ts * 1000);
  } else {
    date = new Date(timestampStr);
    if (isNaN(date.getTime()) || date.getFullYear() <= 1) return "";
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Relative time (e.g., "2 hours ago")
export function timeAgo(timestampStr: string): string {
  if (!timestampStr) return "";
  let ts: number;
  if (/^\d+$/.test(timestampStr)) {
    ts = parseInt(timestampStr, 10);
  } else {
    const date = new Date(timestampStr);
    if (isNaN(date.getTime()) || date.getFullYear() <= 1) return "";
    ts = Math.floor(date.getTime() / 1000);
  }
  if (ts === 0) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return formatTime(timestampStr);
}

// Parse a count string to number, defaulting to 0
export function countToNum(count: string | undefined): number {
  if (!count) return 0;
  return parseInt(count, 10) || 0;
}

// Time remaining until a deadline, e.g. "2d 4h" or "45m" or "expired"
export function timeRemaining(deadline: string | number): string {
  let target: number;
  if (typeof deadline === "string") {
    // Could be unix seconds string or ISO 8601
    if (/^\d+$/.test(deadline)) {
      target = parseInt(deadline, 10) * 1000;
    } else {
      target = new Date(deadline).getTime();
    }
  } else {
    target = deadline > 1e12 ? deadline : deadline * 1000;
  }

  if (!target || isNaN(target)) return "";

  const diff = target - Date.now();
  if (diff <= 0) return "expired";

  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

// Human-readable label for a message typeUrl
const MSG_TYPE_LABELS: Record<string, string> = {
  "/sparkdream.commons.v1.MsgUpdateGroupMembers": "Member Update",
  "/sparkdream.commons.v1.MsgSpendFromCommons": "Treasury Spend",
  "/sparkdream.commons.v1.MsgUpdateGroupConfig": "Config Update",
  "/sparkdream.commons.v1.MsgRenewGroup": "Council Election",
  "/sparkdream.commons.v1.MsgRegisterGroup": "Register Council",
  "/sparkdream.commons.v1.MsgSubmitProposal": "Proposal",
  "/sparkdream.commons.v1.MsgUpdateParams": "Commons Param Change",
  "/sparkdream.commons.v1.MsgCreateCategory": "Create Swarm Category",
  "/sparkdream.commons.v1.MsgDeleteCategory": "Delete Swarm Category",
  "/sparkdream.blog.v1.MsgUpdateParams": "Imaginarium Param Change",
  "/sparkdream.session.v1.MsgUpdateParams": "Session Param Change",
  "/cosmos.gov.v1.MsgUpdateParams": "Gov Param Change",
  "/cosmos.staking.v1beta1.MsgUpdateParams": "Staking Param Change",
  "/cosmos.mint.v1beta1.MsgUpdateParams": "Mint Param Change",
  "/cosmos.distribution.v1beta1.MsgUpdateParams": "Distribution Param Change",
  "/cosmos.slashing.v1beta1.MsgUpdateParams": "Slashing Param Change",
  "/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade": "Software Upgrade",
  "/cosmos.bank.v1beta1.MsgSend": "Bank Send",
  "/sparkdream.rep.v1.MsgUpdateParams": "Rep Param Change",
  "/sparkdream.rep.v1.MsgInviteMember": "Invite Member",
  "/sparkdream.rep.v1.MsgAcceptInvitation": "Accept Invitation",
  "/sparkdream.rep.v1.MsgTransferDream": "Transfer DREAM",
  "/sparkdream.rep.v1.MsgProposeProject": "Propose Project",
  "/sparkdream.rep.v1.MsgApproveProjectBudget": "Approve Project Budget",
  "/sparkdream.rep.v1.MsgCancelProject": "Cancel Project",
  "/sparkdream.rep.v1.MsgCreateInitiative": "Create Initiative",
  "/sparkdream.rep.v1.MsgAssignInitiative": "Assign Initiative",
  "/sparkdream.rep.v1.MsgSubmitInitiativeWork": "Submit Initiative Work",
  "/sparkdream.rep.v1.MsgApproveInitiative": "Approve Initiative",
  "/sparkdream.rep.v1.MsgAbandonInitiative": "Abandon Initiative",
  "/sparkdream.rep.v1.MsgCompleteInitiative": "Complete Initiative",
  "/sparkdream.rep.v1.MsgStake": "Stake DREAM",
  "/sparkdream.rep.v1.MsgUnstake": "Unstake DREAM",
  "/sparkdream.rep.v1.MsgClaimStakingRewards": "Claim Staking Rewards",
  "/sparkdream.rep.v1.MsgCompoundStakingRewards": "Compound Staking Rewards",
  "/sparkdream.rep.v1.MsgCreateChallenge": "Create Challenge",
  "/sparkdream.rep.v1.MsgRespondToChallenge": "Respond to Challenge",
  "/sparkdream.rep.v1.MsgSubmitJurorVote": "Submit Juror Vote",
  "/sparkdream.collect.v1.MsgUpdateParams": "Wonders Param Change",
  "/sparkdream.collect.v1.MsgUpdateOperationalParams": "Wonders Op Param Change",
  "/sparkdream.collect.v1.MsgCreateCollection": "Create Collection",
  "/sparkdream.collect.v1.MsgUpdateCollection": "Update Collection",
  "/sparkdream.collect.v1.MsgDeleteCollection": "Delete Collection",
  "/sparkdream.collect.v1.MsgAddItem": "Add Item",
  "/sparkdream.collect.v1.MsgAddItems": "Add Items",
  "/sparkdream.collect.v1.MsgUpdateItem": "Update Item",
  "/sparkdream.collect.v1.MsgRemoveItem": "Remove Item",
  "/sparkdream.collect.v1.MsgRemoveItems": "Remove Items",
  "/sparkdream.collect.v1.MsgReorderItem": "Reorder Item",
  "/sparkdream.collect.v1.MsgAddCollaborator": "Add Collaborator",
  "/sparkdream.collect.v1.MsgRemoveCollaborator": "Remove Collaborator",
  "/sparkdream.collect.v1.MsgUpdateCollaboratorRole": "Update Collaborator Role",
  "/sparkdream.collect.v1.MsgRateCollection": "Rate Collection",
  "/sparkdream.collect.v1.MsgChallengeReview": "Challenge Review",
  "/sparkdream.collect.v1.MsgRequestSponsorship": "Request Sponsorship",
  "/sparkdream.collect.v1.MsgCancelSponsorshipRequest": "Cancel Sponsorship",
  "/sparkdream.collect.v1.MsgSponsorCollection": "Sponsor Collection",
  "/sparkdream.collect.v1.MsgUpvoteContent": "Upvote",
  "/sparkdream.collect.v1.MsgDownvoteContent": "Downvote",
  "/sparkdream.collect.v1.MsgFlagContent": "Flag Content",
  "/sparkdream.collect.v1.MsgHideContent": "Hide Content",
  "/sparkdream.collect.v1.MsgAppealHide": "Appeal Hide",
  "/sparkdream.collect.v1.MsgEndorseCollection": "Endorse Collection",
  "/sparkdream.collect.v1.MsgSetSeekingEndorsement": "Seek Endorsement",
  "/sparkdream.collect.v1.MsgPinCollection": "Pin Collection",
  "/sparkdream.name.v1.MsgUpdateParams": "Name Param Change",
  "/sparkdream.name.v1.MsgUpdateOperationalParams": "Name Op Param Change",
  "/sparkdream.name.v1.MsgRegisterName": "Register Name",
  "/sparkdream.name.v1.MsgSetPrimary": "Set Primary Name",
  "/sparkdream.name.v1.MsgUpdateName": "Update Name",
  "/sparkdream.name.v1.MsgFileDispute": "File Name Dispute",
  "/sparkdream.name.v1.MsgContestDispute": "Contest Name Dispute",
  "/sparkdream.name.v1.MsgResolveDispute": "Resolve Name Dispute",
  "/sparkdream.forum.v1.MsgCreatePost": "Send Spark",
  "/sparkdream.forum.v1.MsgEditPost": "Edit Spark",
  "/sparkdream.forum.v1.MsgDeletePost": "Delete Spark",
  "/sparkdream.forum.v1.MsgUpvotePost": "Upvote Spark",
  "/sparkdream.forum.v1.MsgDownvotePost": "Downvote Spark",
  "/sparkdream.forum.v1.MsgFlagPost": "Flag Spark",
  "/sparkdream.forum.v1.MsgFollowThread": "Follow Thread",
  "/sparkdream.forum.v1.MsgUnfollowThread": "Unfollow Thread",
  "/sparkdream.forum.v1.MsgCreateBounty": "Create Bounty",
  "/sparkdream.forum.v1.MsgAwardBounty": "Award Bounty",
  "/sparkdream.forum.v1.MsgIncreaseBounty": "Increase Bounty",
  "/sparkdream.forum.v1.MsgCancelBounty": "Cancel Bounty",
  "/sparkdream.forum.v1.MsgHidePost": "Hide Spark",
  "/sparkdream.forum.v1.MsgAppealPost": "Appeal Spark",
  "/sparkdream.forum.v1.MsgLockThread": "Lock Thread",
  "/sparkdream.forum.v1.MsgUnlockThread": "Unlock Thread",
  "/sparkdream.forum.v1.MsgMoveThread": "Move Thread",
  "/sparkdream.forum.v1.MsgPinPost": "Pin Spark",
  "/sparkdream.forum.v1.MsgUnpinPost": "Unpin Spark",
  "/sparkdream.forum.v1.MsgPinReply": "Pin Reply",
  "/sparkdream.forum.v1.MsgUnpinReply": "Unpin Reply",
  "/sparkdream.forum.v1.MsgMarkAcceptedReply": "Accept Reply",
  "/sparkdream.forum.v1.MsgFreezeThread": "Archive Thread",
  "/sparkdream.forum.v1.MsgUnarchiveThread": "Unarchive Thread",
  "/sparkdream.forum.v1.MsgCreateCategory": "Create Category",
  "/sparkdream.forum.v1.MsgUpdateParams": "Swarm Param Change",
  "/sparkdream.forum.v1.MsgUpdateOperationalParams": "Swarm Op Param Change",
  "/sparkdream.forum.v1.MsgCreateTagBudget": "Create Tag Budget",
  "/sparkdream.forum.v1.MsgAwardFromTagBudget": "Award From Tag Budget",
  "/sparkdream.forum.v1.MsgTopUpTagBudget": "Top Up Tag Budget",
  "/sparkdream.rep.v1.MsgBondRole": "Bond Role",
  "/sparkdream.rep.v1.MsgUnbondRole": "Unbond Role",
};

export function messageTypeLabel(typeUrl: string): string {
  if (MSG_TYPE_LABELS[typeUrl]) return MSG_TYPE_LABELS[typeUrl];
  // Fallback: extract the last segment and remove "Msg" prefix
  const parts = typeUrl.split(".");
  return parts[parts.length - 1].replace("Msg", "");
}

export function describeProposalMessages(
  msgs: { type_url?: string; "@type"?: string }[]
): string {
  if (!msgs?.length) return "General Vote";
  return msgs.map((m) => messageTypeLabel(m.type_url || m["@type"] || "")).join(", ");
}
