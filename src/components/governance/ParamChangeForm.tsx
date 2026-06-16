"use client";

import { useEffect, useState } from "react";
import { getModuleParams } from "@/lib/api";
import { useChainConfig } from "@/contexts/ChainConfigContext";

// ── Module definitions ──────────────────────────────────────────────

type FieldKind =
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "duration"
  | "coins"
  | "coin"
  | "dec-bytes"
  // sdk.math.Int and math.LegacyDec are wire-strings; we keep them as the
  // "string" kind on the input side but tag the field so the encoder leaves
  // them untouched (no micro-denom conversion etc.). All three render the
  // same plain text input.
  | "int"
  | "dec"
  // Post-chain-v1.0.11 (commit efcf392) most fee/tax/deposit fields are bare
  // math.Int strings in bond-denom micro-units; the denom is resolved at
  // runtime from x/identity. "amount" renders as the chain's displayDenom
  // (SPARK), converts the user-entered decimal to micro-units, and emits a
  // bare string on the wire (no `{denom, amount}` wrapper).
  | "amount"
  // x/rep DREAM is a non-bank token tracked in micro-DREAM (1 DREAM =
  // 1,000,000 micro-DREAM). "dream" renders/accepts whole DREAM, converts the
  // user-entered decimal to micro-DREAM, and emits a bare math.Int string on
  // the wire — same shape as "int", just with the 1e6 display conversion and a
  // "(DREAM)" unit label. Use it for params consumed via LockDREAM / MintDREAM
  // / bonded-role DREAM amounts (NOT bond-denom uspark fields — those stay
  // "int"/"amount").
  | "dream";

interface FieldDef {
  /** Unique editedValues key. For nested fields use the dot path, e.g.
   * "apprenticeTier.maxBudget" — uniqueness, not codec round-trip, is the
   * only invariant (`apiKey` is what actually reads/writes the LCD JSON). */
  key: string;
  /** LCD snake_case path into the params object. Dots descend into nested
   * messages (e.g. `apprentice_tier.max_budget` reaches into the rep
   * module's TierConfig). Single-level keys like `proposal_fee` are flat. */
  apiKey: string;
  label: string;
  kind: FieldKind;
  /** For duration: display unit name */
  unit?: string;
  /** For duration: divisor to get display unit from seconds */
  unitDivisor?: number;
  hint?: string;
  /** Optional section heading; consecutive fields sharing a group render
   * under one heading, in source order. Used by rep (90+ fields) to keep
   * the form scannable. */
  group?: string;
}

/**
 * Loader returns the protobuf `MsgUpdateParams` and `Params` codecs for a
 * sparkdream module. Used by the generic encoder to round-trip
 * `MsgUpdateParams { authority, params: Params.fromAmino(editedAminoJson) }`.
 */
type GenericLoader = () => Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MsgUpdateParams: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Params: { fromAmino: (obj: any) => any };
}>;

interface ModuleDef {
  label: string;
  paramPath: string;
  /** Response JSON key that contains the params object (usually "params") */
  responseKey: string;
  typeUrl: string;
  fields: FieldDef[];
  /**
   * Generic-encoder loader. When set, the form encodes via
   * `Params.fromAmino(currentAminoJson + edits)`; otherwise it falls back to
   * the explicit per-module switch in `encodeParamUpdate` below (used for
   * Cosmos-SDK modules whose cosmjs-types Params don't have fromAmino).
   */
  generic?: GenericLoader;
}

