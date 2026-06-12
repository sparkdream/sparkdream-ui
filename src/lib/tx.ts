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
  CancelUpgrade: "/cosmos.upgrade.v1beta1.MsgCancelUpgrade",
} as const;

// Cosmos SDK x/staking validator-delegation message type URLs. Registered
// in WalletContext via the cosmjs `defaultRegistryTypes` +
// `createDefaultAminoConverters()` (no sparkdreamjs override needed — the
// chain accepts the standard amino names "cosmos-sdk/MsgDelegate", etc.).
export const StakingMsgTypeUrls = {
  Delegate: "/cosmos.staking.v1beta1.MsgDelegate",
  Undelegate: "/cosmos.staking.v1beta1.MsgUndelegate",
  BeginRedelegate: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
  CancelUnbondingDelegation: "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation",
} as const;

// Cosmos SDK x/distribution — only WithdrawDelegatorReward is exposed in
// the UI today (one msg per delegation, batched into a single tx by the
// "Claim All Rewards" button).
export const DistributionMsgTypeUrls = {
  WithdrawDelegatorReward: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
  SetWithdrawAddress: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
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
  DeleteCategory: "/sparkdream.commons.v1.MsgDeleteCategory",
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
  // Pin/Unpin are display-only "feature" markers and require a permanent
  // target — the chain rejects pinning an ephemeral post (ErrCannotPinEphemeral).
  // Promoting an ephemeral post to permanent is the separate MakePostPermanent
  // lifecycle message below (see chain commit e0126a0).
  PinPost: "/sparkdream.blog.v1.MsgPinPost",
  UnpinPost: "/sparkdream.blog.v1.MsgUnpinPost",
  PinReply: "/sparkdream.blog.v1.MsgPinReply",
  UnpinReply: "/sparkdream.blog.v1.MsgUnpinReply",
  MakePostPermanent: "/sparkdream.blog.v1.MsgMakePostPermanent",
  MakeReplyPermanent: "/sparkdream.blog.v1.MsgMakeReplyPermanent",
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
  // Content challenges against author-bonded posts/replies (distinct from the
  // member challenge flow above).
  ChallengeContent: "/sparkdream.rep.v1.MsgChallengeContent",
  RespondToContentChallenge: "/sparkdream.rep.v1.MsgRespondToContentChallenge",
  CreateTag: "/sparkdream.rep.v1.MsgCreateTag",
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
  // MsgUpdateCollection's `tags` field overwrites the collection's tag set
  // unconditionally (see x/collect's update handler) — any Edit Collection
  // UI must include the existing tags or every edit wipes them. Use the
  // useTagRegistry + buildCreateTagMsgs pattern from @/lib/tags, same as
  // CreateCollectionForm / EditPostForm.
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
  // Pin/Unpin are display-only "feature" markers requiring a permanent target;
  // promoting an ephemeral collection to permanent is the separate
  // MakeCollectionPermanent lifecycle message (chain commit 681ff73).
  PinCollection: "/sparkdream.collect.v1.MsgPinCollection",
  UnpinCollection: "/sparkdream.collect.v1.MsgUnpinCollection",
  MakeCollectionPermanent: "/sparkdream.collect.v1.MsgMakeCollectionPermanent",
} as const;

// Name transaction message type URLs
export const NameMsgTypeUrls = {
  RegisterName: "/sparkdream.name.v1.MsgRegisterName",
  SetPrimary: "/sparkdream.name.v1.MsgSetPrimary",
  UpdateName: "/sparkdream.name.v1.MsgUpdateName",
  SetDisplayName: "/sparkdream.name.v1.MsgSetDisplayName",
  // SetTarget points forward-resolution at a different address. The target
  // must call AcceptTarget before that address may set the name as primary.
  SetTarget: "/sparkdream.name.v1.MsgSetTarget",
  AcceptTarget: "/sparkdream.name.v1.MsgAcceptTarget",
  TransferName: "/sparkdream.name.v1.MsgTransferName",
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
  // Bounty lifecycle: the thread author escrows SPARK with CreateBounty,
  // assigns equal shares (amount / max winners) to replies with
  // AssignBountyToReply while funds stay in escrow, then AwardBounty pays
  // out every assigned share and closes the bounty.
  CreateBounty: "/sparkdream.forum.v1.MsgCreateBounty",
  AwardBounty: "/sparkdream.forum.v1.MsgAwardBounty",
  IncreaseBounty: "/sparkdream.forum.v1.MsgIncreaseBounty",
  CancelBounty: "/sparkdream.forum.v1.MsgCancelBounty",
  AssignBountyToReply: "/sparkdream.forum.v1.MsgAssignBountyToReply",
  HidePost: "/sparkdream.forum.v1.MsgHidePost",
  UnhidePost: "/sparkdream.forum.v1.MsgUnhidePost",
  AppealPost: "/sparkdream.forum.v1.MsgAppealPost",
  LockThread: "/sparkdream.forum.v1.MsgLockThread",
  UnlockThread: "/sparkdream.forum.v1.MsgUnlockThread",
  MoveThread: "/sparkdream.forum.v1.MsgMoveThread",
  PinPost: "/sparkdream.forum.v1.MsgPinPost",
  UnpinPost: "/sparkdream.forum.v1.MsgUnpinPost",
  PinReply: "/sparkdream.forum.v1.MsgPinReply",
  UnpinReply: "/sparkdream.forum.v1.MsgUnpinReply",
  // Pin/Unpin require a permanent target; promoting an ephemeral post to
  // permanent is the separate MakePostPermanent lifecycle message (chain
  // commit 9a3cebc).
  MakePostPermanent: "/sparkdream.forum.v1.MsgMakePostPermanent",
  // Post conviction-staking (chain commit 681ff73): an ESTABLISHED+ member
  // locks DREAM on someone else's post to stream per-tag reputation to its
  // author. Released after the lock window via the stake id returned in the
  // tx's `post_conviction_staked` event.
  StakePostConviction: "/sparkdream.forum.v1.MsgStakePostConviction",
  ReleasePostConviction: "/sparkdream.forum.v1.MsgReleasePostConviction",
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

// Reveal transaction message type URLs
export const RevealMsgTypeUrls = {
  Propose: "/sparkdream.reveal.v1.MsgPropose",
  Approve: "/sparkdream.reveal.v1.MsgApprove",
  Reject: "/sparkdream.reveal.v1.MsgReject",
  Stake: "/sparkdream.reveal.v1.MsgStake",
  Withdraw: "/sparkdream.reveal.v1.MsgWithdraw",
  Reveal: "/sparkdream.reveal.v1.MsgReveal",
  Verify: "/sparkdream.reveal.v1.MsgVerify",
  Cancel: "/sparkdream.reveal.v1.MsgCancel",
  ResolveDispute: "/sparkdream.reveal.v1.MsgResolveDispute",
} as const;

// Futarchy transaction message type URLs
export const FutarchyMsgTypeUrls = {
  CreateMarket: "/sparkdream.futarchy.v1.MsgCreateMarket",
  Trade: "/sparkdream.futarchy.v1.MsgTrade",
  Redeem: "/sparkdream.futarchy.v1.MsgRedeem",
  WithdrawLiquidity: "/sparkdream.futarchy.v1.MsgWithdrawLiquidity",
  CancelMarket: "/sparkdream.futarchy.v1.MsgCancelMarket",
  UpdateOperationalParams: "/sparkdream.futarchy.v1.MsgUpdateOperationalParams",
} as const;

// Build a blog message for signing.
export function buildBlogMsg(typeUrl: string, value: Record<string, unknown>) {
  return { typeUrl, value };
}
