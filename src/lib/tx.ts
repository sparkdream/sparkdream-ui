// Transaction signing helpers using CosmJS + Keplr.

// Cosmos SDK x/gov transaction message type URLs
export const GovMsgTypeUrls = {
  Vote: "/cosmos.gov.v1beta1.MsgVote",
  Deposit: "/cosmos.gov.v1beta1.MsgDeposit",
  SubmitProposal: "/cosmos.gov.v1.MsgSubmitProposal",
} as const;

// Cosmos SDK x/upgrade message type URLs (used inside gov proposals)
export const UpgradeMsgTypeUrls = {
  SoftwareUpgrade: "/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade",
} as const;

// Commons transaction message type URLs
export const CommonsMsgTypeUrls = {
  SubmitProposal: "/sparkdream.commons.v1.MsgSubmitProposal",
  VoteProposal: "/sparkdream.commons.v1.MsgVoteProposal",
  ExecuteProposal: "/sparkdream.commons.v1.MsgExecuteProposal",
  UpdateGroupMembers: "/sparkdream.commons.v1.MsgUpdateGroupMembers",
  SpendFromCommons: "/sparkdream.commons.v1.MsgSpendFromCommons",
  RenewGroup: "/sparkdream.commons.v1.MsgRenewGroup",
  RegisterGroup: "/sparkdream.commons.v1.MsgRegisterGroup",
  UpdateGroupConfig: "/sparkdream.commons.v1.MsgUpdateGroupConfig",
} as const;

// Session transaction message type URLs
export const SessionMsgTypeUrls = {
  CreateSession: "/sparkdream.session.v1.MsgCreateSession",
  RevokeSession: "/sparkdream.session.v1.MsgRevokeSession",
  ExecSession: "/sparkdream.session.v1.MsgExecSession",
} as const;

// Blog transaction message type URLs
export const MsgTypeUrls = {
  CreatePost: "/sparkdream.blog.v1.MsgCreatePost",
  UpdatePost: "/sparkdream.blog.v1.MsgUpdatePost",
  DeletePost: "/sparkdream.blog.v1.MsgDeletePost",
  HidePost: "/sparkdream.blog.v1.MsgHidePost",
  UnhidePost: "/sparkdream.blog.v1.MsgUnhidePost",
  CreateReply: "/sparkdream.blog.v1.MsgCreateReply",
  UpdateReply: "/sparkdream.blog.v1.MsgUpdateReply",
  DeleteReply: "/sparkdream.blog.v1.MsgDeleteReply",
  HideReply: "/sparkdream.blog.v1.MsgHideReply",
  UnhideReply: "/sparkdream.blog.v1.MsgUnhideReply",
  React: "/sparkdream.blog.v1.MsgReact",
  RemoveReaction: "/sparkdream.blog.v1.MsgRemoveReaction",
  PinPost: "/sparkdream.blog.v1.MsgPinPost",
  PinReply: "/sparkdream.blog.v1.MsgPinReply",
} as const;

// Rep transaction message type URLs
export const RepMsgTypeUrls = {
  InviteMember: "/sparkdream.rep.v1.MsgInviteMember",
  AcceptInvitation: "/sparkdream.rep.v1.MsgAcceptInvitation",
  TransferDream: "/sparkdream.rep.v1.MsgTransferDream",
  ProposeProject: "/sparkdream.rep.v1.MsgProposeProject",
  ApproveProjectBudget: "/sparkdream.rep.v1.MsgApproveProjectBudget",
  CancelProject: "/sparkdream.rep.v1.MsgCancelProject",
  CreateInitiative: "/sparkdream.rep.v1.MsgCreateInitiative",
  AssignInitiative: "/sparkdream.rep.v1.MsgAssignInitiative",
  SubmitInitiativeWork: "/sparkdream.rep.v1.MsgSubmitInitiativeWork",
  ApproveInitiative: "/sparkdream.rep.v1.MsgApproveInitiative",
  AbandonInitiative: "/sparkdream.rep.v1.MsgAbandonInitiative",
  CompleteInitiative: "/sparkdream.rep.v1.MsgCompleteInitiative",
  Stake: "/sparkdream.rep.v1.MsgStake",
  Unstake: "/sparkdream.rep.v1.MsgUnstake",
  ClaimStakingRewards: "/sparkdream.rep.v1.MsgClaimStakingRewards",
  CompoundStakingRewards: "/sparkdream.rep.v1.MsgCompoundStakingRewards",
  CreateChallenge: "/sparkdream.rep.v1.MsgCreateChallenge",
  RespondToChallenge: "/sparkdream.rep.v1.MsgRespondToChallenge",
  SubmitJurorVote: "/sparkdream.rep.v1.MsgSubmitJurorVote",
} as const;

// Build a blog message for signing.
export function buildBlogMsg(typeUrl: string, value: Record<string, unknown>) {
  return { typeUrl, value };
}