const MODULES: Record<string, ModuleDef> = {
  // ── Cosmos SDK ────────────────────────────────────────────────────
  gov: {
    label: "Governance",
    paramPath: "/cosmos/gov/v1/params/voting",
    responseKey: "params",
    typeUrl: "/cosmos.gov.v1.MsgUpdateParams",
    fields: [
      { key: "quorum", apiKey: "quorum", label: "Quorum", kind: "string", hint: "Fraction of total staked that must vote (e.g. 0.334)" },
      { key: "threshold", apiKey: "threshold", label: "Threshold", kind: "string", hint: "Fraction of Yes votes to pass (e.g. 0.5)" },
      { key: "vetoThreshold", apiKey: "veto_threshold", label: "Veto Threshold", kind: "string", hint: "Fraction of NoWithVeto votes to veto (e.g. 0.334)" },
      { key: "votingPeriod", apiKey: "voting_period", label: "Voting Period", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { key: "maxDepositPeriod", apiKey: "max_deposit_period", label: "Max Deposit Period", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { key: "minDeposit", apiKey: "min_deposit", label: "Min Deposit", kind: "coins" },
      { key: "minInitialDepositRatio", apiKey: "min_initial_deposit_ratio", label: "Min Initial Deposit Ratio", kind: "string" },
      { key: "expeditedThreshold", apiKey: "expedited_threshold", label: "Expedited Threshold", kind: "string" },
      { key: "expeditedVotingPeriod", apiKey: "expedited_voting_period", label: "Expedited Voting Period", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { key: "burnVoteQuorum", apiKey: "burn_vote_quorum", label: "Burn on Quorum Failure", kind: "boolean" },
      { key: "burnVoteVeto", apiKey: "burn_vote_veto", label: "Burn on Veto", kind: "boolean" },
    ],
  },
  staking: {
    label: "Staking",
    paramPath: "/cosmos/staking/v1beta1/params",
    responseKey: "params",
    typeUrl: "/cosmos.staking.v1beta1.MsgUpdateParams",
    fields: [
      { key: "unbondingTime", apiKey: "unbonding_time", label: "Unbonding Time", kind: "duration", unit: "days", unitDivisor: 86400 },
      { key: "maxValidators", apiKey: "max_validators", label: "Max Validators", kind: "number" },
      { key: "maxEntries", apiKey: "max_entries", label: "Max Entries", kind: "number" },
      { key: "historicalEntries", apiKey: "historical_entries", label: "Historical Entries", kind: "number" },
      { key: "bondDenom", apiKey: "bond_denom", label: "Bond Denom", kind: "string" },
      { key: "minCommissionRate", apiKey: "min_commission_rate", label: "Min Commission Rate", kind: "string", hint: "e.g. 0.05 = 5%" },
    ],
  },
  distribution: {
    label: "Distribution",
    paramPath: "/cosmos/distribution/v1beta1/params",
    responseKey: "params",
    typeUrl: "/cosmos.distribution.v1beta1.MsgUpdateParams",
    fields: [
      { key: "communityTax", apiKey: "community_tax", label: "Community Tax", kind: "string", hint: "e.g. 0.02 = 2%" },
      { key: "withdrawAddrEnabled", apiKey: "withdraw_addr_enabled", label: "Withdraw Address Enabled", kind: "boolean" },
    ],
  },
  slashing: {
    label: "Slashing",
    paramPath: "/cosmos/slashing/v1beta1/params",
    responseKey: "params",
    typeUrl: "/cosmos.slashing.v1beta1.MsgUpdateParams",
    fields: [
      { key: "signedBlocksWindow", apiKey: "signed_blocks_window", label: "Signed Blocks Window", kind: "bigint" },
      { key: "minSignedPerWindow", apiKey: "min_signed_per_window", label: "Min Signed Per Window", kind: "dec-bytes", hint: "e.g. 0.5 = 50%" },
      { key: "downtimeJailDuration", apiKey: "downtime_jail_duration", label: "Downtime Jail Duration", kind: "duration", unit: "minutes", unitDivisor: 60 },
      { key: "slashFractionDoubleSign", apiKey: "slash_fraction_double_sign", label: "Slash Fraction (Double Sign)", kind: "dec-bytes", hint: "e.g. 0.05 = 5%" },
      { key: "slashFractionDowntime", apiKey: "slash_fraction_downtime", label: "Slash Fraction (Downtime)", kind: "dec-bytes", hint: "e.g. 0.0001 = 0.01%" },
    ],
  },
  mint: {
    label: "Mint",
    paramPath: "/cosmos/mint/v1beta1/params",
    responseKey: "params",
    typeUrl: "/cosmos.mint.v1beta1.MsgUpdateParams",
    fields: [
      { key: "mintDenom", apiKey: "mint_denom", label: "Mint Denom", kind: "string" },
      { key: "inflationRateChange", apiKey: "inflation_rate_change", label: "Inflation Rate Change", kind: "string", hint: "Max yearly change in inflation (e.g. 0.13)" },
      { key: "inflationMax", apiKey: "inflation_max", label: "Inflation Max", kind: "string", hint: "Upper bound on yearly inflation (e.g. 0.20)" },
      { key: "inflationMin", apiKey: "inflation_min", label: "Inflation Min", kind: "string", hint: "Lower bound on yearly inflation (e.g. 0.07)" },
      { key: "goalBonded", apiKey: "goal_bonded", label: "Goal Bonded", kind: "string", hint: "Target bonded ratio (e.g. 0.67)" },
      { key: "blocksPerYear", apiKey: "blocks_per_year", label: "Blocks Per Year", kind: "bigint" },
    ],
  },

  // ── Sparkdream (generic encoder via Params.fromAmino) ─────────────
  commons: {
    label: "Commons",
    paramPath: "/sparkdream/commons/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.commons.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      { key: "proposalFee", apiKey: "proposal_fee", label: "Proposal Fee", kind: "string", hint: "sdk.Coins string e.g. 5000000uspark" },
    ],
  },
  blog: {
    label: "Blog",
    paramPath: "/sparkdream/blog/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.blog.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      { key: "maxTitleLength", apiKey: "max_title_length", label: "Max Title Length", kind: "bigint" },
      { key: "maxBodyLength", apiKey: "max_body_length", label: "Max Body Length", kind: "bigint" },
      { key: "maxReplyLength", apiKey: "max_reply_length", label: "Max Reply Length", kind: "bigint" },
      { key: "maxReplyDepth", apiKey: "max_reply_depth", label: "Max Reply Depth", kind: "number" },
      { key: "maxPostsPerDay", apiKey: "max_posts_per_day", label: "Max Posts Per Day", kind: "number" },
      { key: "maxRepliesPerDay", apiKey: "max_replies_per_day", label: "Max Replies Per Day", kind: "number" },
      { key: "maxReactionsPerDay", apiKey: "max_reactions_per_day", label: "Max Reactions Per Day", kind: "number" },
      { key: "costPerByte", apiKey: "cost_per_byte_amount", label: "Cost Per Byte", kind: "amount" },
      { key: "reactionFee", apiKey: "reaction_fee_amount", label: "Reaction Fee", kind: "amount" },
      { key: "costPerByteExempt", apiKey: "cost_per_byte_exempt", label: "Cost Per Byte Exempt", kind: "boolean" },
      { key: "reactionFeeExempt", apiKey: "reaction_fee_exempt", label: "Reaction Fee Exempt", kind: "boolean" },
      { key: "maxCostPerByte", apiKey: "max_cost_per_byte_amount", label: "Max Cost Per Byte", kind: "amount" },
      { key: "maxReactionFee", apiKey: "max_reaction_fee_amount", label: "Max Reaction Fee", kind: "amount" },
      { key: "ephemeralContentTtl", apiKey: "ephemeral_content_ttl", label: "Ephemeral Content TTL (blocks)", kind: "bigint" },
      { key: "minEphemeralContentTtl", apiKey: "min_ephemeral_content_ttl", label: "Min Ephemeral Content TTL (blocks)", kind: "bigint" },
      { key: "pinMinTrustLevel", apiKey: "pin_min_trust_level", label: "Pin Min Trust Level", kind: "number" },
      { key: "maxPinsPerDay", apiKey: "max_pins_per_day", label: "Max Pins Per Day", kind: "number" },
      { key: "convictionRenewalThreshold", apiKey: "conviction_renewal_threshold", label: "Conviction Renewal Threshold", kind: "dec" },
      { key: "convictionRenewalPeriod", apiKey: "conviction_renewal_period", label: "Conviction Renewal Period (blocks)", kind: "bigint" },
      { key: "maxTagsPerPost", apiKey: "max_tags_per_post", label: "Max Tags Per Post", kind: "number" },
      { key: "maxTagLength", apiKey: "max_tag_length", label: "Max Tag Length", kind: "number" },
      { key: "maxPromotionsPerBlock", apiKey: "max_promotions_per_block", label: "Max Promotions Per Block", kind: "number" },
      { key: "makePermanentMinTrustLevel", apiKey: "make_permanent_min_trust_level", label: "Make Permanent Min Trust Level", kind: "number" },
      { key: "maxMakePermanentPerDay", apiKey: "max_make_permanent_per_day", label: "Max Make Permanent Per Day", kind: "number" },
    ],
  },
  session: {
    label: "Session",
    paramPath: "/sparkdream/session/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.session.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      { group: "Sessions", key: "maxSessionsPerGranter", apiKey: "max_sessions_per_granter", label: "Max Sessions Per Granter", kind: "bigint" },
      { group: "Sessions", key: "maxMsgTypesPerSession", apiKey: "max_msg_types_per_session", label: "Max Msg Types Per Session", kind: "bigint" },
      { group: "Sessions", key: "maxExpiration", apiKey: "max_expiration", label: "Max Expiration", kind: "duration", unit: "days", unitDivisor: 86400 },
      { group: "Sessions", key: "maxSpendLimit", apiKey: "max_spend_limit_amount", label: "Max Spend Limit", kind: "amount" },
      { group: "Sessions", key: "maxExecCount", apiKey: "max_exec_count", label: "Max Exec Count", kind: "bigint" },
      { group: "Sessions", key: "maxGrantLifetimeSeconds", apiKey: "max_grant_lifetime_seconds", label: "Max Grant Lifetime (seconds)", kind: "bigint" },

      // Recurring pulls
      { group: "Recurring Pulls", key: "minRecurringPeriodSeconds", apiKey: "min_recurring_period_seconds", label: "Min Recurring Period (seconds)", kind: "bigint" },
      { group: "Recurring Pulls", key: "maxRecurringDurationSeconds", apiKey: "max_recurring_duration_seconds", label: "Max Recurring Duration (seconds)", kind: "bigint" },
      { group: "Recurring Pulls", key: "maxRecurringPullsPerGranter", apiKey: "max_recurring_pulls_per_granter", label: "Max Recurring Pulls Per Granter", kind: "number" },

      // Allowances
      { group: "Allowances", key: "minAllowancePeriodSeconds", apiKey: "min_allowance_period_seconds", label: "Min Allowance Period (seconds)", kind: "bigint" },
      { group: "Allowances", key: "maxAllowancesPerGranter", apiKey: "max_allowances_per_granter", label: "Max Allowances Per Granter", kind: "number" },
      { group: "Allowances", key: "maxAllowanceRecipientList", apiKey: "max_allowance_recipient_list", label: "Max Allowance Recipient List", kind: "number" },
      { group: "Allowances", key: "minPullAmount", apiKey: "min_pull_amount", label: "Min Pull Amount", kind: "string" },

      // Scheduled / one-shots
      { group: "Scheduled / One-shots", key: "minScheduleDelaySeconds", apiKey: "min_schedule_delay_seconds", label: "Min Schedule Delay (seconds)", kind: "bigint" },
      { group: "Scheduled / One-shots", key: "maxScheduleHorizonSeconds", apiKey: "max_schedule_horizon_seconds", label: "Max Schedule Horizon (seconds)", kind: "bigint" },
      { group: "Scheduled / One-shots", key: "fireToExpiryBufferSeconds", apiKey: "fire_to_expiry_buffer_seconds", label: "Fire-to-Expiry Buffer (seconds)", kind: "bigint" },
      { group: "Scheduled / One-shots", key: "maxPendingOneshotsPerGranter", apiKey: "max_pending_oneshots_per_granter", label: "Max Pending One-shots Per Granter", kind: "number" },
      { group: "Scheduled / One-shots", key: "maxPausedOneshotsPerGranter", apiKey: "max_paused_oneshots_per_granter", label: "Max Paused One-shots Per Granter", kind: "number" },
      { group: "Scheduled / One-shots", key: "pausedOneshotTtlSeconds", apiKey: "paused_oneshot_ttl_seconds", label: "Paused One-shot TTL (seconds)", kind: "bigint" },
      { group: "Scheduled / One-shots", key: "minOneshotExecGas", apiKey: "min_oneshot_exec_gas", label: "Min One-shot Exec Gas", kind: "bigint" },
      { group: "Scheduled / One-shots", key: "maxOneshotExecGas", apiKey: "max_oneshot_exec_gas", label: "Max One-shot Exec Gas", kind: "bigint" },
      { group: "Scheduled / One-shots", key: "oneshotGasPrice", apiKey: "oneshot_gas_price", label: "One-shot Gas Price", kind: "dec" },
      { group: "Scheduled / One-shots", key: "oneshotCreationFee", apiKey: "oneshot_creation_fee", label: "One-shot Creation Fee", kind: "bigint" },
      { group: "Scheduled / One-shots", key: "minOneshotDeposit", apiKey: "min_oneshot_deposit", label: "Min One-shot Deposit", kind: "bigint" },
      { group: "Scheduled / One-shots", key: "maxEndblockerDispatchesPerPass", apiKey: "max_endblocker_dispatches_per_pass", label: "Max EndBlocker Dispatches Per Pass", kind: "number" },
    ],
  },
  forum: {
    label: "Forum",
    paramPath: "/sparkdream/forum/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.forum.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      { key: "forumPaused", apiKey: "forum_paused", label: "Forum Paused", kind: "boolean" },
      { key: "moderationPaused", apiKey: "moderation_paused", label: "Moderation Paused", kind: "boolean" },
      { key: "appealsPaused", apiKey: "appeals_paused", label: "Appeals Paused", kind: "boolean" },
      { key: "bountiesEnabled", apiKey: "bounties_enabled", label: "Bounties Enabled", kind: "boolean" },
      { key: "reactionsEnabled", apiKey: "reactions_enabled", label: "Reactions Enabled", kind: "boolean" },
      { key: "editingEnabled", apiKey: "editing_enabled", label: "Editing Enabled", kind: "boolean" },
      { key: "spamTax", apiKey: "spam_tax_amount", label: "Spam Tax", kind: "amount" },
      { key: "reactionSpamTax", apiKey: "reaction_spam_tax_amount", label: "Reaction Spam Tax", kind: "amount" },
      { key: "flagSpamTax", apiKey: "flag_spam_tax_amount", label: "Flag Spam Tax", kind: "amount" },
      { key: "downvoteDeposit", apiKey: "downvote_deposit_amount", label: "Downvote Deposit", kind: "amount" },
      { key: "appealFee", apiKey: "appeal_fee_amount", label: "Appeal Fee", kind: "amount" },
      { key: "lockAppealFee", apiKey: "lock_appeal_fee_amount", label: "Lock Appeal Fee", kind: "amount" },
      { key: "moveAppealFee", apiKey: "move_appeal_fee_amount", label: "Move Appeal Fee", kind: "amount" },
      { key: "editFee", apiKey: "edit_fee_amount", label: "Edit Fee", kind: "amount" },
      { key: "costPerByte", apiKey: "cost_per_byte_amount", label: "Cost Per Byte", kind: "amount" },
      { key: "costPerByteExempt", apiKey: "cost_per_byte_exempt", label: "Cost Per Byte Exempt", kind: "boolean" },
      { key: "bountyCancellationFeePercent", apiKey: "bounty_cancellation_fee_percent", label: "Bounty Cancellation Fee (%)", kind: "bigint" },
      { key: "maxContentSize", apiKey: "max_content_size", label: "Max Content Size (bytes)", kind: "bigint" },
      { key: "dailyPostLimit", apiKey: "daily_post_limit", label: "Daily Post Limit", kind: "bigint" },
      { key: "maxReplyDepth", apiKey: "max_reply_depth", label: "Max Reply Depth", kind: "number" },
      { key: "maxFollowsPerDay", apiKey: "max_follows_per_day", label: "Max Follows Per Day", kind: "bigint" },
      { key: "editGracePeriod", apiKey: "edit_grace_period", label: "Edit Grace Period (blocks)", kind: "bigint" },
      { key: "editMaxWindow", apiKey: "edit_max_window", label: "Edit Max Window (blocks)", kind: "bigint" },
      { key: "ephemeralTtl", apiKey: "ephemeral_ttl", label: "Ephemeral TTL (blocks)", kind: "bigint" },
      { key: "archiveThreshold", apiKey: "archive_threshold", label: "Archive Threshold (blocks)", kind: "bigint" },
      { key: "archiveCooldown", apiKey: "archive_cooldown", label: "Archive Cooldown (blocks)", kind: "bigint" },
      { key: "unarchiveCooldown", apiKey: "unarchive_cooldown", label: "Unarchive Cooldown (blocks)", kind: "bigint" },
      { key: "hideAppealCooldown", apiKey: "hide_appeal_cooldown", label: "Hide Appeal Cooldown (blocks)", kind: "bigint" },
      { key: "lockAppealCooldown", apiKey: "lock_appeal_cooldown", label: "Lock Appeal Cooldown (blocks)", kind: "bigint" },
      { key: "moveAppealCooldown", apiKey: "move_appeal_cooldown", label: "Move Appeal Cooldown (blocks)", kind: "bigint" },
      { key: "minSentinelBond", apiKey: "min_sentinel_bond", label: "Min Sentinel Bond", kind: "dream" },
      { key: "minSentinelRepTier", apiKey: "min_sentinel_rep_tier", label: "Min Sentinel Rep Tier", kind: "bigint" },
      { key: "minSentinelTrustLevel", apiKey: "min_sentinel_trust_level", label: "Min Sentinel Trust Level", kind: "string" },
      { key: "minSentinelAgeBlocks", apiKey: "min_sentinel_age_blocks", label: "Min Sentinel Age (blocks)", kind: "bigint" },
      { key: "sentinelDemotionCooldown", apiKey: "sentinel_demotion_cooldown", label: "Sentinel Demotion Cooldown (blocks)", kind: "bigint" },
      { key: "sentinelDemotionThreshold", apiKey: "sentinel_demotion_threshold", label: "Sentinel Demotion Threshold", kind: "dec" },
      { key: "sentinelUnhideWindow", apiKey: "sentinel_unhide_window", label: "Sentinel Unhide Window (blocks)", kind: "bigint" },
      { key: "sentinelUnbondCooldown", apiKey: "sentinel_unbond_cooldown", label: "Sentinel Unbond Cooldown (seconds)", kind: "bigint", hint: "0 = immediate withdrawal; otherwise bond stays locked + slashable for this many seconds after MsgUnbondRole" },
      { key: "convictionRenewalThreshold", apiKey: "conviction_renewal_threshold", label: "Conviction Renewal Threshold", kind: "dec" },
      { key: "convictionRenewalPeriod", apiKey: "conviction_renewal_period", label: "Conviction Renewal Period (blocks)", kind: "bigint" },
      { key: "makePermanentMinTrustLevel", apiKey: "make_permanent_min_trust_level", label: "Make Permanent Min Trust Level", kind: "number" },
      { key: "maxPromotionsPerBlock", apiKey: "max_promotions_per_block", label: "Max Promotions Per Block", kind: "number" },
      { key: "maxMakePermanentPerDay", apiKey: "max_make_permanent_per_day", label: "Max Make Permanent Per Day", kind: "bigint" },
      { key: "authorRepSlash", apiKey: "author_rep_slash", label: "Author Rep Slash", kind: "dec", hint: "Reputation slashed from the author when their content is moderated" },
      // Post conviction staking
      { group: "Post Conviction", key: "minPostConvictionStake", apiKey: "min_post_conviction_stake", label: "Min Post Conviction Stake", kind: "dream", hint: "Floors out sybil dust stakes that farm the per-tag epoch cap" },
      { group: "Post Conviction", key: "postConvictionLockSeconds", apiKey: "post_conviction_lock_seconds", label: "Post Conviction Lock (seconds)", kind: "bigint" },
      { group: "Post Conviction", key: "postConvictionStreamRatePerBlock", apiKey: "post_conviction_stream_rate_per_block", label: "Post Conviction Stream Rate / Block", kind: "dec" },
      { group: "Post Conviction", key: "maxForumRepPerTagPerEpoch", apiKey: "max_forum_rep_per_tag_per_epoch", label: "Max Forum Rep / Tag / Epoch", kind: "dec" },
      { group: "Post Conviction", key: "postConvictionStakerSlashBps", apiKey: "post_conviction_staker_slash_bps", label: "Post Conviction Staker Slash (bps)", kind: "bigint", hint: "100 = 1%" },
      // Sentinel moderation rate caps + per-action slash (chain commit ca0508c).
      // 0 means "unset" → the chain uses the compile-time default shown in the hint.
      { group: "Sentinel Moderation", key: "maxHidesPerEpoch", apiKey: "max_hides_per_epoch", label: "Max Hides / Epoch", kind: "bigint", hint: "Sentinel hides per address per UTC day. 0 = default (50)" },
      { group: "Sentinel Moderation", key: "maxSentinelLocksPerEpoch", apiKey: "max_sentinel_locks_per_epoch", label: "Max Sentinel Locks / Epoch", kind: "bigint", hint: "0 = default (5)" },
      { group: "Sentinel Moderation", key: "maxSentinelMovesPerEpoch", apiKey: "max_sentinel_moves_per_epoch", label: "Max Sentinel Moves / Epoch", kind: "bigint", hint: "0 = default (10)" },
      { group: "Sentinel Moderation", key: "sentinelSlashAmount", apiKey: "sentinel_slash_amount", label: "Sentinel Slash Amount", kind: "dream", hint: "DREAM reserved-then-slashed per overturned action. 0 = default (100 DREAM)" },
      // Thread-lock eligibility floors (governance-only; derived from base bond).
      { group: "Sentinel Moderation", key: "lockBondMultiplier", apiKey: "lock_bond_multiplier", label: "Lock Bond Multiplier", kind: "bigint", hint: "Lock needs this many × Min Sentinel Bond. >= 1. 0 = default (4)" },
      { group: "Sentinel Moderation", key: "lockBackingAmount", apiKey: "lock_backing_amount", label: "Lock Backing Amount", kind: "dream", hint: "Min DREAM balance to lock a thread. 0 = default (20000 DREAM)" },
      { group: "Sentinel Moderation", key: "lockMinRepTier", apiKey: "lock_min_rep_tier", label: "Lock Min Rep Tier", kind: "bigint", hint: "Min rep tier to lock. [Min Sentinel Rep Tier, 5]. 0 = default (4)" },
    ],
  },
  futarchy: {
    label: "Futarchy",
    paramPath: "/sparkdream/futarchy/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.futarchy.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/futarchy/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/futarchy/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      { key: "minLiquidity", apiKey: "min_liquidity", label: "Min Liquidity", kind: "amount", hint: "Min base-denom liquidity to create a market" },
      { key: "maxDuration", apiKey: "max_duration", label: "Max Duration (blocks)", kind: "bigint" },
      { key: "defaultMinTick", apiKey: "default_min_tick", label: "Default Min Tick", kind: "int" },
      { key: "maxRedemptionDelay", apiKey: "max_redemption_delay", label: "Max Redemption Delay (blocks)", kind: "bigint" },
      { key: "tradingFeeBps", apiKey: "trading_fee_bps", label: "Trading Fee (bps)", kind: "bigint", hint: "30 = 0.3%" },
      { key: "maxLmsrExponent", apiKey: "max_lmsr_exponent", label: "Max LMSR Exponent", kind: "string" },
    ],
  },
  name: {
    label: "Name",
    paramPath: "/sparkdream/name/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.name.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/name/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/name/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      { key: "minNameLength", apiKey: "min_name_length", label: "Min Name Length", kind: "bigint" },
      { key: "maxNameLength", apiKey: "max_name_length", label: "Max Name Length", kind: "bigint" },
      { key: "maxNamesPerAddress", apiKey: "max_names_per_address", label: "Max Names Per Address", kind: "bigint" },
      { key: "expirationDuration", apiKey: "expiration_duration", label: "Expiration Duration", kind: "duration", unit: "days", unitDivisor: 86400 },
      { key: "registrationFee", apiKey: "registration_fee_amount", label: "Registration Fee", kind: "amount" },
      { key: "disputeStakeDream", apiKey: "dispute_stake_dream", label: "Dispute Stake", kind: "dream" },
      { key: "contestStakeDream", apiKey: "contest_stake_dream", label: "Contest Stake", kind: "dream" },
      { key: "disputeTimeoutBlocks", apiKey: "dispute_timeout_blocks", label: "Dispute Timeout (blocks)", kind: "bigint" },
    ],
  },
  reveal: {
    label: "Reveal",
    paramPath: "/sparkdream/reveal/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.reveal.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      { key: "stakeDeadlineEpochs", apiKey: "stake_deadline_epochs", label: "Stake Deadline (epochs)", kind: "bigint" },
      { key: "revealDeadlineEpochs", apiKey: "reveal_deadline_epochs", label: "Reveal Deadline (epochs)", kind: "bigint" },
      { key: "verificationPeriodEpochs", apiKey: "verification_period_epochs", label: "Verification Period (epochs)", kind: "bigint" },
      { key: "disputeResolutionEpochs", apiKey: "dispute_resolution_epochs", label: "Dispute Resolution (epochs)", kind: "bigint" },
      { key: "verificationThreshold", apiKey: "verification_threshold", label: "Verification Threshold", kind: "dec", hint: "e.g. 0.66" },
      { key: "minVerificationVotes", apiKey: "min_verification_votes", label: "Min Verification Votes", kind: "number" },
      { key: "maxTranches", apiKey: "max_tranches", label: "Max Tranches", kind: "number" },
      { key: "maxTrancheValuation", apiKey: "max_tranche_valuation", label: "Max Tranche Valuation", kind: "dream" },
      { key: "bondRate", apiKey: "bond_rate", label: "Bond Rate", kind: "dec", hint: "Fraction of total_valuation slashed on failure" },
      { key: "minProposerTrustLevel", apiKey: "min_proposer_trust_level", label: "Min Proposer Trust Level", kind: "number", hint: "2 = ESTABLISHED" },
      { key: "maxTotalValuation", apiKey: "max_total_valuation", label: "Max Total Valuation", kind: "dream" },
      { key: "minStakeAmount", apiKey: "min_stake_amount", label: "Min Stake Amount", kind: "dream" },
      { key: "payoutHoldbackRate", apiKey: "payout_holdback_rate", label: "Payout Holdback Rate", kind: "dec" },
      { key: "proposalCooldownEpochs", apiKey: "proposal_cooldown_epochs", label: "Proposal Cooldown (epochs)", kind: "bigint" },
    ],
  },
  federation: {
    label: "Federation",
    paramPath: "/sparkdream/federation/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.federation.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/params");
      return { MsgUpdateParams, Params };
    },
    // Bridge min_bond / unbonding period / slash caps live on the x/service
    // ServiceTypeConfig entries ("federation-bridge-activitypub" /
    // "federation-bridge-atproto" / -nostr / -lens). Edit those via the
    // service module, not federation params. The generic encoder round-trips
    // the repeated `known_content_types` list (not editable here) untouched.
    fields: [
      // Bridges
      { group: "Bridges", key: "maxBridgesPerPeer", apiKey: "max_bridges_per_peer", label: "Max Bridges Per Peer", kind: "bigint", hint: "Effective kill-switch; the real defenses are min_bond + content-hash dedup + rate limits" },
      { group: "Bridges", key: "bridgeInactivityThreshold", apiKey: "bridge_inactivity_threshold", label: "Bridge Inactivity Threshold (blocks)", kind: "bigint" },

      // Content
      { group: "Content", key: "maxContentBodySize", apiKey: "max_content_body_size", label: "Max Content Body Size", kind: "bigint" },
      { group: "Content", key: "maxContentUriSize", apiKey: "max_content_uri_size", label: "Max Content URI Size", kind: "bigint" },
      { group: "Content", key: "maxProtocolMetadataSize", apiKey: "max_protocol_metadata_size", label: "Max Protocol Metadata Size", kind: "bigint" },
      { group: "Content", key: "contentTtl", apiKey: "content_ttl", label: "Content TTL", kind: "duration", unit: "days", unitDivisor: 86400 },
      { group: "Content", key: "attestationTtl", apiKey: "attestation_ttl", label: "Attestation TTL", kind: "duration", unit: "days", unitDivisor: 86400 },

      // Identity links
      { group: "Identity Links", key: "maxIdentityLinksPerUser", apiKey: "max_identity_links_per_user", label: "Max Identity Links Per User", kind: "number" },
      { group: "Identity Links", key: "unverifiedLinkTtl", apiKey: "unverified_link_ttl", label: "Unverified Link TTL", kind: "duration", unit: "days", unitDivisor: 86400 },
      { group: "Identity Links", key: "challengeTtl", apiKey: "challenge_ttl", label: "Challenge TTL", kind: "duration", unit: "days", unitDivisor: 86400 },

      // Trust
      { group: "Trust", key: "globalMaxTrustCredit", apiKey: "global_max_trust_credit", label: "Global Max Trust Credit", kind: "number" },
      { group: "Trust", key: "trustDiscountRate", apiKey: "trust_discount_rate", label: "Trust Discount Rate", kind: "dec" },

      // Rate limits
      { group: "Rate Limits", key: "maxInboundPerBlock", apiKey: "max_inbound_per_block", label: "Max Inbound Per Block", kind: "bigint" },
      { group: "Rate Limits", key: "maxOutboundPerBlock", apiKey: "max_outbound_per_block", label: "Max Outbound Per Block", kind: "bigint" },
      { group: "Rate Limits", key: "maxPrunePerBlock", apiKey: "max_prune_per_block", label: "Max Prune Per Block", kind: "bigint" },
      { group: "Rate Limits", key: "rateLimitWindow", apiKey: "rate_limit_window", label: "Rate Limit Window", kind: "duration", unit: "hours", unitDivisor: 3600 },

      // Verifiers
      { group: "Verifiers", key: "minVerifierTrustLevel", apiKey: "min_verifier_trust_level", label: "Min Verifier Trust Level", kind: "number" },
      { group: "Verifiers", key: "minVerifierBond", apiKey: "min_verifier_bond", label: "Min Verifier Bond", kind: "dream" },
      { group: "Verifiers", key: "verifierRecoveryThreshold", apiKey: "verifier_recovery_threshold", label: "Verifier Recovery Threshold", kind: "dream" },
      { group: "Verifiers", key: "verifierSlashAmount", apiKey: "verifier_slash_amount", label: "Verifier Slash Amount", kind: "dream" },
      { group: "Verifiers", key: "verificationWindow", apiKey: "verification_window", label: "Verification Window", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { group: "Verifiers", key: "minEpochVerifications", apiKey: "min_epoch_verifications", label: "Min Epoch Verifications", kind: "number" },
      { group: "Verifiers", key: "minVerifierAccuracy", apiKey: "min_verifier_accuracy", label: "Min Verifier Accuracy", kind: "dec" },
      { group: "Verifiers", key: "verifierDemotionCooldown", apiKey: "verifier_demotion_cooldown", label: "Verifier Demotion Cooldown", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { group: "Verifiers", key: "verifierOverturnBaseCooldown", apiKey: "verifier_overturn_base_cooldown", label: "Verifier Overturn Base Cooldown", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { group: "Verifiers", key: "upheldToResetOverturns", apiKey: "upheld_to_reset_overturns", label: "Upheld To Reset Overturns", kind: "number" },
      { group: "Verifiers", key: "verifierUnbondCooldown", apiKey: "verifier_unbond_cooldown", label: "Verifier Unbond Cooldown", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { group: "Verifiers", key: "operatorRewardShare", apiKey: "operator_reward_share", label: "Operator Reward Share", kind: "dec" },
      { group: "Verifiers", key: "verifierDreamReward", apiKey: "verifier_dream_reward", label: "Verifier Reward", kind: "dream" },
      { group: "Verifiers", key: "maxVerifierDreamMintPerEpoch", apiKey: "max_verifier_dream_mint_per_epoch", label: "Max Verifier Mint / Epoch", kind: "dream" },

      // Challenges & arbitration
      { group: "Challenges & Arbitration", key: "challengeWindow", apiKey: "challenge_window", label: "Challenge Window", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { group: "Challenges & Arbitration", key: "challengeFee", apiKey: "challenge_fee_amount", label: "Challenge Fee", kind: "amount" },
      { group: "Challenges & Arbitration", key: "challengeJuryDeadline", apiKey: "challenge_jury_deadline", label: "Challenge Jury Deadline", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { group: "Challenges & Arbitration", key: "challengeCooldown", apiKey: "challenge_cooldown", label: "Challenge Cooldown", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { group: "Challenges & Arbitration", key: "escalationFee", apiKey: "escalation_fee_amount", label: "Escalation Fee", kind: "amount", hint: "Escrowed by the party escalating a challenge to a system report" },
      { group: "Challenges & Arbitration", key: "arbiterQuorum", apiKey: "arbiter_quorum", label: "Arbiter Quorum", kind: "number" },
      { group: "Challenges & Arbitration", key: "arbiterResolutionWindow", apiKey: "arbiter_resolution_window", label: "Arbiter Resolution Window", kind: "duration", unit: "hours", unitDivisor: 3600 },
      { group: "Challenges & Arbitration", key: "arbiterEscalationWindow", apiKey: "arbiter_escalation_window", label: "Arbiter Escalation Window", kind: "duration", unit: "hours", unitDivisor: 3600 },

      // IBC
      { group: "IBC", key: "ibcPort", apiKey: "ibc_port", label: "IBC Port", kind: "string" },
      { group: "IBC", key: "ibcChannelVersion", apiKey: "ibc_channel_version", label: "IBC Channel Version", kind: "string" },
      { group: "IBC", key: "ibcPacketTimeout", apiKey: "ibc_packet_timeout", label: "IBC Packet Timeout", kind: "duration", unit: "minutes", unitDivisor: 60 },
    ],
  },
  collect: {
    label: "Collect",
    paramPath: "/sparkdream/collect/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.collect.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      // Limits & sizes
      { group: "Limits", key: "maxCollectionsBase", apiKey: "max_collections_base", label: "Max Collections (base)", kind: "number" },
      { group: "Limits", key: "maxCollectionsPerTrustLevel", apiKey: "max_collections_per_trust_level", label: "Max Collections / Trust Level", kind: "number" },
      { group: "Limits", key: "maxItemsPerCollection", apiKey: "max_items_per_collection", label: "Max Items / Collection", kind: "number" },
      { group: "Limits", key: "maxTitleLength", apiKey: "max_title_length", label: "Max Title Length", kind: "number" },
      { group: "Limits", key: "maxNameLength", apiKey: "max_name_length", label: "Max Name Length", kind: "number" },
      { group: "Limits", key: "maxDescriptionLength", apiKey: "max_description_length", label: "Max Description Length", kind: "number" },
      { group: "Limits", key: "maxTagLength", apiKey: "max_tag_length", label: "Max Tag Length", kind: "number" },
      { group: "Limits", key: "maxTagsPerCollection", apiKey: "max_tags_per_collection", label: "Max Tags / Collection", kind: "number" },
      { group: "Limits", key: "maxAttributesPerItem", apiKey: "max_attributes_per_item", label: "Max Attributes / Item", kind: "number" },
      { group: "Limits", key: "maxAttributeKeyLength", apiKey: "max_attribute_key_length", label: "Max Attribute Key Length", kind: "number" },
      { group: "Limits", key: "maxAttributeValueLength", apiKey: "max_attribute_value_length", label: "Max Attribute Value Length", kind: "number" },
      { group: "Limits", key: "maxReferenceFieldLength", apiKey: "max_reference_field_length", label: "Max Reference Field Length", kind: "number" },
      { group: "Limits", key: "maxEncryptedDataSize", apiKey: "max_encrypted_data_size", label: "Max Encrypted Data Size", kind: "number" },
      { group: "Limits", key: "maxCollaboratorsPerCollection", apiKey: "max_collaborators_per_collection", label: "Max Collaborators / Collection", kind: "number" },
      { group: "Limits", key: "maxBatchSize", apiKey: "max_batch_size", label: "Max Batch Size", kind: "number" },
      { group: "Limits", key: "maxTtlBlocks", apiKey: "max_ttl_blocks", label: "Max TTL (blocks)", kind: "bigint" },
      { group: "Limits", key: "maxNonMemberTtlBlocks", apiKey: "max_non_member_ttl_blocks", label: "Max Non-Member TTL (blocks)", kind: "bigint" },

      // Deposits & fees
      { group: "Deposits & Fees", key: "baseCollectionDeposit", apiKey: "base_collection_deposit", label: "Base Collection Deposit", kind: "amount" },
      { group: "Deposits & Fees", key: "perItemDeposit", apiKey: "per_item_deposit", label: "Per-Item Deposit", kind: "amount" },
      { group: "Deposits & Fees", key: "perItemSpamTax", apiKey: "per_item_spam_tax", label: "Per-Item Spam Tax", kind: "amount" },

      // Sponsorship
      { group: "Sponsorship", key: "sponsorFee", apiKey: "sponsor_fee", label: "Sponsor Fee", kind: "amount" },
      { group: "Sponsorship", key: "minSponsorTrustLevel", apiKey: "min_sponsor_trust_level", label: "Min Sponsor Trust Level", kind: "string" },
      { group: "Sponsorship", key: "sponsorshipRequestTtlBlocks", apiKey: "sponsorship_request_ttl_blocks", label: "Sponsorship Request TTL (blocks)", kind: "bigint" },

      // Curators
      { group: "Curators", key: "minCuratorBond", apiKey: "min_curator_bond", label: "Min Curator Bond", kind: "dream" },
      { group: "Curators", key: "minCuratorTrustLevel", apiKey: "min_curator_trust_level", label: "Min Curator Trust Level", kind: "string" },
      { group: "Curators", key: "minCuratorAgeBlocks", apiKey: "min_curator_age_blocks", label: "Min Curator Age (blocks)", kind: "bigint" },
      { group: "Curators", key: "curatorSlashFraction", apiKey: "curator_slash_fraction", label: "Curator Slash Fraction", kind: "dec" },
      { group: "Curators", key: "curatorDemotionCooldown", apiKey: "curator_demotion_cooldown", label: "Curator Demotion Cooldown (blocks)", kind: "bigint" },
      { group: "Curators", key: "curatorDemotionThreshold", apiKey: "curator_demotion_threshold", label: "Curator Demotion Threshold", kind: "dream" },
      { group: "Curators", key: "curatorOverturnDemotionStreak", apiKey: "curator_overturn_demotion_streak", label: "Curator Overturn Demotion Streak", kind: "bigint" },
      { group: "Curators", key: "curatorUnbondCooldown", apiKey: "curator_unbond_cooldown", label: "Curator Unbond Cooldown (blocks)", kind: "bigint" },

      // Reviews
      { group: "Reviews", key: "maxTagsPerReview", apiKey: "max_tags_per_review", label: "Max Tags / Review", kind: "number" },
      { group: "Reviews", key: "maxReviewCommentLength", apiKey: "max_review_comment_length", label: "Max Review Comment Length", kind: "number" },
      { group: "Reviews", key: "maxReviewsPerCollection", apiKey: "max_reviews_per_collection", label: "Max Reviews / Collection", kind: "number" },

      // Challenges
      { group: "Challenges", key: "challengeWindowBlocks", apiKey: "challenge_window_blocks", label: "Challenge Window (blocks)", kind: "bigint" },
      { group: "Challenges", key: "challengeDeposit", apiKey: "challenge_deposit", label: "Challenge Deposit", kind: "dream" },
      { group: "Challenges", key: "maxChallengeReasonLength", apiKey: "max_challenge_reason_length", label: "Max Challenge Reason Length", kind: "number" },
      { group: "Challenges", key: "maxPrunePerBlock", apiKey: "max_prune_per_block", label: "Max Prune Per Block", kind: "number" },
      { group: "Challenges", key: "challengeRewardFraction", apiKey: "challenge_reward_fraction", label: "Challenge Reward Fraction", kind: "dec" },

      // Voting & flags
      { group: "Voting & Flags", key: "downvoteCost", apiKey: "downvote_cost", label: "Downvote Cost", kind: "amount" },
      { group: "Voting & Flags", key: "maxUpvotesPerDay", apiKey: "max_upvotes_per_day", label: "Max Upvotes / Day", kind: "number" },
      { group: "Voting & Flags", key: "maxDownvotesPerDay", apiKey: "max_downvotes_per_day", label: "Max Downvotes / Day", kind: "number" },
      { group: "Voting & Flags", key: "flagReviewThreshold", apiKey: "flag_review_threshold", label: "Flag Review Threshold", kind: "number" },
      { group: "Voting & Flags", key: "maxFlagsPerDay", apiKey: "max_flags_per_day", label: "Max Flags / Day", kind: "number" },
      { group: "Voting & Flags", key: "maxFlaggersPerTarget", apiKey: "max_flaggers_per_target", label: "Max Flaggers / Target", kind: "number" },
      { group: "Voting & Flags", key: "flagExpirationBlocks", apiKey: "flag_expiration_blocks", label: "Flag Expiration (blocks)", kind: "bigint" },
      { group: "Voting & Flags", key: "maxFlagReasonLength", apiKey: "max_flag_reason_length", label: "Max Flag Reason Length", kind: "number" },

      // Sentinel & hiding
      { group: "Sentinel & Hiding", key: "sentinelCommitAmount", apiKey: "sentinel_commit_amount", label: "Sentinel Commit Amount", kind: "dream", hint: "Bonded DREAM reserved to commit a hide" },
      { group: "Sentinel & Hiding", key: "hideExpiryBlocks", apiKey: "hide_expiry_blocks", label: "Hide Expiry (blocks)", kind: "bigint" },

      // Appeals
      { group: "Appeals", key: "appealFee", apiKey: "appeal_fee", label: "Appeal Fee", kind: "amount" },
      { group: "Appeals", key: "appealCooldownBlocks", apiKey: "appeal_cooldown_blocks", label: "Appeal Cooldown (blocks)", kind: "bigint" },
      { group: "Appeals", key: "appealDeadlineBlocks", apiKey: "appeal_deadline_blocks", label: "Appeal Deadline (blocks)", kind: "bigint" },

      // Endorsements
      { group: "Endorsements", key: "endorsementCreationFee", apiKey: "endorsement_creation_fee", label: "Endorsement Creation Fee", kind: "amount" },
      { group: "Endorsements", key: "endorsementDreamStake", apiKey: "endorsement_dream_stake", label: "Endorsement Stake", kind: "dream" },
      { group: "Endorsements", key: "endorsementStakeDuration", apiKey: "endorsement_stake_duration", label: "Endorsement Stake Duration (blocks)", kind: "bigint" },
      { group: "Endorsements", key: "endorsementExpiryBlocks", apiKey: "endorsement_expiry_blocks", label: "Endorsement Expiry (blocks)", kind: "bigint" },
      { group: "Endorsements", key: "endorsementFeeEndorserShare", apiKey: "endorsement_fee_endorser_share", label: "Endorsement Fee Endorser Share", kind: "dec" },
      { group: "Endorsements", key: "endorsementDeletionBurnFraction", apiKey: "endorsement_deletion_burn_fraction", label: "Endorsement Deletion Burn Fraction", kind: "dec" },

      // Conviction & pinning
      { group: "Conviction & Pinning", key: "convictionRenewalThreshold", apiKey: "conviction_renewal_threshold", label: "Conviction Renewal Threshold", kind: "dec" },
      { group: "Conviction & Pinning", key: "convictionRenewalPeriod", apiKey: "conviction_renewal_period", label: "Conviction Renewal Period (blocks)", kind: "bigint" },
      { group: "Conviction & Pinning", key: "pinMinTrustLevel", apiKey: "pin_min_trust_level", label: "Pin Min Trust Level", kind: "number" },
      { group: "Conviction & Pinning", key: "maxPinsPerDay", apiKey: "max_pins_per_day", label: "Max Pins / Day", kind: "number" },
      { group: "Conviction & Pinning", key: "makePermanentMinTrustLevel", apiKey: "make_permanent_min_trust_level", label: "Make Permanent Min Trust Level", kind: "number" },
      { group: "Conviction & Pinning", key: "maxMakePermanentPerDay", apiKey: "max_make_permanent_per_day", label: "Max Make Permanent / Day", kind: "number" },
      { group: "Conviction & Pinning", key: "maxPromotionsPerBlock", apiKey: "max_promotions_per_block", label: "Max Promotions Per Block", kind: "number" },

      // Non-member collaboration
      { group: "Non-Member Collaboration", key: "nonMemberCollabDreamStake", apiKey: "non_member_collab_dream_stake", label: "Non-Member Collab Stake", kind: "dream" },
      { group: "Non-Member Collaboration", key: "nonMemberCollabBurnFraction", apiKey: "non_member_collab_burn_fraction", label: "Non-Member Collab Burn Fraction", kind: "dec" },
      { group: "Non-Member Collaboration", key: "maxNonMemberCollaboratorsPerCollection", apiKey: "max_non_member_collaborators_per_collection", label: "Max Non-Member Collaborators / Collection", kind: "number" },

      // Reputation penalties
      { group: "Reputation Penalties", key: "endorserRepPenalty", apiKey: "endorser_rep_penalty", label: "Endorser Rep Penalty", kind: "dec" },
      { group: "Reputation Penalties", key: "collabInviterRepPenalty", apiKey: "collab_inviter_rep_penalty", label: "Collab Inviter Rep Penalty", kind: "dec" },
      { group: "Reputation Penalties", key: "authorRepPenalty", apiKey: "author_rep_penalty", label: "Author Rep Penalty", kind: "dec" },
    ],
  },
  season: {
    label: "Season",
    paramPath: "/sparkdream/season/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.season.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/season/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/season/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      // Time
      { group: "Time", key: "epochBlocks", apiKey: "epoch_blocks", label: "Epoch (blocks)", kind: "bigint" },
      { group: "Time", key: "seasonDurationEpochs", apiKey: "season_duration_epochs", label: "Season Duration (epochs)", kind: "bigint" },
      { group: "Time", key: "seasonTransitionEpochs", apiKey: "season_transition_epochs", label: "Season Transition (epochs)", kind: "bigint" },
      { group: "Time", key: "maxTransitionEpochs", apiKey: "max_transition_epochs", label: "Max Transition (epochs)", kind: "bigint" },
      { group: "Time", key: "transitionBatchSize", apiKey: "transition_batch_size", label: "Transition Batch Size", kind: "number" },
      { group: "Time", key: "transitionGracePeriod", apiKey: "transition_grace_period", label: "Transition Grace Period", kind: "number" },
      { group: "Time", key: "transitionMaxRetries", apiKey: "transition_max_retries", label: "Transition Max Retries", kind: "number" },
      { group: "Time", key: "maxSeasonExtensions", apiKey: "max_season_extensions", label: "Max Season Extensions", kind: "number" },
      { group: "Time", key: "maxExtensionEpochs", apiKey: "max_extension_epochs", label: "Max Extension (epochs)", kind: "bigint" },

      // XP
      { group: "XP", key: "xpVoteCast", apiKey: "xp_vote_cast", label: "XP: Vote Cast", kind: "bigint" },
      { group: "XP", key: "xpProposalCreated", apiKey: "xp_proposal_created", label: "XP: Proposal Created", kind: "bigint" },
      { group: "XP", key: "xpForumReplyReceived", apiKey: "xp_forum_reply_received", label: "XP: Forum Reply Received", kind: "bigint" },
      { group: "XP", key: "xpForumMarkedHelpful", apiKey: "xp_forum_marked_helpful", label: "XP: Forum Marked Helpful", kind: "bigint" },
      { group: "XP", key: "xpInviteeFirstInitiative", apiKey: "xp_invitee_first_initiative", label: "XP: Invitee First Initiative", kind: "bigint" },
      { group: "XP", key: "xpInviteeEstablished", apiKey: "xp_invitee_established", label: "XP: Invitee ESTABLISHED", kind: "bigint" },
      { group: "XP", key: "maxVoteXpPerEpoch", apiKey: "max_vote_xp_per_epoch", label: "Max Vote XP / Epoch", kind: "number" },
      { group: "XP", key: "maxForumXpPerEpoch", apiKey: "max_forum_xp_per_epoch", label: "Max Forum XP / Epoch", kind: "bigint" },
      { group: "XP", key: "maxXpPerEpoch", apiKey: "max_xp_per_epoch", label: "Max Total XP / Epoch", kind: "bigint" },
      { group: "XP", key: "baselineReputation", apiKey: "baseline_reputation", label: "Baseline Reputation", kind: "dec" },

      // Forum XP anti-gaming
      { group: "Forum XP Anti-Gaming", key: "forumXpMinAccountAgeEpochs", apiKey: "forum_xp_min_account_age_epochs", label: "Forum XP Min Account Age (epochs)", kind: "bigint" },
      { group: "Forum XP Anti-Gaming", key: "forumXpReciprocalCooldownEpochs", apiKey: "forum_xp_reciprocal_cooldown_epochs", label: "Forum XP Reciprocal Cooldown (epochs)", kind: "bigint" },
      { group: "Forum XP Anti-Gaming", key: "forumXpSelfReplyCooldownEpochs", apiKey: "forum_xp_self_reply_cooldown_epochs", label: "Forum XP Self-Reply Cooldown (epochs)", kind: "bigint" },
      { group: "Forum XP Anti-Gaming", key: "forumCooldownRetentionEpochs", apiKey: "forum_cooldown_retention_epochs", label: "Forum Cooldown Retention (epochs)", kind: "number" },

      // Guilds
      { group: "Guilds", key: "minGuildMembers", apiKey: "min_guild_members", label: "Min Guild Members", kind: "number" },
      { group: "Guilds", key: "maxGuildMembers", apiKey: "max_guild_members", label: "Max Guild Members", kind: "number" },
      { group: "Guilds", key: "maxGuildOfficers", apiKey: "max_guild_officers", label: "Max Guild Officers", kind: "number" },
      { group: "Guilds", key: "guildCreationCost", apiKey: "guild_creation_cost", label: "Guild Creation Cost", kind: "dream" },
      { group: "Guilds", key: "guildHopCooldownEpochs", apiKey: "guild_hop_cooldown_epochs", label: "Guild Hop Cooldown (epochs)", kind: "bigint" },
      { group: "Guilds", key: "maxGuildsPerSeason", apiKey: "max_guilds_per_season", label: "Max Guilds / Season", kind: "number" },
      { group: "Guilds", key: "minGuildAgeEpochs", apiKey: "min_guild_age_epochs", label: "Min Guild Age (epochs)", kind: "bigint" },
      { group: "Guilds", key: "maxPendingInvites", apiKey: "max_pending_invites", label: "Max Pending Invites", kind: "number" },
      { group: "Guilds", key: "guildDescriptionMaxLength", apiKey: "guild_description_max_length", label: "Guild Description Max Length", kind: "number" },
      { group: "Guilds", key: "guildInviteTtlEpochs", apiKey: "guild_invite_ttl_epochs", label: "Guild Invite TTL (epochs)", kind: "bigint" },

      // Display names & usernames
      { group: "Names", key: "displayNameMinLength", apiKey: "display_name_min_length", label: "Display Name Min Length", kind: "number" },
      { group: "Names", key: "displayNameMaxLength", apiKey: "display_name_max_length", label: "Display Name Max Length", kind: "number" },
      { group: "Names", key: "displayNameChangeCooldownEpochs", apiKey: "display_name_change_cooldown_epochs", label: "Display Name Change Cooldown (epochs)", kind: "bigint" },
      { group: "Names", key: "usernameMinLength", apiKey: "username_min_length", label: "Username Min Length", kind: "number" },
      { group: "Names", key: "usernameMaxLength", apiKey: "username_max_length", label: "Username Max Length", kind: "number" },
      { group: "Names", key: "usernameChangeCooldownEpochs", apiKey: "username_change_cooldown_epochs", label: "Username Change Cooldown (epochs)", kind: "bigint" },
      { group: "Names", key: "usernameCostDream", apiKey: "username_cost_dream", label: "Username Cost", kind: "dream" },
      { group: "Names", key: "displayNameReportStakeDream", apiKey: "display_name_report_stake_dream", label: "Display Name Report Stake", kind: "dream" },
      { group: "Names", key: "displayNameAppealStakeDream", apiKey: "display_name_appeal_stake_dream", label: "Display Name Appeal Stake", kind: "dream" },
      { group: "Names", key: "displayNameAppealPeriodBlocks", apiKey: "display_name_appeal_period_blocks", label: "Display Name Appeal Period (blocks)", kind: "bigint" },

      // Quests
      { group: "Quests", key: "maxActiveQuestsPerMember", apiKey: "max_active_quests_per_member", label: "Max Active Quests / Member", kind: "number" },
      { group: "Quests", key: "maxQuestObjectives", apiKey: "max_quest_objectives", label: "Max Quest Objectives", kind: "number" },
      { group: "Quests", key: "maxQuestXpReward", apiKey: "max_quest_xp_reward", label: "Max Quest XP Reward", kind: "bigint" },
      { group: "Quests", key: "maxObjectiveDescriptionLength", apiKey: "max_objective_description_length", label: "Max Objective Description Length", kind: "number" },

      // Titles
      { group: "Titles", key: "maxDisplayableTitles", apiKey: "max_displayable_titles", label: "Max Displayable Titles", kind: "number" },
      { group: "Titles", key: "maxArchivedTitles", apiKey: "max_archived_titles", label: "Max Archived Titles", kind: "number" },

      // Nominations & retro rewards
      { group: "Nominations & Retro Rewards", key: "nominationWindowEpochs", apiKey: "nomination_window_epochs", label: "Nomination Window (epochs)", kind: "bigint" },
      { group: "Nominations & Retro Rewards", key: "maxNominationsPerMember", apiKey: "max_nominations_per_member", label: "Max Nominations / Member", kind: "bigint" },
      { group: "Nominations & Retro Rewards", key: "nominationConvictionHalfLifeEpochs", apiKey: "nomination_conviction_half_life_epochs", label: "Nomination Conviction Half-Life (epochs)", kind: "bigint" },
      { group: "Nominations & Retro Rewards", key: "nominationRationaleMaxLength", apiKey: "nomination_rationale_max_length", label: "Nomination Rationale Max Length", kind: "number" },
      { group: "Nominations & Retro Rewards", key: "nominationMinTrustLevel", apiKey: "nomination_min_trust_level", label: "Nomination Min Trust Level", kind: "number" },
      { group: "Nominations & Retro Rewards", key: "nominationStakeMinTrustLevel", apiKey: "nomination_stake_min_trust_level", label: "Nomination Stake Min Trust Level", kind: "number" },
      { group: "Nominations & Retro Rewards", key: "nominationMinStake", apiKey: "nomination_min_stake", label: "Nomination Min Stake", kind: "dec" },
      { group: "Nominations & Retro Rewards", key: "retroRewardMaxRecipients", apiKey: "retro_reward_max_recipients", label: "Retro Reward Max Recipients", kind: "bigint" },
      { group: "Nominations & Retro Rewards", key: "retroRewardMinConviction", apiKey: "retro_reward_min_conviction", label: "Retro Reward Min Conviction", kind: "dec" },
      { group: "Nominations & Retro Rewards", key: "retroRewardBudgetRatio", apiKey: "retro_reward_budget_ratio", label: "Retro Reward Budget Ratio", kind: "dec" },
      { group: "Nominations & Retro Rewards", key: "retroRewardBudgetMin", apiKey: "retro_reward_budget_min", label: "Retro Reward Budget Min", kind: "dream" },
      { group: "Nominations & Retro Rewards", key: "retroRewardBudgetMax", apiKey: "retro_reward_budget_max", label: "Retro Reward Budget Max", kind: "dream" },

      // Retention
      { group: "Retention", key: "snapshotRetentionSeasons", apiKey: "snapshot_retention_seasons", label: "Snapshot Retention (seasons)", kind: "number" },
      { group: "Retention", key: "epochTrackerRetentionEpochs", apiKey: "epoch_tracker_retention_epochs", label: "Epoch Tracker Retention (epochs)", kind: "number" },
      { group: "Retention", key: "voteXpRecordRetentionSeasons", apiKey: "vote_xp_record_retention_seasons", label: "Vote XP Record Retention (seasons)", kind: "number" },

      // Invite cleanup
      { group: "Invite Cleanup", key: "inviteCleanupIntervalBlocks", apiKey: "invite_cleanup_interval_blocks", label: "Invite Cleanup Interval (blocks)", kind: "number" },
      { group: "Invite Cleanup", key: "inviteCleanupBatchSize", apiKey: "invite_cleanup_batch_size", label: "Invite Cleanup Batch Size", kind: "number" },
    ],
  },
  shield: {
    label: "Shield",
    paramPath: "/sparkdream/shield/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.shield.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/shield/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/shield/v1/params");
      return { MsgUpdateParams, Params };
    },
    fields: [
      { key: "enabled", apiKey: "enabled", label: "Enabled", kind: "boolean" },
      { key: "maxFundingPerDay", apiKey: "max_funding_per_day", label: "Max Funding / Day", kind: "int" },
      { key: "minGasReserve", apiKey: "min_gas_reserve", label: "Min Gas Reserve", kind: "int" },
      { key: "maxGasPerExec", apiKey: "max_gas_per_exec", label: "Max Gas Per Exec", kind: "bigint" },
      { key: "maxExecsPerIdentityPerEpoch", apiKey: "max_execs_per_identity_per_epoch", label: "Max Execs / Identity / Epoch", kind: "bigint" },
      { key: "encryptedBatchEnabled", apiKey: "encrypted_batch_enabled", label: "Encrypted Batch Enabled", kind: "boolean" },
      { key: "shieldEpochInterval", apiKey: "shield_epoch_interval", label: "Shield Epoch Interval (blocks)", kind: "bigint" },
      { key: "minBatchSize", apiKey: "min_batch_size", label: "Min Batch Size", kind: "number" },
      { key: "maxPendingEpochs", apiKey: "max_pending_epochs", label: "Max Pending Epochs", kind: "number" },
      { key: "maxPendingQueueSize", apiKey: "max_pending_queue_size", label: "Max Pending Queue Size", kind: "number" },
      { key: "maxEncryptedPayloadSize", apiKey: "max_encrypted_payload_size", label: "Max Encrypted Payload Size", kind: "number" },
      { key: "maxOpsPerBatch", apiKey: "max_ops_per_batch", label: "Max Ops Per Batch", kind: "number" },
      { key: "tleMissWindow", apiKey: "tle_miss_window", label: "TLE Miss Window", kind: "bigint" },
      { key: "tleMissTolerance", apiKey: "tle_miss_tolerance", label: "TLE Miss Tolerance", kind: "bigint" },
      { key: "tleJailDuration", apiKey: "tle_jail_duration", label: "TLE Jail Duration (blocks)", kind: "bigint" },
      { key: "minTleValidators", apiKey: "min_tle_validators", label: "Min TLE Validators", kind: "number" },
      { key: "dkgWindowBlocks", apiKey: "dkg_window_blocks", label: "DKG Window (blocks)", kind: "bigint" },
      { key: "maxValidatorSetDrift", apiKey: "max_validator_set_drift", label: "Max Validator Set Drift", kind: "number" },
    ],
  },
  rep: {
    label: "Rep",
    paramPath: "/sparkdream/rep/v1/params",
    responseKey: "params",
    typeUrl: "/sparkdream.rep.v1.MsgUpdateParams",
    generic: async () => {
      const { MsgUpdateParams } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx");
      const { Params } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/params");
      return { MsgUpdateParams, Params };
    },
    // ~90 params total. The generic path round-trips unedited fields from
    // the LCD response unchanged (including the 4 TierConfig sub-messages
    // and the TrustLevelConfig), so any subset of fields here is safe. We
    // expose the full tunable surface and group by the comment sections
    // from x/rep/types/params.proto so the form stays scannable.
    //
    // DREAM amounts (math.Int) and reputation/share/rate values
    // (math.LegacyDec) are wire-strings — `kind: "int"` / `kind: "dec"` —
    // so the encoder passes them through without any micro-denom math.
    // DREAM in x/rep is whole-token, not micro-DREAM.
    fields: [
      // Time
      { group: "Time", key: "epochBlocks", apiKey: "epoch_blocks", label: "Epoch (blocks)", kind: "bigint" },
      { group: "Time", key: "seasonDurationEpochs", apiKey: "season_duration_epochs", label: "Season Duration (epochs)", kind: "bigint" },

      // DREAM economics
      { group: "DREAM Economics", key: "unstakedDecayRate", apiKey: "unstaked_decay_rate", label: "Unstaked Decay Rate (per epoch)", kind: "dec", hint: "0.002 ≈ 0.2% per epoch (~73% annualized)" },
      { group: "DREAM Economics", key: "transferTaxRate", apiKey: "transfer_tax_rate", label: "Transfer Tax Rate", kind: "dec" },
      { group: "DREAM Economics", key: "maxTipAmount", apiKey: "max_tip_amount", label: "Max Tip Amount", kind: "dream" },
      { group: "DREAM Economics", key: "maxTipsPerEpoch", apiKey: "max_tips_per_epoch", label: "Max Tips Per Epoch", kind: "number" },
      { group: "DREAM Economics", key: "maxGiftAmount", apiKey: "max_gift_amount", label: "Max Gift Amount", kind: "dream" },
      { group: "DREAM Economics", key: "giftOnlyToInvitees", apiKey: "gift_only_to_invitees", label: "Gift Only To Invitees", kind: "boolean" },

      // Initiative rewards
      { group: "Initiative Rewards", key: "completerShare", apiKey: "completer_share", label: "Completer Share", kind: "dec" },
      { group: "Initiative Rewards", key: "treasuryShare", apiKey: "treasury_share", label: "Treasury Share", kind: "dec" },
      { group: "Initiative Rewards", key: "minReputationMultiplier", apiKey: "min_reputation_multiplier", label: "Min Reputation Multiplier", kind: "dec" },

      // Initiative tiers — TierConfig nested messages reached via dot-path.
      { group: "Apprentice Tier", key: "apprenticeTier.maxBudget", apiKey: "apprentice_tier.max_budget", label: "Max Budget", kind: "dream" },
      { group: "Apprentice Tier", key: "apprenticeTier.minReputation", apiKey: "apprentice_tier.min_reputation", label: "Min Reputation", kind: "dec" },
      { group: "Apprentice Tier", key: "apprenticeTier.reputationCap", apiKey: "apprentice_tier.reputation_cap", label: "Reputation Cap", kind: "dec" },
      { group: "Apprentice Tier", key: "apprenticeTier.rewardMultiplier", apiKey: "apprentice_tier.reward_multiplier", label: "Reward Multiplier", kind: "dec" },

      { group: "Standard Tier", key: "standardTier.maxBudget", apiKey: "standard_tier.max_budget", label: "Max Budget", kind: "dream" },
      { group: "Standard Tier", key: "standardTier.minReputation", apiKey: "standard_tier.min_reputation", label: "Min Reputation", kind: "dec" },
      { group: "Standard Tier", key: "standardTier.reputationCap", apiKey: "standard_tier.reputation_cap", label: "Reputation Cap", kind: "dec" },
      { group: "Standard Tier", key: "standardTier.rewardMultiplier", apiKey: "standard_tier.reward_multiplier", label: "Reward Multiplier", kind: "dec" },

      { group: "Expert Tier", key: "expertTier.maxBudget", apiKey: "expert_tier.max_budget", label: "Max Budget", kind: "dream" },
      { group: "Expert Tier", key: "expertTier.minReputation", apiKey: "expert_tier.min_reputation", label: "Min Reputation", kind: "dec" },
      { group: "Expert Tier", key: "expertTier.reputationCap", apiKey: "expert_tier.reputation_cap", label: "Reputation Cap", kind: "dec" },
      { group: "Expert Tier", key: "expertTier.rewardMultiplier", apiKey: "expert_tier.reward_multiplier", label: "Reward Multiplier", kind: "dec" },

      { group: "Epic Tier", key: "epicTier.maxBudget", apiKey: "epic_tier.max_budget", label: "Max Budget", kind: "dream" },
      { group: "Epic Tier", key: "epicTier.minReputation", apiKey: "epic_tier.min_reputation", label: "Min Reputation", kind: "dec" },
      { group: "Epic Tier", key: "epicTier.reputationCap", apiKey: "epic_tier.reputation_cap", label: "Reputation Cap", kind: "dec" },
      { group: "Epic Tier", key: "epicTier.rewardMultiplier", apiKey: "epic_tier.reward_multiplier", label: "Reward Multiplier", kind: "dec" },

      // Conviction
      { group: "Conviction", key: "convictionHalfLifeEpochs", apiKey: "conviction_half_life_epochs", label: "Conviction Half-Life (epochs)", kind: "bigint" },
      { group: "Conviction", key: "externalConvictionRatio", apiKey: "external_conviction_ratio", label: "External Conviction Ratio", kind: "dec" },
      { group: "Conviction", key: "convictionPerDream", apiKey: "conviction_per_dream", label: "Conviction Per DREAM", kind: "dec" },

      // Review periods
      { group: "Review Periods", key: "defaultReviewPeriodEpochs", apiKey: "default_review_period_epochs", label: "Default Review Period (epochs)", kind: "bigint" },
      { group: "Review Periods", key: "defaultChallengePeriodEpochs", apiKey: "default_challenge_period_epochs", label: "Default Challenge Period (epochs)", kind: "bigint" },

      // Invitations
      { group: "Invitations", key: "minInvitationStake", apiKey: "min_invitation_stake", label: "Min Invitation Stake", kind: "dream" },
      { group: "Invitations", key: "invitationAccountabilityEpochs", apiKey: "invitation_accountability_epochs", label: "Invitation Accountability (epochs)", kind: "bigint" },
      { group: "Invitations", key: "referralRewardRate", apiKey: "referral_reward_rate", label: "Referral Reward Rate", kind: "dec" },
      { group: "Invitations", key: "invitationCostMultiplier", apiKey: "invitation_cost_multiplier", label: "Invitation Cost Multiplier", kind: "dec" },
      { group: "Invitations", key: "invitationStakeBurnRate", apiKey: "invitation_stake_burn_rate", label: "Invitation Stake Burn Rate", kind: "dec", hint: "Fraction burned on acceptance (e.g. 0.10)" },

      // Trust levels — TrustLevelConfig nested messages reached via dot-path.
      { group: "Trust Levels", key: "trustLevelConfig.provisionalMinRep", apiKey: "trust_level_config.provisional_min_rep", label: "PROVISIONAL Min Rep", kind: "dec" },
      { group: "Trust Levels", key: "trustLevelConfig.provisionalMinInterims", apiKey: "trust_level_config.provisional_min_interims", label: "PROVISIONAL Min Interims", kind: "number" },
      { group: "Trust Levels", key: "trustLevelConfig.establishedMinRep", apiKey: "trust_level_config.established_min_rep", label: "ESTABLISHED Min Rep", kind: "dec" },
      { group: "Trust Levels", key: "trustLevelConfig.establishedMinInterims", apiKey: "trust_level_config.established_min_interims", label: "ESTABLISHED Min Interims", kind: "number" },
      { group: "Trust Levels", key: "trustLevelConfig.trustedMinRep", apiKey: "trust_level_config.trusted_min_rep", label: "TRUSTED Min Rep", kind: "dec" },
      { group: "Trust Levels", key: "trustLevelConfig.trustedMinSeasons", apiKey: "trust_level_config.trusted_min_seasons", label: "TRUSTED Min Seasons", kind: "number" },
      { group: "Trust Levels", key: "trustLevelConfig.coreMinRep", apiKey: "trust_level_config.core_min_rep", label: "CORE Min Rep", kind: "dec" },
      { group: "Trust Levels", key: "trustLevelConfig.coreMinSeasons", apiKey: "trust_level_config.core_min_seasons", label: "CORE Min Seasons", kind: "number" },
      { group: "Trust Levels", key: "trustLevelConfig.newInvitationCredits", apiKey: "trust_level_config.new_invitation_credits", label: "NEW Invitation Credits", kind: "number", hint: "0 — NEW cannot invite" },
      { group: "Trust Levels", key: "trustLevelConfig.provisionalInvitationCredits", apiKey: "trust_level_config.provisional_invitation_credits", label: "PROVISIONAL Invitation Credits", kind: "number" },
      { group: "Trust Levels", key: "trustLevelConfig.establishedInvitationCredits", apiKey: "trust_level_config.established_invitation_credits", label: "ESTABLISHED Invitation Credits", kind: "number" },
      { group: "Trust Levels", key: "trustLevelConfig.trustedInvitationCredits", apiKey: "trust_level_config.trusted_invitation_credits", label: "TRUSTED Invitation Credits", kind: "number" },
      { group: "Trust Levels", key: "trustLevelConfig.coreInvitationCredits", apiKey: "trust_level_config.core_invitation_credits", label: "CORE Invitation Credits", kind: "number" },

      // Challenges
      { group: "Challenges", key: "minChallengeStake", apiKey: "min_challenge_stake", label: "Min Challenge Stake", kind: "dream" },
      { group: "Challenges", key: "challengerRewardRate", apiKey: "challenger_reward_rate", label: "Challenger Reward Rate", kind: "dec" },
      { group: "Challenges", key: "jurySize", apiKey: "jury_size", label: "Jury Size", kind: "number" },
      { group: "Challenges", key: "jurySuperMajority", apiKey: "jury_super_majority", label: "Jury Super Majority", kind: "dec" },
      { group: "Challenges", key: "minJurorReputation", apiKey: "min_juror_reputation", label: "Min Juror Reputation", kind: "dec" },
      { group: "Challenges", key: "challengeResponseDeadlineEpochs", apiKey: "challenge_response_deadline_epochs", label: "Challenge Response Deadline (epochs)", kind: "bigint" },

      // Interim compensation
      { group: "Interim Compensation", key: "simpleComplexityBudget", apiKey: "simple_complexity_budget", label: "Simple Complexity Budget", kind: "dream" },
      { group: "Interim Compensation", key: "standardComplexityBudget", apiKey: "standard_complexity_budget", label: "Standard Complexity Budget", kind: "dream" },
      { group: "Interim Compensation", key: "complexComplexityBudget", apiKey: "complex_complexity_budget", label: "Complex Complexity Budget", kind: "dream" },
      { group: "Interim Compensation", key: "expertComplexityBudget", apiKey: "expert_complexity_budget", label: "Expert Complexity Budget", kind: "dream" },
      { group: "Interim Compensation", key: "soloExpertBonusRate", apiKey: "solo_expert_bonus_rate", label: "Solo Expert Bonus Rate", kind: "dec" },
      { group: "Interim Compensation", key: "interimDeadlineEpochs", apiKey: "interim_deadline_epochs", label: "Interim Deadline (epochs)", kind: "bigint" },

      // Rate limits
      { group: "Rate Limits", key: "maxActiveChallengesPerCommittee", apiKey: "max_active_challenges_per_committee", label: "Max Active Challenges / Committee", kind: "number" },
      { group: "Rate Limits", key: "maxNewChallengesPerEpoch", apiKey: "max_new_challenges_per_epoch", label: "Max New Challenges / Epoch", kind: "number" },
      { group: "Rate Limits", key: "challengeQueueMaxSize", apiKey: "challenge_queue_max_size", label: "Challenge Queue Max Size", kind: "number" },
      { group: "Rate Limits", key: "maxActiveInitiativesPerMember", apiKey: "max_active_initiatives_per_member", label: "Max Active Initiatives / Member", kind: "number", hint: "0 = unbounded" },
      { group: "Rate Limits", key: "maxActiveInterimsPerMember", apiKey: "max_active_interims_per_member", label: "Max Active Interims / Member", kind: "number", hint: "0 = unbounded" },
      { group: "Rate Limits", key: "maxDreamMintPerEpoch", apiKey: "max_dream_mint_per_epoch", label: "Max DREAM Mint / Epoch", kind: "dream", hint: "0 = unbounded" },
      { group: "Rate Limits", key: "maxReputationGainPerEpoch", apiKey: "max_reputation_gain_per_epoch", label: "Max Reputation Gain / Epoch", kind: "dec" },

      // Slashing
      { group: "Slashing", key: "minorSlashPenalty", apiKey: "minor_slash_penalty", label: "Minor Slash Penalty", kind: "dec" },
      { group: "Slashing", key: "moderateSlashPenalty", apiKey: "moderate_slash_penalty", label: "Moderate Slash Penalty", kind: "dec" },
      { group: "Slashing", key: "severeSlashPenalty", apiKey: "severe_slash_penalty", label: "Severe Slash Penalty", kind: "dec" },
      { group: "Slashing", key: "zeroingSlashPenalty", apiKey: "zeroing_slash_penalty", label: "Zeroing Slash Penalty", kind: "dec" },

      // Extended staking
      { group: "Extended Staking", key: "projectCompletionBonusRate", apiKey: "project_completion_bonus_rate", label: "Project Completion Bonus Rate", kind: "dec" },
      { group: "Extended Staking", key: "memberStakeRevenueShare", apiKey: "member_stake_revenue_share", label: "Member Stake Revenue Share", kind: "dec" },
      { group: "Extended Staking", key: "tagStakeRevenueShare", apiKey: "tag_stake_revenue_share", label: "Tag Stake Revenue Share", kind: "dec" },
      { group: "Extended Staking", key: "minStakeDurationSeconds", apiKey: "min_stake_duration_seconds", label: "Min Stake Duration (seconds)", kind: "bigint" },
      { group: "Extended Staking", key: "allowSelfMemberStake", apiKey: "allow_self_member_stake", label: "Allow Self Member Stake", kind: "boolean" },
      { group: "Extended Staking", key: "maxInitiativeStakePerMember", apiKey: "max_initiative_stake_per_member", label: "Max Initiative Stake / Member", kind: "dream", hint: "Anti-whale cap on single-initiative stake" },

      // Gifts
      { group: "Gifts", key: "giftCooldownBlocks", apiKey: "gift_cooldown_blocks", label: "Gift Cooldown (blocks)", kind: "bigint" },
      { group: "Gifts", key: "maxGiftsPerSenderEpoch", apiKey: "max_gifts_per_sender_epoch", label: "Max Gifts / Sender / Epoch", kind: "dream" },

      // Content conviction staking
      { group: "Content Conviction", key: "contentConvictionHalfLifeEpochs", apiKey: "content_conviction_half_life_epochs", label: "Content Conviction Half-Life (epochs)", kind: "bigint" },
      { group: "Content Conviction", key: "maxContentStakePerMember", apiKey: "max_content_stake_per_member", label: "Max Content Stake / Member", kind: "dream" },
      { group: "Content Conviction", key: "maxAuthorBondPerContent", apiKey: "max_author_bond_per_content", label: "Max Author Bond / Content", kind: "dream" },
      { group: "Content Conviction", key: "authorBondSlashOnModeration", apiKey: "author_bond_slash_on_moderation", label: "Slash Author Bond on Moderation", kind: "boolean" },
      { group: "Content Conviction", key: "contentChallengeRewardShare", apiKey: "content_challenge_reward_share", label: "Content Challenge Reward Share", kind: "dec" },
      { group: "Content Conviction", key: "convictionPropagationRatio", apiKey: "conviction_propagation_ratio", label: "Conviction Propagation Ratio", kind: "dec" },
      { group: "Content Conviction", key: "maxConvictionSharePerMember", apiKey: "max_conviction_share_per_member", label: "Max Conviction Share / Member", kind: "dec" },

      // Tag anti-gaming
      { group: "Tags", key: "maxTagsPerInitiative", apiKey: "max_tags_per_initiative", label: "Max Tags / Initiative", kind: "number" },
      { group: "Tags", key: "tagCreationFee", apiKey: "tag_creation_fee", label: "Tag Creation Fee", kind: "dream" },

      // Reputation decay
      { group: "Reputation Decay", key: "reputationDecayRate", apiKey: "reputation_decay_rate", label: "Reputation Decay Rate (per epoch)", kind: "dec" },

      // Seasonal staking
      { group: "Seasonal Staking", key: "maxStakingRewardsPerSeason", apiKey: "max_staking_rewards_per_season", label: "Max Staking Rewards / Season", kind: "dream" },
      { group: "Seasonal Staking", key: "stakedDecayRate", apiKey: "staked_decay_rate", label: "Staked Decay Rate (per epoch)", kind: "dec" },
      { group: "Seasonal Staking", key: "newMemberDecayGraceEpochs", apiKey: "new_member_decay_grace_epochs", label: "New-Member Decay Grace (epochs)", kind: "bigint" },

      // Treasury
      { group: "Treasury", key: "maxTreasuryBalance", apiKey: "max_treasury_balance", label: "Max Treasury Balance", kind: "dream" },
      { group: "Treasury", key: "treasuryFundsInterims", apiKey: "treasury_funds_interims", label: "Treasury Funds Interims", kind: "boolean" },
      { group: "Treasury", key: "treasuryFundsRetroPgf", apiKey: "treasury_funds_retro_pgf", label: "Treasury Funds Retro PGF", kind: "boolean" },

      // Project caps
      { group: "Project Caps", key: "maxInitiativeRewardsPerSeason", apiKey: "max_initiative_rewards_per_season", label: "Max Initiative Rewards / Season", kind: "dream" },
      { group: "Project Caps", key: "largeProjectBudgetThreshold", apiKey: "large_project_budget_threshold", label: "Large Project Budget Threshold", kind: "dream", hint: "Above this, council proposal approval is required" },
      { group: "Project Caps", key: "maxProjectRequestedBudget", apiKey: "max_project_requested_budget", label: "Max Project Requested Budget", kind: "dream" },
      { group: "Project Caps", key: "maxProjectRequestedSpark", apiKey: "max_project_requested_spark", label: "Max Project Requested", kind: "amount" },
      { group: "Project Caps", key: "proposedProjectExpiryBlocks", apiKey: "proposed_project_expiry_blocks", label: "Proposed Project Expiry (blocks)", kind: "bigint" },

      // Permissionless creation
      { group: "Permissionless", key: "projectCreationFee", apiKey: "project_creation_fee", label: "Project Creation Fee", kind: "dream" },
      { group: "Permissionless", key: "initiativeCreationFeeApprentice", apiKey: "initiative_creation_fee_apprentice", label: "Initiative Creation Fee (Apprentice)", kind: "dream" },
      { group: "Permissionless", key: "initiativeCreationFeeStandard", apiKey: "initiative_creation_fee_standard", label: "Initiative Creation Fee (Standard)", kind: "dream" },
      { group: "Permissionless", key: "permissionlessMinTrustLevel", apiKey: "permissionless_min_trust_level", label: "Permissionless Min Trust Level", kind: "number", hint: "2 = ESTABLISHED" },
      { group: "Permissionless", key: "permissionlessMaxTier", apiKey: "permissionless_max_tier", label: "Permissionless Max Tier", kind: "number", hint: "1 = STANDARD" },

      // Sentinel rewards
      { group: "Sentinel Rewards", key: "maxSentinelRewardPool", apiKey: "max_sentinel_reward_pool", label: "Max Sentinel Reward Pool", kind: "amount" },
      { group: "Sentinel Rewards", key: "sentinelRewardPoolOverflowBurnRatio", apiKey: "sentinel_reward_pool_overflow_burn_ratio", label: "Sentinel Pool Overflow Burn Ratio", kind: "dec" },
      { group: "Sentinel Rewards", key: "sentinelRewardEpochBlocks", apiKey: "sentinel_reward_epoch_blocks", label: "Sentinel Reward Epoch (blocks)", kind: "bigint" },
      { group: "Sentinel Rewards", key: "minSentinelAccuracy", apiKey: "min_sentinel_accuracy", label: "Min Sentinel Accuracy", kind: "dec" },
      { group: "Sentinel Rewards", key: "minAppealsForAccuracy", apiKey: "min_appeals_for_accuracy", label: "Min Appeals For Accuracy", kind: "bigint" },
      { group: "Sentinel Rewards", key: "minEpochActivityForReward", apiKey: "min_epoch_activity_for_reward", label: "Min Epoch Activity For Reward", kind: "bigint" },
      { group: "Sentinel Rewards", key: "minAppealRate", apiKey: "min_appeal_rate", label: "Min Appeal Rate", kind: "dec" },
    ],
  },
};

// ── Component ───────────────────────────────────────────────────────

interface ParamChangeFormProps {
  onMessage: (msg: { typeUrl: string; value: Uint8Array } | null) => void;
}

export default function ParamChangeForm({ onMessage }: ParamChangeFormProps) {
  const { config } = useChainConfig();
  const [selectedModule, setSelectedModule] = useState<string>("");
  const [currentParams, setCurrentParams] = useState<Record<string, unknown> | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const moduleDef = selectedModule ? MODULES[selectedModule] : null;

  // Fetch current params when module changes
  useEffect(() => {
    if (!moduleDef) {
      setCurrentParams(null);
      setEditedValues({});
      onMessage(null);
      return;
    }

    setLoading(true);
    setFetchError(null);

    getModuleParams(moduleDef.paramPath)
      .then((res) => {
        const params = res[moduleDef.responseKey] as Record<string, unknown>;
        setCurrentParams(params || {});

        // Pre-fill edited values from current params, descending into
        // nested messages when `apiKey` is a dot-path (e.g. rep's
        // `apprentice_tier.max_budget` reaches into TierConfig).
        const initial: Record<string, string> = {};
        for (const field of moduleDef.fields) {
          initial[field.key] = displayValue(field, getByPath(params, field.apiKey));
        }
        setEditedValues(initial);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : "Failed to fetch params");
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModule]);

  // Encode the message whenever edited values change
  useEffect(() => {
    if (!moduleDef || !currentParams) {
      onMessage(null);
      return;
    }

    (async () => {
      try {
        const encoded = await encodeParamUpdate(
          selectedModule,
          moduleDef,
          currentParams,
          editedValues
        );
        onMessage(encoded);
      } catch {
        onMessage(null);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedValues, selectedModule, currentParams]);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-700/50 bg-zinc-800/20 p-4">
      <h4 className="text-sm font-medium text-zinc-300">Parameter Change</h4>

      {/* Module selector */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-400">
          Module
        </label>
        <select
          value={selectedModule}
          onChange={(e) => setSelectedModule(e.target.value)}
          className="sd-select w-full"
        >
          <option value="">Select a module...</option>
          {Object.entries(MODULES).map(([key, mod]) => (
            <option key={key} value={key}>
              {mod.label}
            </option>
          ))}
        </select>
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-400">
          {fetchError}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
          Loading current parameters...
        </div>
      )}

      {/* Parameter fields */}
      {moduleDef && currentParams && !loading && (
        <div className="space-y-2.5">
          <p className="text-xs text-zinc-500">
            Current values are pre-filled. Edit the values you want to change.
            Fields not shown here are carried forward from the chain&apos;s
            current params.
          </p>
          {/* Render fields in their source order. When a `group` heading
              changes between consecutive fields we close the current grid
              and open a new section — keeps modules like rep (~90 fields)
              scannable. Fields without a group render under no heading. */}
          {groupFields(moduleDef.fields).map((section, idx) => (
            <div key={section.group ?? `_ungrouped_${idx}`} className="space-y-1.5">
              {section.group && (
                <h5 className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {section.group}
                </h5>
              )}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <ParamField
                    key={field.key}
                    field={field}
                    value={editedValues[field.key] || ""}
                    displayDenom={config.displayDenom}
                    onChange={(val) =>
                      setEditedValues((prev) => ({ ...prev, [field.key]: val }))
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Field renderer ──────────────────────────────────────────────────

function ParamField({
  field,
  value,
  displayDenom,
  onChange,
}: {
  field: FieldDef;
  value: string;
  displayDenom: string;
  onChange: (v: string) => void;
}) {
  if (field.kind === "boolean") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-3 py-2">
        <label className="text-xs font-medium text-zinc-400">
          {field.label}
        </label>
        <button
          type="button"
          onClick={() => onChange(value === "true" ? "false" : "true")}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            value === "true" ? "bg-indigo-600" : "bg-zinc-600"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              value === "true" ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    );
  }

  const label = field.unit
    ? `${field.label} (${field.unit})`
    : field.kind === "coin" || field.kind === "coins" || field.kind === "amount"
      ? `${field.label} (${displayDenom})`
      : field.kind === "dream"
        ? `${field.label} (DREAM)`
        : field.label;

  return (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-zinc-400">
        {label}
      </label>
      <input
        type={
          field.kind === "number" || field.kind === "bigint" || field.kind === "duration"
            ? "number"
            : "text"
        }
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
      />
      {field.hint && (
        <p className="mt-0.5 text-[10px] text-zinc-600">{field.hint}</p>
      )}
    </div>
  );
}

// ── Value display helpers ───────────────────────────────────────────

function displayValue(field: FieldDef, raw: unknown): string {
  if (raw === undefined || raw === null) return "";

  if (field.kind === "duration") {
    // Duration comes as "172800s" or { seconds: "172800", nanos: 0 }
    const secs = parseDurationSeconds(raw);
    return String(Math.round(secs / (field.unitDivisor || 1)));
  }

  if (field.kind === "coins") {
    // Coin array — show first coin amount in display units
    const arr = raw as { denom: string; amount: string }[];
    if (!arr?.length) return "0";
    return String(parseInt(arr[0].amount, 10) / 1_000_000);
  }

  if (field.kind === "coin") {
    // Single coin
    const c = raw as { denom: string; amount: string };
    if (!c?.amount) return "0";
    return String(parseInt(c.amount, 10) / 1_000_000);
  }

  if (field.kind === "amount") {
    // Bare math.Int string in bond-denom micro-units (post-efcf392). Render
    // as a decimal display unit (1 SPARK = 1_000_000 micro).
    if (typeof raw !== "string" || !raw) return "0";
    return String(parseInt(raw, 10) / 1_000_000);
  }

  if (field.kind === "dream") {
    // Bare math.Int micro-DREAM string. Render as whole DREAM (1 DREAM =
    // 1_000_000 micro-DREAM).
    if (typeof raw !== "string" || !raw) return "0";
    return String(parseInt(raw, 10) / 1_000_000);
  }

  if (field.kind === "boolean") {
    return String(!!raw);
  }

  if (field.kind === "dec-bytes") {
    // Decimal bytes — displayed as decimal string from API
    return String(raw);
  }

  return String(raw);
}

function parseDurationSeconds(raw: unknown): number {
  if (typeof raw === "string") {
    // "172800s" format
    const match = raw.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) return parseFloat(match[1]);
    return parseFloat(raw) || 0;
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return Number(obj.seconds || 0);
  }
  return Number(raw) || 0;
}

// ── Encoding ────────────────────────────────────────────────────────

async function encodeParamUpdate(
  moduleKey: string,
  moduleDef: ModuleDef,
  currentParams: Record<string, unknown>,
  editedValues: Record<string, string>
): Promise<{ typeUrl: string; value: Uint8Array }> {
  const govModuleAddress = await fetchGovModuleAddress();

  // Sparkdream modules — every Params has a Telescope-generated fromAmino
  // that accepts the same snake_case JSON the LCD returns. We overlay user
  // edits onto the LCD object (so unedited fields round-trip untouched, even
  // ones we don't render in the form) and let fromAmino do the proto packing.
  if (moduleDef.generic) {
    const { MsgUpdateParams, Params } = await moduleDef.generic();
    const editedAmino = buildEditedAmino(moduleDef.fields, currentParams, editedValues);
    const params = Params.fromAmino(normalizeDurationsForAmino(editedAmino));
    return {
      typeUrl: moduleDef.typeUrl,
      value: MsgUpdateParams.encode(
        MsgUpdateParams.fromPartial({ authority: govModuleAddress, params })
      ).finish(),
    };
  }

  // Cosmos-SDK modules — cosmjs-types' Params codecs don't ship fromAmino, so
  // we still build the proto params object by hand from the camelCase edits +
  // carry-forward snake_case LCD response fields.
  switch (moduleKey) {
    case "gov": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/gov/v1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              quorum: editedValues.quorum || String(cur.quorum || ""),
              threshold: editedValues.threshold || String(cur.threshold || ""),
              vetoThreshold: editedValues.vetoThreshold || String(cur.veto_threshold || ""),
              votingPeriod: toDuration(editedValues.votingPeriod, 3600, cur.voting_period),
              maxDepositPeriod: toDuration(editedValues.maxDepositPeriod, 3600, cur.max_deposit_period),
              minDeposit: toCoins(editedValues.minDeposit, cur.min_deposit),
              minInitialDepositRatio: editedValues.minInitialDepositRatio || String(cur.min_initial_deposit_ratio || "0"),
              expeditedThreshold: editedValues.expeditedThreshold || String(cur.expedited_threshold || ""),
              expeditedVotingPeriod: toDuration(editedValues.expeditedVotingPeriod, 3600, cur.expedited_voting_period),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              expeditedMinDeposit: (cur.expedited_min_deposit as any[]) || [],
              proposalCancelRatio: String(cur.proposal_cancel_ratio || "0.5"),
              proposalCancelDest: String(cur.proposal_cancel_dest || ""),
              burnVoteQuorum: editedValues.burnVoteQuorum === "true",
              burnProposalDepositPrevote: !!(cur.burn_proposal_deposit_prevote),
              burnVoteVeto: editedValues.burnVoteVeto === "true",
              minDepositRatio: String(cur.min_deposit_ratio || "0.01"),
            },
          })
        ).finish(),
      };
    }
    case "staking": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/staking/v1beta1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              unbondingTime: toDuration(editedValues.unbondingTime, 86400, cur.unbonding_time),
              maxValidators: parseInt(editedValues.maxValidators) || Number(cur.max_validators || 100),
              maxEntries: parseInt(editedValues.maxEntries) || Number(cur.max_entries || 7),
              historicalEntries: parseInt(editedValues.historicalEntries) || Number(cur.historical_entries || 10000),
              bondDenom: editedValues.bondDenom || String(cur.bond_denom || ""),
              minCommissionRate: editedValues.minCommissionRate || String(cur.min_commission_rate || "0"),
            },
          })
        ).finish(),
      };
    }
    case "distribution": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/distribution/v1beta1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              communityTax: editedValues.communityTax || String(cur.community_tax || ""),
              baseProposerReward: String(cur.base_proposer_reward || "0"),
              bonusProposerReward: String(cur.bonus_proposer_reward || "0"),
              withdrawAddrEnabled: editedValues.withdrawAddrEnabled === "true",
            },
          })
        ).finish(),
      };
    }
    case "slashing": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/slashing/v1beta1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              signedBlocksWindow: BigInt(editedValues.signedBlocksWindow || cur.signed_blocks_window as string || "0"),
              minSignedPerWindow: toDecBytes(editedValues.minSignedPerWindow || String(cur.min_signed_per_window || "")),
              downtimeJailDuration: toDuration(editedValues.downtimeJailDuration, 60, cur.downtime_jail_duration),
              slashFractionDoubleSign: toDecBytes(editedValues.slashFractionDoubleSign || String(cur.slash_fraction_double_sign || "")),
              slashFractionDowntime: toDecBytes(editedValues.slashFractionDowntime || String(cur.slash_fraction_downtime || "")),
            },
          })
        ).finish(),
      };
    }
    case "mint": {
      const { MsgUpdateParams } = await import("cosmjs-types/cosmos/mint/v1beta1/tx");
      const cur = currentParams;
      return {
        typeUrl: moduleDef.typeUrl,
        value: MsgUpdateParams.encode(
          MsgUpdateParams.fromPartial({
            authority: govModuleAddress,
            params: {
              mintDenom: editedValues.mintDenom || String(cur.mint_denom || ""),
              inflationRateChange: editedValues.inflationRateChange || String(cur.inflation_rate_change || "0"),
              inflationMax: editedValues.inflationMax || String(cur.inflation_max || "0"),
              inflationMin: editedValues.inflationMin || String(cur.inflation_min || "0"),
              goalBonded: editedValues.goalBonded || String(cur.goal_bonded || "0"),
              blocksPerYear: BigInt(editedValues.blocksPerYear || cur.blocks_per_year as string || "0"),
            },
          })
        ).finish(),
      };
    }
    default:
      throw new Error(`Unknown module: ${moduleKey}`);
  }
}

