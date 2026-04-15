// Truncate a bech32 address for display: sprkdrm1abc...xyz
export function truncateAddress(address: string, prefixLen = 10, suffixLen = 4): string {
  if (address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

// Format a unix timestamp (seconds as string) to a readable date
export function formatTime(timestampStr: string): string {
  const ts = parseInt(timestampStr, 10);
  if (!ts || ts === 0) return "";
  const date = new Date(ts * 1000);
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
  const ts = parseInt(timestampStr, 10);
  if (!ts || ts === 0) return "";
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
  "/sparkdream.blog.v1.MsgUpdateParams": "Blog Param Change",
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
