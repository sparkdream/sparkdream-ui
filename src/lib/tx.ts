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
// ICS-20 token transfer to another chain over an IBC channel. Registry and
// amino converter both come from cosmjs's defaults.
export const IbcMsgTypeUrls = {
  Transfer: "/ibc.applications.transfer.v1.MsgTransfer",
} as const;

export const DistributionMsgTypeUrls = {
  WithdrawDelegatorReward: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
  SetWithdrawAddress: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
} as const;

// Commons transaction message type URLs
export const CommonsMsgTypeUrls = {
  SubmitProposal: "/sparkdream.commons.v1.MsgSubmitProposal",
  VoteProposal: "/sparkdream.commons.v1.MsgVoteProposal",
  SubmitAnonymousProposal: "/sparkdream.commons.v1.MsgSubmitAnonymousProposal",
  AnonymousVoteProposal: "/sparkdream.commons.v1.MsgAnonymousVoteProposal",
  ExecuteProposal: "/sparkdream.commons.v1.MsgExecuteProposal",
  UpdateGroupMembers: "/sparkdream.commons.v1.MsgUpdateGroupMembers",
  SpendFromCommons: "/sparkdream.commons.v1.MsgSpendFromCommons",
  // Recurring council payments (session RecurringPull grants under the hood);
  // signer is the council policy, so both travel inside a council proposal.
  ScheduleRecurringSpend: "/sparkdream.commons.v1.MsgScheduleRecurringSpend",
  CancelRecurringSpend: "/sparkdream.commons.v1.MsgCancelRecurringSpend",
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
  CreateGrant: "/sparkdream.session.v1.MsgCreateGrant",
  RevokeGrant: "/sparkdream.session.v1.MsgRevokeGrant",
  DeclineGrant: "/sparkdream.session.v1.MsgDeclineGrant",
  ClaimRecurringPull: "/sparkdream.session.v1.MsgClaimRecurringPull",
  PullAllowance: "/sparkdream.session.v1.MsgPullAllowance",
  RetryScheduledOneshot: "/sparkdream.session.v1.MsgRetryScheduledOneshot",
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
  // Releasing an assignment and retiring the work item are separate exits
  // (chain commit 50c6fb6, sparkdreamjs 0.0.38). UnassignInitiative returns the
  // initiative to OPEN with its conviction and stakes intact so someone else
  // can pick it up; it is signed by the assignee stepping down or by the
  // Operations Committee freeing stalled work, and deliberately NOT by the
  // project creator, whose lever is CloseInitiative. CloseInitiative retires
  // the item and returns its budget to the project net of review fees, and now
  // works whether or not anyone is assigned.
  UnassignInitiative: "/sparkdream.rep.v1.MsgUnassignInitiative",
  CloseInitiative: "/sparkdream.rep.v1.MsgCloseInitiative",
  CompleteInitiative: "/sparkdream.rep.v1.MsgCompleteInitiative",
  Stake: "/sparkdream.rep.v1.MsgStake",
  Unstake: "/sparkdream.rep.v1.MsgUnstake",
  ClaimStakingRewards: "/sparkdream.rep.v1.MsgClaimStakingRewards",
  CompoundStakingRewards: "/sparkdream.rep.v1.MsgCompoundStakingRewards",
  CreateChallenge: "/sparkdream.rep.v1.MsgCreateChallenge",
  RespondToChallenge: "/sparkdream.rep.v1.MsgRespondToChallenge",
  SubmitJurorVote: "/sparkdream.rep.v1.MsgSubmitJurorVote",
  // Jury summons lifecycle (chain commit 70dce72, sparkdreamjs 0.0.36).
  // Accepting converts a seat drawn by lot into a commitment to vote and is
  // what makes the abandoned-seat penalty fair; declining is free and immediate
  // so the seat can be redrawn while there is still time to read the work.
  AcceptJuryDuty: "/sparkdream.rep.v1.MsgAcceptJuryDuty",
  DeclineJuryDuty: "/sparkdream.rep.v1.MsgDeclineJuryDuty",
  // Bonded initiative review (chain commit 70dce72). SubmitInitiativeReview
  // files one reviewer's verdict on the current round and reserves bond scaled
  // to the initiative budget; MsgApproveInitiative is the separate, advisory
  // staker endorsement and does not satisfy the gate.
  SubmitInitiativeReview: "/sparkdream.rep.v1.MsgSubmitInitiativeReview",
  // Project creator (or Operations Committee) turns review on for a project's
  // initiatives. Settable while the project is ACTIVE rather than fixed at
  // creation, because the reviewer roster grows over time.
  SetVerificationPolicy: "/sparkdream.rep.v1.MsgSetVerificationPolicy",
  // Operations Committee settles a review round that hit its deadline without
  // meeting the gate: approve, reject (another round), or pass (let conviction
  // and the challenge window decide). Silence resolves to reject.
  ResolveReviewEscalation: "/sparkdream.rep.v1.MsgResolveReviewEscalation",
  // Review bounties (chain commit 32f2cee): anyone escrows DREAM against an
  // initiative to bid reviewer attention toward it. Paid per verdict filed, so
  // funding buys a look rather than an approval. Reclaim needs
  // params.review_bounty_reclaim_delay blocks AND no verdict filed yet.
  FundReviewBounty: "/sparkdream.rep.v1.MsgFundReviewBounty",
  ReclaimReviewBounty: "/sparkdream.rep.v1.MsgReclaimReviewBounty",
  // Initiative bounties (chain commit b9da52e): DREAM escrowed against an
  // OPEN or ASSIGNED initiative by a non-affiliated member, paid to the
  // assignee on completion and refunded on close/reject. Reclaim only while
  // the initiative is OPEN and after params.initiative_bounty_reclaim_delay.
  FundInitiativeBounty: "/sparkdream.rep.v1.MsgFundInitiativeBounty",
  ReclaimInitiativeBounty: "/sparkdream.rep.v1.MsgReclaimInitiativeBounty",
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
  // Cancel (reduce) an in-flight unbond, returning the cancelled amount to
  // active bond without waiting out the cooldown (chain commit d4507ca,
  // sparkdreamjs 0.0.26). amount must be <= the role's pending_unbond_amount.
  CancelUnbondRole: "/sparkdream.rep.v1.MsgCancelUnbondRole",
} as const;

