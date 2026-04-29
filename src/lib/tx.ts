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
  CreateCategory: "/sparkdream.commons.v1.MsgCreateCategory",
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
  CreateTagBudget: "/sparkdream.rep.v1.MsgCreateTagBudget",
  AwardFromTagBudget: "/sparkdream.rep.v1.MsgAwardFromTagBudget",
  TopUpTagBudget: "/sparkdream.rep.v1.MsgTopUpTagBudget",
  ToggleTagBudget: "/sparkdream.rep.v1.MsgToggleTagBudget",
  WithdrawTagBudget: "/sparkdream.rep.v1.MsgWithdrawTagBudget",
  // Generic bonded-role bond/unbond. Used by sentinels (forum), curators
  // (collect), and verifiers (federation); the role is selected with the
  // numeric RoleType value (see types/rep.ts).
  BondRole: "/sparkdream.rep.v1.MsgBondRole",
  UnbondRole: "/sparkdream.rep.v1.MsgUnbondRole",
} as const;

// Collect transaction message type URLs
export const CollectMsgTypeUrls = {
  CreateCollection: "/sparkdream.collect.v1.MsgCreateCollection",
  UpdateCollection: "/sparkdream.collect.v1.MsgUpdateCollection",
  DeleteCollection: "/sparkdream.collect.v1.MsgDeleteCollection",
  AddItem: "/sparkdream.collect.v1.MsgAddItem",
  AddItems: "/sparkdream.collect.v1.MsgAddItems",
  UpdateItem: "/sparkdream.collect.v1.MsgUpdateItem",
  RemoveItem: "/sparkdream.collect.v1.MsgRemoveItem",
  RemoveItems: "/sparkdream.collect.v1.MsgRemoveItems",
  ReorderItem: "/sparkdream.collect.v1.MsgReorderItem",
  AddCollaborator: "/sparkdream.collect.v1.MsgAddCollaborator",
  RemoveCollaborator: "/sparkdream.collect.v1.MsgRemoveCollaborator",
  UpdateCollaboratorRole: "/sparkdream.collect.v1.MsgUpdateCollaboratorRole",
  RateCollection: "/sparkdream.collect.v1.MsgRateCollection",
  ChallengeReview: "/sparkdream.collect.v1.MsgChallengeReview",
  RequestSponsorship: "/sparkdream.collect.v1.MsgRequestSponsorship",
  CancelSponsorshipRequest: "/sparkdream.collect.v1.MsgCancelSponsorshipRequest",
  SponsorCollection: "/sparkdream.collect.v1.MsgSponsorCollection",
  UpvoteContent: "/sparkdream.collect.v1.MsgUpvoteContent",
  DownvoteContent: "/sparkdream.collect.v1.MsgDownvoteContent",
  FlagContent: "/sparkdream.collect.v1.MsgFlagContent",
  HideContent: "/sparkdream.collect.v1.MsgHideContent",
  AppealHide: "/sparkdream.collect.v1.MsgAppealHide",
  EndorseCollection: "/sparkdream.collect.v1.MsgEndorseCollection",
  SetSeekingEndorsement: "/sparkdream.collect.v1.MsgSetSeekingEndorsement",
  PinCollection: "/sparkdream.collect.v1.MsgPinCollection",
} as const;

// Name transaction message type URLs
export const NameMsgTypeUrls = {
  RegisterName: "/sparkdream.name.v1.MsgRegisterName",
  SetPrimary: "/sparkdream.name.v1.MsgSetPrimary",
  UpdateName: "/sparkdream.name.v1.MsgUpdateName",
  FileDispute: "/sparkdream.name.v1.MsgFileDispute",
  ContestDispute: "/sparkdream.name.v1.MsgContestDispute",
  ResolveDispute: "/sparkdream.name.v1.MsgResolveDispute",
} as const;