// ── Encoding helpers ────────────────────────────────────────────────

function toDuration(
  editedValue: string | undefined,
  unitDivisor: number,
  currentRaw: unknown
): { seconds: bigint; nanos: number } | undefined {
  if (editedValue !== undefined && editedValue !== "") {
    const seconds = Math.round(parseFloat(editedValue) * unitDivisor);
    return { seconds: BigInt(seconds), nanos: 0 };
  }
  // Fall back to current
  const secs = parseDurationSeconds(currentRaw);
  return { seconds: BigInt(Math.round(secs)), nanos: 0 };
}

function toCoins(
  editedValue: string | undefined,
  currentRaw: unknown
): { denom: string; amount: string }[] {
  if (editedValue !== undefined && editedValue !== "") {
    const micro = (parseFloat(editedValue) * 1_000_000).toFixed(0);
    // Reuse denom from current
    const cur = currentRaw as { denom: string; amount: string }[] | undefined;
    const denom = cur?.[0]?.denom || "uspark";
    return [{ denom, amount: micro }];
  }
  return (currentRaw as { denom: string; amount: string }[]) || [];
}

function toDecBytes(value: string): Uint8Array {
  // Cosmos SDK stores sdk.Dec as UTF-8 encoded string bytes
  return new TextEncoder().encode(value);
}