// x/rep identity messages: member key migration, recovery commitments and the
// ZK key. The chain refuses every one of them through a session key, a shield
// proof or a vault (x/rep IdentityMsgTypeURLs), so they are always signed by
// the connected wallet itself. Every bytes field is a Uint8Array.
export const RepIdentityMsgTypeUrls = {
  RequestMigration: "/sparkdream.rep.v1.MsgRequestMigration",
  AcceptMigration: "/sparkdream.rep.v1.MsgAcceptMigration",
  CancelMigration: "/sparkdream.rep.v1.MsgCancelMigration",
  SetRecoveryCommitment: "/sparkdream.rep.v1.MsgSetRecoveryCommitment",
  RemoveRecoveryCommitment: "/sparkdream.rep.v1.MsgRemoveRecoveryCommitment",
  CommitRecovery: "/sparkdream.rep.v1.MsgCommitRecovery",
  RevealRecovery: "/sparkdream.rep.v1.MsgRevealRecovery",
  ObjectMigration: "/sparkdream.rep.v1.MsgObjectMigration",
  SweepTombstone: "/sparkdream.rep.v1.MsgSweepTombstone",
  // A Commons Governance Committee proposal's inner message.
  ForceMigration: "/sparkdream.rep.v1.MsgForceMigration",
  RegisterZkPublicKey: "/sparkdream.rep.v1.MsgRegisterZkPublicKey",
  ClearZkPublicKey: "/sparkdream.rep.v1.MsgClearZkPublicKey",
} as const;

// x/vault shared-account messages. Like the identity messages, never sent
// through a session key. MsgUpdateVault is only valid as a proposal's inner
// message (its signer is the vault address).
export const VaultMsgTypeUrls = {
  CreateVault: "/sparkdream.vault.v1.MsgCreateVault",
  Propose: "/sparkdream.vault.v1.MsgPropose",
  Approve: "/sparkdream.vault.v1.MsgApprove",
  RevokeApproval: "/sparkdream.vault.v1.MsgRevokeApproval",
  Execute: "/sparkdream.vault.v1.MsgExecute",
  CancelProposal: "/sparkdream.vault.v1.MsgCancelProposal",
  UpdateVault: "/sparkdream.vault.v1.MsgUpdateVault",
} as const;

