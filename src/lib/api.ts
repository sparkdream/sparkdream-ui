// REST API client for blog and commons module LCD endpoints.

import { LCD_ENDPOINT } from "./chain";
import type {
  ListPostResponse,
  ShowPostResponse,
  ShowReplyResponse,
  ListRepliesResponse,
  ReactionCountsResponse,
  UserReactionResponse,
  ListPostsByCreatorResponse,
  ListReactionsResponse,
  ListReactionsByCreatorResponse,
  ListExpiringContentResponse,
  ParamsResponse,
  PaginationRequest,
} from "@/types/blog";
import type {
  ListGroupsResponse,
  GetCouncilMembersResponse,
  GetProposalResponse,
  ListProposalsResponse,
} from "@/types/commons";
import type {
  GetSessionResponse,
  SessionsByGranterResponse,
  SessionsByGranteeResponse,
  AllowedMsgTypesResponse,
  SessionParamsResponse,
} from "@/types/session";

const BASE = LCD_ENDPOINT;

function paginationParams(p?: PaginationRequest): URLSearchParams {
  const params = new URLSearchParams();
  if (!p) return params;
  if (p.key) params.set("pagination.key", p.key);
  if (p.limit) params.set("pagination.limit", p.limit);
  if (p.countTotal) params.set("pagination.count_total", "true");
  if (p.reverse) params.set("pagination.reverse", "true");
  return params;
}

async function get<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = new URL(path, BASE);
  if (params) {
    params.forEach((v, k) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// List all posts with pagination
export async function listPosts(pagination?: PaginationRequest): Promise<ListPostResponse> {
  return get<ListPostResponse>(
    "/sparkdream/blog/v1/list_post",
    paginationParams(pagination)
  );
}

// Get a single post by ID
export async function getPost(id: string): Promise<ShowPostResponse> {
  return get<ShowPostResponse>(`/sparkdream/blog/v1/show_post/${id}`);
}

// List replies for a post
export async function listReplies(
  postId: string,
  pagination?: PaginationRequest
): Promise<ListRepliesResponse> {
  const params = paginationParams(pagination);
  return get<ListRepliesResponse>(
    `/sparkdream/blog/v1/list_replies/${postId}`,
    params
  );
}

// Get reaction counts for a post or reply
export async function getReactionCounts(
  postId: string,
  replyId: string = "0"
): Promise<ReactionCountsResponse> {
  return get<ReactionCountsResponse>(
    `/sparkdream/blog/v1/reaction_counts/${postId}/${replyId}`
  );
}

// Get the current user's reaction on a post or reply
export async function getUserReaction(
  creator: string,
  postId: string,
  replyId: string = "0"
): Promise<UserReactionResponse> {
  return get<UserReactionResponse>(
    `/sparkdream/blog/v1/user_reaction/${creator}/${postId}/${replyId}`
  );
}

// List posts by a specific creator
export async function listPostsByCreator(
  creator: string,
  pagination?: PaginationRequest
): Promise<ListPostsByCreatorResponse> {
  const params = paginationParams(pagination);
  return get<ListPostsByCreatorResponse>(
    `/sparkdream/blog/v1/list_posts_by_creator/${creator}`,
    params
  );
}

// Get a single reply by ID
export async function getReply(id: string): Promise<ShowReplyResponse> {
  return get<ShowReplyResponse>(`/sparkdream/blog/v1/show_reply/${id}`);
}

// List reactions for a post or reply
export async function listReactions(
  postId: string,
  replyId: string = "0",
  pagination?: PaginationRequest
): Promise<ListReactionsResponse> {
  const params = paginationParams(pagination);
  params.set("reply_id", replyId);
  return get<ListReactionsResponse>(
    `/sparkdream/blog/v1/list_reactions/${postId}`,
    params
  );
}

// List reactions by a specific creator
export async function listReactionsByCreator(
  creator: string,
  pagination?: PaginationRequest
): Promise<ListReactionsByCreatorResponse> {
  const params = paginationParams(pagination);
  return get<ListReactionsByCreatorResponse>(
    `/sparkdream/blog/v1/list_reactions_by_creator/${creator}`,
    params
  );
}

// List expiring ephemeral content
export async function listExpiringContent(
  expiresBefore: number,
  contentType?: string,
  pagination?: PaginationRequest
): Promise<ListExpiringContentResponse> {
  const params = paginationParams(pagination);
  params.set("expires_before", expiresBefore.toString());
  if (contentType) params.set("content_type", contentType);
  return get<ListExpiringContentResponse>(
    `/sparkdream/blog/v1/list_expiring_content`,
    params
  );
}

// Get blog module params
export async function getParams(): Promise<ParamsResponse> {
  return get<ParamsResponse>(`/sparkdream/blog/v1/params`);
}

// ── Commons module ──────────────────────────────────────────────────

// List all groups (councils)
export async function listGroups(): Promise<ListGroupsResponse> {
  return get<ListGroupsResponse>("/sparkdream/commons/v1/group");
}

// Get members of a specific council
export async function getCouncilMembers(
  councilName: string
): Promise<GetCouncilMembersResponse> {
  return get<GetCouncilMembersResponse>(
    `/sparkdream/commons/v1/council_members/${councilName}`
  );
}

// Get a specific proposal by ID
export async function getProposal(
  proposalId: string
): Promise<GetProposalResponse> {
  return get<GetProposalResponse>(
    `/sparkdream/commons/v1/proposal/${proposalId}`
  );
}

// List proposals with optional council filter
export async function listProposals(
  councilName?: string,
  pagination?: PaginationRequest
): Promise<ListProposalsResponse> {
  const params = paginationParams(pagination);
  if (councilName) params.set("council_name", councilName);
  return get<ListProposalsResponse>(
    "/sparkdream/commons/v1/proposals",
    params
  );
}

// ── Session module ──────────────────────────────────────────────────

// Get a specific session by granter/grantee pair
export async function getSession(
  granter: string,
  grantee: string
): Promise<GetSessionResponse> {
  return get<GetSessionResponse>(
    `/sparkdream/session/v1/session/${granter}/${grantee}`
  );
}

// List sessions created by a granter
export async function getSessionsByGranter(
  granter: string,
  pagination?: PaginationRequest
): Promise<SessionsByGranterResponse> {
  return get<SessionsByGranterResponse>(
    `/sparkdream/session/v1/sessions_by_granter/${granter}`,
    paginationParams(pagination)
  );
}

// List sessions granted to a grantee
export async function getSessionsByGrantee(
  grantee: string,
  pagination?: PaginationRequest
): Promise<SessionsByGranteeResponse> {
  return get<SessionsByGranteeResponse>(
    `/sparkdream/session/v1/sessions_by_grantee/${grantee}`,
    paginationParams(pagination)
  );
}

// Get allowed message types for session keys
export async function getAllowedMsgTypes(): Promise<AllowedMsgTypesResponse> {
  return get<AllowedMsgTypesResponse>(
    "/sparkdream/session/v1/allowed_msg_types"
  );
}

// Get session module params
export async function getSessionParams(): Promise<SessionParamsResponse> {
  return get<SessionParamsResponse>("/sparkdream/session/v1/params");
}

// ── Commons module ──────────────────────────────────────────────────

// Fetch all member addresses across every council and return as a Set
export async function getAllMemberAddresses(): Promise<Set<string>> {
  const { group: groups } = await listGroups();
  const results = await Promise.all(
    groups.map((g) => getCouncilMembers(g.index))
  );
  const addresses = new Set<string>();
  for (const res of results) {
    for (const m of res.members) {
      addresses.add(m.address);
    }
  }
  return addresses;
}