/**
 * Overlay user edits onto the current LCD amino JSON. Unedited fields stay as
 * the LCD returned them so they round-trip cleanly through Params.fromAmino —
 * including fields the form doesn't render at all (long-tail params we'd
 * otherwise have to enumerate in every FieldDef array). When `apiKey` is a
 * dot-path, the edit descends into nested messages (rep's TierConfigs /
 * TrustLevelConfig) without disturbing sibling fields.
 */
function buildEditedAmino(
  fields: FieldDef[],
  currentParams: Record<string, unknown>,
  editedValues: Record<string, string>
): Record<string, unknown> {
  let out: Record<string, unknown> = { ...currentParams };
  for (const field of fields) {
    const v = editedValues[field.key];
    if (v === undefined || v === "") continue;
    const converted = convertEditToAmino(field, v, getByPath(currentParams, field.apiKey));
    out = setByPath(out, field.apiKey, converted);
  }
  return out;
}

/** Read a (possibly dot-pathed) value out of a nested object. Returns
 * undefined when any segment is missing — matches the existing
 * `params?.[apiKey]` lookup behavior for flat keys. */
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Immutably set a nested field, copying every object along the way so the
 * original LCD response isn't mutated and React can detect the state change. */
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const parts = path.split(".");
  if (parts.length === 1) {
    return { ...obj, [parts[0]]: value };
  }
  const [head, ...rest] = parts;
  const child = (obj[head] as Record<string, unknown>) ?? {};
  return { ...obj, [head]: setByPath(child, rest.join("."), value) };
}