/**
 * Messages the chain never accepts inside MsgExecSession (x/session
 * ForbiddenAllowlistMsgs: the rep identity list and every vault message), so
 * the wallet signs them directly even while session mode is active.
 */
export const SESSION_FORBIDDEN_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.values(RepIdentityMsgTypeUrls),
  ...Object.values(VaultMsgTypeUrls),
]);

// x/service operator lifecycle message type URLs. Each is signed by the
// operator itself (MsgRegisterOperator cannot go through x/session).
export const ServiceMsgTypeUrls = {
  RegisterOperator: "/sparkdream.service.v1.MsgRegisterOperator",
  UpdateMetadata: "/sparkdream.service.v1.MsgUpdateMetadata",
  TopUpBond: "/sparkdream.service.v1.MsgTopUpBond",
  UnbondOperator: "/sparkdream.service.v1.MsgUnbondOperator",
  ClaimUnbondedBond: "/sparkdream.service.v1.MsgClaimUnbondedBond",
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
  // Sentinel self-correct (chain commit 4ad8e38, sparkdreamjs 0.0.27): the
  // hiding sentinel reverses its own hide within
  // params.sentinel_unhide_window_blocks, before any appeal. Restores the
  // author bond + rep slashed at hide time; the sentinel's committed bond
  // stays reserved until the original appeal_deadline.
  UnhideContent: "/sparkdream.collect.v1.MsgUnhideContent",
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
  DisputePin: "/sparkdream.forum.v1.MsgDisputePin",
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
  // Accepted-reply curation (chain commit c8be748, sparkdreamjs 0.0.25). The
  // thread author calling MarkAcceptedReply on their own thread accepts
  // directly; a sentinel calling it on someone else's thread records a pending
  // proposal that the author confirms or rejects (or it auto-confirms after the
  // accept_proposal_timeout). thread_id is the root post id, reply_id the reply.
  MarkAcceptedReply: "/sparkdream.forum.v1.MsgMarkAcceptedReply",
  ConfirmProposedReply: "/sparkdream.forum.v1.MsgConfirmProposedReply",
  RejectProposedReply: "/sparkdream.forum.v1.MsgRejectProposedReply",
  // Thread author closes/reopens their thread to sentinel accepted-reply
  // proposals (chain commit b991fc9, sparkdreamjs 0.0.26). `locked: true` makes
  // proposeAcceptedReply error with ErrThreadProposalsLocked. Author-only.
  SetThreadProposalsLock: "/sparkdream.forum.v1.MsgSetThreadProposalsLock",
  FreezeThread: "/sparkdream.forum.v1.MsgFreezeThread",
  UnarchiveThread: "/sparkdream.forum.v1.MsgUnarchiveThread",
} as const;

