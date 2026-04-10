// Blog module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface Post {
  title: string;
  body: string;
  creator: string;
  id: string;
  content_type: string;
  replies_enabled: boolean;
  reply_count: string;
  min_reply_trust_level: number;
  created_at: string;
  updated_at: string;
  status: string;
  hidden_by: string;
  hidden_at: string;
  expires_at: string;
  pinned_by: string;
  pinned_at: string;
  edited: boolean;
  edited_at: string;
  initiative_id: string;
  conviction_sustained: boolean;
}

export interface Reply {
  id: string;
  post_id: string;
  parent_reply_id: string;
  creator: string;
  body: string;
  content_type: string;
  created_at: string;
  edited: boolean;
  edited_at: string;
  depth: number;
  status: string;
  hidden_by: string;
  hidden_at: string;
  expires_at: string;
  pinned_by: string;
  pinned_at: string;
  conviction_sustained: boolean;
}

export interface Reaction {
  creator: string;
  post_id: string;
  reaction_type: string;
  reply_id: string;
}

export interface ReactionCounts {
  like_count: string;
  insightful_count: string;
  disagree_count: string;
  funny_count: string;
}

export interface Pagination {
  next_key: string | null;
  total: string;
}

export interface PaginationRequest {
  key?: string;
  limit?: string;
  countTotal?: boolean;
  reverse?: boolean;
}

// API response types
export interface ListPostResponse {
  post: Post[];
  pagination: Pagination;
}

export interface ShowPostResponse {
  post: Post;
}

export interface ShowReplyResponse {
  reply: Reply;
}

export interface ListRepliesResponse {
  replies: Reply[];
  pagination: Pagination;
}

export interface ReactionCountsResponse {
  counts: ReactionCounts;
}

export interface UserReactionResponse {
  reaction: Reaction | null;
}

export interface ListPostsByCreatorResponse {
  posts: Post[];
  pagination: Pagination;
}

export interface ListReactionsResponse {
  reactions: Reaction[];
  pagination: Pagination;
}

export interface ListReactionsByCreatorResponse {
  reactions: Reaction[];
  pagination: Pagination;
}

export interface ListExpiringContentResponse {
  posts: Post[];
  replies: Reply[];
  pagination: Pagination;
}

export interface Coin {
  denom: string;
  amount: string;
}

export interface BlogParams {
  max_title_length: string;
  max_body_length: string;
  cost_per_byte: Coin;
  cost_per_byte_exempt: boolean;
  max_reply_length: string;
  max_reply_depth: number;
  reaction_fee: Coin;
  reaction_fee_exempt: boolean;
  max_posts_per_day: number;
  max_replies_per_day: number;
  max_reactions_per_day: number;
  ephemeral_content_ttl: string;
  pin_min_trust_level: number;
  max_pins_per_day: number;
  min_ephemeral_content_ttl: string;
  max_cost_per_byte: Coin;
  max_reaction_fee: Coin;
  conviction_renewal_threshold: string;
  conviction_renewal_period: string;
}

export interface ParamsResponse {
  params: BlogParams;
}

// Post status constants
export const PostStatus = {
  ACTIVE: "POST_STATUS_ACTIVE",
  DELETED: "POST_STATUS_DELETED",
  HIDDEN: "POST_STATUS_HIDDEN",
} as const;

export const ReplyStatus = {
  ACTIVE: "REPLY_STATUS_ACTIVE",
  DELETED: "REPLY_STATUS_DELETED",
  HIDDEN: "REPLY_STATUS_HIDDEN",
} as const;

export const ReactionType = {
  LIKE: "REACTION_TYPE_LIKE",
  INSIGHTFUL: "REACTION_TYPE_INSIGHTFUL",
  DISAGREE: "REACTION_TYPE_DISAGREE",
  FUNNY: "REACTION_TYPE_FUNNY",
} as const;

export type ReactionTypeValue = typeof ReactionType[keyof typeof ReactionType];

export const ContentType = {
  UNSPECIFIED: 0,
  TEXT: 1,
  HTML: 2,
  MARKDOWN: 3,
  GZIP: 10,
  ZSTD: 11,
  IPFS: 20,
  ARWEAVE: 21,
  FILECOIN: 22,
  JACKAL: 23,
} as const;

export type ContentTypeValue = typeof ContentType[keyof typeof ContentType];

export const CONTENT_TYPE_INFO: Record<number, { label: string; description: string }> = {
  [ContentType.TEXT]: { label: "Plain Text", description: "UTF-8 plain text" },
  [ContentType.HTML]: { label: "HTML", description: "HTML content" },
  [ContentType.MARKDOWN]: { label: "Markdown", description: "Markdown content" },
};

// Map reaction type strings to display info
export const REACTION_INFO: Record<string, { emoji: string; label: string }> = {
  [ReactionType.LIKE]: { emoji: "\u{1F44D}", label: "Like" },
  [ReactionType.INSIGHTFUL]: { emoji: "\u{1F4A1}", label: "Insightful" },
  [ReactionType.DISAGREE]: { emoji: "\u{1F914}", label: "Disagree" },
  [ReactionType.FUNNY]: { emoji: "\u{1F602}", label: "Funny" },
};