/** Bucket fields into ordered sections by their `group`. Consecutive fields
 * with the same group share one bucket; ungrouped fields fall into a single
 * leading bucket with `group: undefined`. */
function groupFields(
  fields: FieldDef[]
): { group: string | undefined; fields: FieldDef[] }[] {
  const out: { group: string | undefined; fields: FieldDef[] }[] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (last && last.group === f.group) {
      last.fields.push(f);
    } else {
      out.push({ group: f.group, fields: [f] });
    }
  }
  return out;
}

function convertEditToAmino(
  field: FieldDef,
  edited: string,
  currentRaw: unknown
): unknown {
  switch (field.kind) {
    case "boolean":
      return edited === "true";
    case "number":
      return parseInt(edited, 10);
    case "bigint":
      // Amino JSON encodes int64/uint64 as strings; keep as-is.
      return edited;
    case "duration": {
      // Emit "Xs" form — normalizeDurationsForAmino below converts to the
      // nanosecond string Duration.fromAmino expects.
      const secs = Math.round(parseFloat(edited) * (field.unitDivisor || 1));
      return `${secs}s`;
    }
    case "coin": {
      const cur = currentRaw as { denom?: string } | undefined;
      const denom = cur?.denom || "uspark";
      const micro = (parseFloat(edited) * 1_000_000).toFixed(0);
      return { denom, amount: micro };
    }
    case "coins": {
      const cur = currentRaw as { denom?: string }[] | undefined;
      const denom = cur?.[0]?.denom || "uspark";
      const micro = (parseFloat(edited) * 1_000_000).toFixed(0);
      return [{ denom, amount: micro }];
    }
    case "amount": {
      // Bare math.Int string in micro-units; the chain wraps it into the
      // bond-denom Coin at use time from x/identity (post-efcf392).
      return (parseFloat(edited) * 1_000_000).toFixed(0);
    }
    case "dream": {
      // Whole DREAM input → bare math.Int micro-DREAM string (1 DREAM =
      // 1_000_000 micro-DREAM).
      return (parseFloat(edited) * 1_000_000).toFixed(0);
    }
    case "string":
    case "int":
    case "dec":
    case "dec-bytes":
    default:
      return edited;
  }
}