// Forum transaction message type URLs
export const ForumMsgTypeUrls = {
  CreatePost: "/sparkdream.forum.v1.MsgCreatePost",
  EditPost: "/sparkdream.forum.v1.MsgEditPost",
  DeletePost: "/sparkdream.forum.v1.MsgDeletePost",
  UpvotePost: "/sparkdream.forum.v1.MsgUpvotePost",
  DownvotePost: "/sparkdream.forum.v1.MsgDownvotePost",
  FlagPost: "/sparkdream.forum.v1.MsgFlagPost",
  FollowThread: "/sparkdream.forum.v1.MsgFollowThread",
  UnfollowThread: "/sparkdream.forum.v1.MsgUnfollowThread",
  CreateBounty: "/sparkdream.forum.v1.MsgCreateBounty",
  AwardBounty: "/sparkdream.forum.v1.MsgAwardBounty",
  IncreaseBounty: "/sparkdream.forum.v1.MsgIncreaseBounty",
  CancelBounty: "/sparkdream.forum.v1.MsgCancelBounty",
  HidePost: "/sparkdream.forum.v1.MsgHidePost",
  AppealPost: "/sparkdream.forum.v1.MsgAppealPost",
  LockThread: "/sparkdream.forum.v1.MsgLockThread",
  UnlockThread: "/sparkdream.forum.v1.MsgUnlockThread",
  MoveThread: "/sparkdream.forum.v1.MsgMoveThread",
  PinPost: "/sparkdream.forum.v1.MsgPinPost",
  UnpinPost: "/sparkdream.forum.v1.MsgUnpinPost",
  PinReply: "/sparkdream.forum.v1.MsgPinReply",
  UnpinReply: "/sparkdream.forum.v1.MsgUnpinReply",
  MarkAcceptedReply: "/sparkdream.forum.v1.MsgMarkAcceptedReply",
  FreezeThread: "/sparkdream.forum.v1.MsgFreezeThread",
  UnarchiveThread: "/sparkdream.forum.v1.MsgUnarchiveThread",
} as const;

// Season transaction message type URLs
export const SeasonMsgTypeUrls = {
  SetDisplayName: "/sparkdream.season.v1.MsgSetDisplayName",
  SetUsername: "/sparkdream.season.v1.MsgSetUsername",
  SetDisplayTitle: "/sparkdream.season.v1.MsgSetDisplayTitle",
  StartQuest: "/sparkdream.season.v1.MsgStartQuest",
  ClaimQuestReward: "/sparkdream.season.v1.MsgClaimQuestReward",
  AbandonQuest: "/sparkdream.season.v1.MsgAbandonQuest",
  CreateGuild: "/sparkdream.season.v1.MsgCreateGuild",
  JoinGuild: "/sparkdream.season.v1.MsgJoinGuild",
  LeaveGuild: "/sparkdream.season.v1.MsgLeaveGuild",
  InviteToGuild: "/sparkdream.season.v1.MsgInviteToGuild",
  AcceptGuildInvite: "/sparkdream.season.v1.MsgAcceptGuildInvite",
  RevokeGuildInvite: "/sparkdream.season.v1.MsgRevokeGuildInvite",
  KickFromGuild: "/sparkdream.season.v1.MsgKickFromGuild",
  PromoteToOfficer: "/sparkdream.season.v1.MsgPromoteToOfficer",
  DemoteOfficer: "/sparkdream.season.v1.MsgDemoteOfficer",
  TransferGuildFounder: "/sparkdream.season.v1.MsgTransferGuildFounder",
  DissolveGuild: "/sparkdream.season.v1.MsgDissolveGuild",
  ClaimGuildFounder: "/sparkdream.season.v1.MsgClaimGuildFounder",
  SetGuildInviteOnly: "/sparkdream.season.v1.MsgSetGuildInviteOnly",
  UpdateGuildDescription: "/sparkdream.season.v1.MsgUpdateGuildDescription",
  Nominate: "/sparkdream.season.v1.MsgNominate",
  StakeNomination: "/sparkdream.season.v1.MsgStakeNomination",
  UnstakeNomination: "/sparkdream.season.v1.MsgUnstakeNomination",
} as const;

// Build a blog message for signing.
export function buildBlogMsg(typeUrl: string, value: Record<string, unknown>) {
  return { typeUrl, value };
}