// authority field shared by the sentinel/council moderation messages
// MsgHidePost, MsgLockThread and MsgMoveThread — and, as of chain commit
// 4ad8e38 (sparkdreamjs 0.0.27), x/collect's MsgHideContent, which mirrors the
// same enum. Mirrors the chain's ModerationAuthority enum (renamed from
// HideAuthority and extended to lock/move
// in chain commit ca0508c). AUTO resolves to the sentinel path whenever the
// account is eligible for that specific action (an eligible NORMAL/RECOVERY
// sentinel bond plus the action's own bond/rep requirements), else the council
// path; SENTINEL/COUNCIL force the path and error if the account isn't eligible.
// Sent as the numeric enum value: the amino converter omits AUTO (0) and emits
// 1/2 as ints, so acting as council is a deliberate, explicit choice rather than
// an implicit upgrade. See docs/HANDOFF_HIDE_AUTHORITY_DISAMBIGUATION.md.
export const ModerationAuthority = {
  AUTO: 0,
  SENTINEL: 1,
  COUNCIL: 2,
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

// Federation transaction message type URLs. The identity pair is signed
// directly by the user; the peer lifecycle messages take `authority` and are
// only accepted from the Commons Council policy address, so they travel as
// inner messages of a commons proposal.
export const FederationMsgTypeUrls = {
  LinkIdentity: "/sparkdream.federation.v1.MsgLinkIdentity",
  UnlinkIdentity: "/sparkdream.federation.v1.MsgUnlinkIdentity",
  RegisterPeer: "/sparkdream.federation.v1.MsgRegisterPeer",
  SuspendPeer: "/sparkdream.federation.v1.MsgSuspendPeer",
  ResumePeer: "/sparkdream.federation.v1.MsgResumePeer",
  RemovePeer: "/sparkdream.federation.v1.MsgRemovePeer",
  // Operations Committee, not the Commons Council -- the keeper gates this one
  // on the "operations" committee and the Council policy does not allow it.
  UpdatePeerPolicy: "/sparkdream.federation.v1.MsgUpdatePeerPolicy",
  // Creator-signed: the author publishes their own content to a peer. Not a
  // governance action, and never automatic -- creating content federates
  // nothing on its own.
  FederateContent: "/sparkdream.federation.v1.MsgFederateContent",
  // Phase 2 of an identity link, signed by the holder of the CLAIMED address
  // on this chain. Signing it is the proof of key ownership.
  ConfirmIdentityLink: "/sparkdream.federation.v1.MsgConfirmIdentityLink",
} as const;

// Artifact (x/artifact NFT) message type URLs. Build values with camelCase
// fields per the sparkdreamjs TS types, every uint64/int64 as BigInt and every
// enum as its int (xxxFromJSON). MsgUpdateParams and MsgUpdateOperationalParams
// are council-only and have no member UI.
export const ArtifactMsgTypeUrls = {
  CreateClass: "/sparkdream.artifact.v1.MsgCreateClass",
  UpdateClass: "/sparkdream.artifact.v1.MsgUpdateClass",
  FreezeClassMetadata: "/sparkdream.artifact.v1.MsgFreezeClassMetadata",
  SetMintPolicy: "/sparkdream.artifact.v1.MsgSetMintPolicy",
  SetMinters: "/sparkdream.artifact.v1.MsgSetMinters",
  SetMaxSupply: "/sparkdream.artifact.v1.MsgSetMaxSupply",
  CloseMinting: "/sparkdream.artifact.v1.MsgCloseMinting",
  ProposeClassOwner: "/sparkdream.artifact.v1.MsgProposeClassOwner",
  AcceptClassOwner: "/sparkdream.artifact.v1.MsgAcceptClassOwner",
  CancelClassOwner: "/sparkdream.artifact.v1.MsgCancelClassOwner",
  DeleteClass: "/sparkdream.artifact.v1.MsgDeleteClass",
  Mint: "/sparkdream.artifact.v1.MsgMint",
  PublicMint: "/sparkdream.artifact.v1.MsgPublicMint",
  Transfer: "/sparkdream.artifact.v1.MsgTransfer",
  AcceptIncoming: "/sparkdream.artifact.v1.MsgAcceptIncoming",
  RejectIncoming: "/sparkdream.artifact.v1.MsgRejectIncoming",
  CancelOutgoing: "/sparkdream.artifact.v1.MsgCancelOutgoing",
  SetReceivePolicy: "/sparkdream.artifact.v1.MsgSetReceivePolicy",
  Burn: "/sparkdream.artifact.v1.MsgBurn",
  Revoke: "/sparkdream.artifact.v1.MsgRevoke",
  UpdateToken: "/sparkdream.artifact.v1.MsgUpdateToken",
  FreezeTokenMetadata: "/sparkdream.artifact.v1.MsgFreezeTokenMetadata",
  List: "/sparkdream.artifact.v1.MsgList",
  UpdateListing: "/sparkdream.artifact.v1.MsgUpdateListing",
  Delist: "/sparkdream.artifact.v1.MsgDelist",
  Buy: "/sparkdream.artifact.v1.MsgBuy",
  HideContent: "/sparkdream.artifact.v1.MsgHideContent",
  UnhideContent: "/sparkdream.artifact.v1.MsgUnhideContent",
  AppealHide: "/sparkdream.artifact.v1.MsgAppealHide",
  UpdateParams: "/sparkdream.artifact.v1.MsgUpdateParams",
  UpdateOperationalParams: "/sparkdream.artifact.v1.MsgUpdateOperationalParams",
  // Issuing: batch issue, expiry, tickets, royalty lock, reveals, media versions.
  Issue: "/sparkdream.artifact.v1.MsgIssue",
  Renew: "/sparkdream.artifact.v1.MsgRenew",
  Redeem: "/sparkdream.artifact.v1.MsgRedeem",
  LockRoyalty: "/sparkdream.artifact.v1.MsgLockRoyalty",
  Reveal: "/sparkdream.artifact.v1.MsgReveal",
  RevealSeed: "/sparkdream.artifact.v1.MsgRevealSeed",
  ProposeMedia: "/sparkdream.artifact.v1.MsgProposeMedia",
  AcceptMedia: "/sparkdream.artifact.v1.MsgAcceptMedia",
  RejectMedia: "/sparkdream.artifact.v1.MsgRejectMedia",
  SetDisplayedMedia: "/sparkdream.artifact.v1.MsgSetDisplayedMedia",
  // Editions and impact certificates (semi-fungible units).
  CreateEdition: "/sparkdream.artifact.v1.MsgCreateEdition",
  MintUnits: "/sparkdream.artifact.v1.MsgMintUnits",
  TransferUnits: "/sparkdream.artifact.v1.MsgTransferUnits",
  BurnUnits: "/sparkdream.artifact.v1.MsgBurnUnits",
  RevokeUnits: "/sparkdream.artifact.v1.MsgRevokeUnits",
  ListUnits: "/sparkdream.artifact.v1.MsgListUnits",
  UpdateUnitListing: "/sparkdream.artifact.v1.MsgUpdateUnitListing",
  DelistUnits: "/sparkdream.artifact.v1.MsgDelistUnits",
  BuyUnits: "/sparkdream.artifact.v1.MsgBuyUnits",
  FundEdition: "/sparkdream.artifact.v1.MsgFundEdition",
  ClaimEditionRewards: "/sparkdream.artifact.v1.MsgClaimEditionRewards",
  // Crafting, rentals, nesting.
  AddCraftRecipe: "/sparkdream.artifact.v1.MsgAddCraftRecipe",
  RemoveCraftRecipe: "/sparkdream.artifact.v1.MsgRemoveCraftRecipe",
  Craft: "/sparkdream.artifact.v1.MsgCraft",
  OfferRental: "/sparkdream.artifact.v1.MsgOfferRental",
  CancelRentalOffer: "/sparkdream.artifact.v1.MsgCancelRentalOffer",
  AcceptRental: "/sparkdream.artifact.v1.MsgAcceptRental",
  EndRental: "/sparkdream.artifact.v1.MsgEndRental",
  Nest: "/sparkdream.artifact.v1.MsgNest",
  Detach: "/sparkdream.artifact.v1.MsgDetach",
  // Harberger, offers, auctions.
  SetHarbergerPrice: "/sparkdream.artifact.v1.MsgSetHarbergerPrice",
  ForceBuy: "/sparkdream.artifact.v1.MsgForceBuy",
  MakeOffer: "/sparkdream.artifact.v1.MsgMakeOffer",
  CancelOffer: "/sparkdream.artifact.v1.MsgCancelOffer",
  AcceptOffer: "/sparkdream.artifact.v1.MsgAcceptOffer",
  StartAuction: "/sparkdream.artifact.v1.MsgStartAuction",
  Bid: "/sparkdream.artifact.v1.MsgBid",
  SettleAuction: "/sparkdream.artifact.v1.MsgSettleAuction",
  CancelAuction: "/sparkdream.artifact.v1.MsgCancelAuction",
} as const;

// Build a blog message for signing.
export function buildBlogMsg(typeUrl: string, value: Record<string, unknown>) {
  return { typeUrl, value };
}
