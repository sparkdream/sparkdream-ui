// Season module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export type Rarity =
  | "RARITY_UNSPECIFIED"
  | "RARITY_COMMON"
  | "RARITY_UNCOMMON"
  | "RARITY_RARE"
  | "RARITY_EPIC"
  | "RARITY_LEGENDARY"
  | "RARITY_UNIQUE";

export type RequirementType =
  | "REQUIREMENT_TYPE_UNSPECIFIED"
  | "REQUIREMENT_TYPE_INITIATIVES_COMPLETED"
  | "REQUIREMENT_TYPE_REPUTATION_EARNED"
  | "REQUIREMENT_TYPE_INVITATIONS_SUCCESSFUL"
  | "REQUIREMENT_TYPE_CHALLENGES_WON"
  | "REQUIREMENT_TYPE_JURY_DUTY"
  | "REQUIREMENT_TYPE_SEASONS_ACTIVE"
  | "REQUIREMENT_TYPE_VOTES_CAST"
  | "REQUIREMENT_TYPE_FORUM_HELPFUL"
  | "REQUIREMENT_TYPE_TOP_XP"
  | "REQUIREMENT_TYPE_MIN_LEVEL"
  | "REQUIREMENT_TYPE_ACHIEVEMENT_COUNT"
  | "REQUIREMENT_TYPE_GENESIS";

export interface Achievement {
  achievement_id: string;
  name: string;
  description: string;
  rarity: Rarity;
  xp_reward: string;
  requirement_type: RequirementType;
  requirement_threshold: string;
}

export interface Title {
  title_id: string;
  name: string;
  description: string;
  rarity: Rarity;
  requirement_type: RequirementType;
  requirement_threshold: string;
  requirement_season: string;
  seasonal: boolean;
}

export interface MemberProfile {
  address: string;
  display_name: string;
  username: string;
  display_title: string;
  season_xp: string;
  season_level: string;
  lifetime_xp: string;
  guild_id: string;
  last_display_name_change_epoch: string;
  last_username_change_epoch: string;
  challenges_won: string;
  jury_duties_completed: string;
  votes_cast: string;
  forum_helpful_count: string;
  invitations_successful: string;
  last_active_epoch: string;
  unlocked_titles: string[];
  achievements: string[];
  archived_titles: string[];
}

export interface CurrentSeasonResponse {
  number: string;
  name: string;
  theme: string;
  start_block: string;
  end_block: string;
  status: string;
}

export interface SeasonStatsResponse {
  total_xp_earned: string;
  active_members: string;
  initiatives_completed: string;
  guilds_active: string;
  quests_completed: string;
  blocks_remaining: string;
}

export interface GetMemberProfileResponse {
  member_profile: MemberProfile;
}

export interface ListAchievementsResponse {
  achievements: Achievement[];
  pagination?: { next_key?: string | null; total?: string };
}

export interface ListTitlesResponse {
  titles: Title[];
  pagination?: { next_key?: string | null; total?: string };
}

export type QuestObjectiveType =
  | "QUEST_OBJECTIVE_TYPE_UNSPECIFIED"
  | "QUEST_OBJECTIVE_TYPE_VOTES_CAST"
  | "QUEST_OBJECTIVE_TYPE_FORUM_HELPFUL"
  | "QUEST_OBJECTIVE_TYPE_INVITEE_MILESTONE"
  | "QUEST_OBJECTIVE_TYPE_INITIATIVES_COMPLETED";

export interface QuestObjective {
  description: string;
  type: QuestObjectiveType;
  target: string;
}

export interface Quest {
  quest_id: string;
  name: string;
  description: string;
  xp_reward: string;
  repeatable: boolean;
  cooldown_epochs: string;
  season: string;
  start_block: string;
  end_block: string;
  active: boolean;
  min_level: string;
  required_achievement: string;
  prerequisite_quest: string;
  quest_chain: string;
  objectives: QuestObjective[];
}

export interface MemberQuestProgress {
  member_quest: string;
  completed: boolean;
  completed_block: string;
  last_attempt_block: string;
  objective_progress: string[];
}

export interface ListQuestResponse {
  quest: Quest[];
  pagination?: { next_key?: string | null; total?: string };
}

export interface ListMemberQuestProgressResponse {
  member_quest_progress: MemberQuestProgress[];
  pagination?: { next_key?: string | null; total?: string };
}

export interface SeasonParams {
  display_name_min_length: number;
  display_name_max_length: number;
  display_name_change_cooldown_epochs: string;
  username_min_length: number;
  username_max_length: number;
  username_change_cooldown_epochs: string;
  username_cost_dream: string;
  [k: string]: unknown;
}

export interface SeasonParamsResponse {
  params: SeasonParams;
}

export type GuildStatus =
  | "GUILD_STATUS_UNSPECIFIED"
  | "GUILD_STATUS_ACTIVE"
  | "GUILD_STATUS_FROZEN"
  | "GUILD_STATUS_DISSOLVED";

export interface Guild {
  id: string;
  name: string;
  description: string;
  founder: string;
  created_block: string;
  invite_only: boolean;
  status: GuildStatus;
  officers: string[];
  pending_invites: string[];
}

export interface GuildMembership {
  member: string;
  guild_id: string;
  joined_epoch: string;
  left_epoch: string;
  guilds_joined_this_season: string;
}

export interface GuildInvite {
  guild_invitee: string;
  inviter: string;
  created_epoch: string;
  expires_epoch: string;
}

export interface ListGuildResponse {
  guild: Guild[];
  pagination?: { next_key?: string | null; total?: string };
}

export interface GetGuildResponse {
  guild: Guild;
}

export interface ListGuildMembershipResponse {
  guild_membership: GuildMembership[];
  pagination?: { next_key?: string | null; total?: string };
}

export interface GetGuildMembershipResponse {
  guild_membership: GuildMembership;
}

export interface ListGuildInviteResponse {
  guild_invite: GuildInvite[];
  pagination?: { next_key?: string | null; total?: string };
}

export interface Nomination {
  id: string;
  nominator: string;
  content_ref: string;
  rationale: string;
  created_at_block: string;
  season: string;
  total_staked: string;
  conviction: string;
  reward_amount: string;
  rewarded: boolean;
}

export interface NominationStake {
  nomination_id: string;
  staker: string;
  amount: string;
  staked_at_block: string;
}

export interface RetroRewardRecord {
  season: string;
  nomination_id: string;
  recipient: string;
  content_ref: string;
  conviction: string;
  reward_amount: string;
  distributed_at_block: string;
}

export interface ListNominationsResponse {
  nominations: Nomination[];
  pagination?: { next_key?: string | null; total?: string };
}

export interface GetNominationResponse {
  nomination: Nomination;
}

export interface ListNominationStakesResponse {
  stakes: NominationStake[];
  pagination?: { next_key?: string | null; total?: string };
}

export interface ListRetroRewardHistoryResponse {
  records: RetroRewardRecord[];
  pagination?: { next_key?: string | null; total?: string };
}