/**
 * Recursively rewrite protobuf Duration strings (`"172800s"`) into the
 * nanosecond strings Telescope's `Duration.fromAmino` expects (it does
 * `BigInt(object) / 1e9` per the codec, so `"172800s"` would just throw).
 * Only touches strings matching the `^\d+(?:\.\d+)?s$` shape — leaves
 * everything else (including e.g. token denoms or descriptive strings) alone.
 */
function normalizeDurationsForAmino(obj: unknown): unknown {
  if (typeof obj === "string") {
    const m = obj.match(/^(\d+(?:\.\d+)?)s$/);
    if (m) {
      const num = parseFloat(m[1]);
      return String(BigInt(Math.round(num * 1_000_000_000)));
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeDurationsForAmino);
  }
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      out[k] = normalizeDurationsForAmino((obj as Record<string, unknown>)[k]);
    }
    return out;
  }
  return obj;
}

let _govModuleAddr = "";

async function fetchGovModuleAddress(): Promise<string> {
  if (_govModuleAddr) return _govModuleAddr;
  try {
    const res = await fetch("/api/lcd/cosmos/auth/v1beta1/module_accounts/gov");
    const data = await res.json();
    _govModuleAddr = data.account?.base_account?.address || "";
    return _govModuleAddr;
  } catch {
    return "";
  }
}
