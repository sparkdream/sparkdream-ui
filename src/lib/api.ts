// REST API client for blog and commons module LCD endpoints.

import { defaults } from "./chain";
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
  ListGovProposalsResponse,
  GetGovProposalResponse,
  ListGovVotesResponse,
  GetGovTallyResponse,
  GetGovParamsResponse,
  ListGovDepositsResponse,
} from "@/types/gov";
import type {
  GetSessionResponse,
  SessionsByGranterResponse,
  SessionsByGranteeResponse,
  AllowedMsgTypesResponse,
  SessionParamsResponse,
} from "@/types/session";
import type {
  GetMemberResponse,
  ListMemberResponse,
  MembersByTrustLevelResponse,
  GetProjectResponse,
  ListProjectResponse,
  GetInitiativeResponse,
  ListInitiativeResponse,
  InitiativesByProjectResponse,
  InitiativesByAssigneeResponse,
  AvailableInitiativesResponse,
  GetStakeResponse,
  StakesByStakerResponse,
  PendingStakeRewardsResponse,
  GetInvitationResponse,
  ListInvitationResponse,
  InvitationsByInviterResponse,
  RepParamsResponse,
} from "@/types/rep";

// In the browser, route through our Next.js proxy to avoid CORS issues.
// On the server (SSR), call the LCD endpoint directly.
const BASE =
  typeof window !== "undefined" ? "/api/lcd" : defaults.lcdEndpoint;

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
  const qs = params?.toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
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
  const params = new URLSearchParams();
  if (replyId !== "0") params.set("reply_id", replyId);
  return get<ReactionCountsResponse>(
    `/sparkdream/blog/v1/reaction_counts/${postId}`,
    params.toString() ? params : undefined
  );
}

// Get the current user's reaction on a post or reply
export async function getUserReaction(
  creator: string,
  postId: string,
  replyId: string = "0"
): Promise<UserReactionResponse> {
  const params = new URLSearchParams();
  if (replyId !== "0") params.set("reply_id", replyId);
  return get<UserReactionResponse>(
    `/sparkdream/blog/v1/user_reaction/${creator}/${postId}`,
    params.toString() ? params : undefined
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

// ── Module params (for param change proposals) ─────────────────────

// Generic param fetcher — returns the raw JSON response
export async function getModuleParams(path: string): Promise<Record<string, unknown>> {
  return get<Record<string, unknown>>(path);
}

// ── Cosmos SDK x/gov ────────────────────────────────────────────────

// List gov proposals with optional status filter
export async function listGovProposals(
  status?: string,
  pagination?: PaginationRequest
): Promise<ListGovProposalsResponse> {
  const params = paginationParams(pagination);
  if (status) params.set("proposal_status", status);
  return get<ListGovProposalsResponse>("/cosmos/gov/v1/proposals", params);
}

// Get a specific gov proposal
export async function getGovProposal(
  proposalId: string
): Promise<GetGovProposalResponse> {
  return get<GetGovProposalResponse>(`/cosmos/gov/v1/proposals/${proposalId}`);
}

// Get votes for a gov proposal
export async function getGovProposalVotes(
  proposalId: string,
  pagination?: PaginationRequest
): Promise<ListGovVotesResponse> {
  return get<ListGovVotesResponse>(
    `/cosmos/gov/v1/proposals/${proposalId}/votes`,
    paginationParams(pagination)
  );
}

// Get tally for a gov proposal
export async function getGovProposalTally(
  proposalId: string
): Promise<GetGovTallyResponse> {
  return get<GetGovTallyResponse>(
    `/cosmos/gov/v1/proposals/${proposalId}/tally`
  );
}

// Get gov module params
export async function getGovParams(): Promise<GetGovParamsResponse> {
  return get<GetGovParamsResponse>("/cosmos/gov/v1/params/tallying");
}

// Get gov deposit params
export async function getGovDepositParams(): Promise<GetGovParamsResponse> {
  return get<GetGovParamsResponse>("/cosmos/gov/v1/params/deposit");
}

// Get deposits for a gov proposal
export async function getGovProposalDeposits(
  proposalId: string,
  pagination?: PaginationRequest
): Promise<ListGovDepositsResponse> {
  return get<ListGovDepositsResponse>(
    `/cosmos/gov/v1/proposals/${proposalId}/deposits`,
    paginationParams(pagination)
  );
}

// ── Rep module ─────────────────────────────────────────────────────

export async function getRepMember(address: string): Promise<GetMemberResponse> {
  return get<GetMemberResponse>(`/sparkdream/rep/v1/member/${address}`);
}

export async function listRepMembers(
  pagination?: PaginationRequest
): Promise<ListMemberResponse> {
  return get<ListMemberResponse>("/sparkdream/rep/v1/member", paginationParams(pagination));
}

export async function membersByTrustLevel(
  trustLevel: string,
  pagination?: PaginationRequest
): Promise<MembersByTrustLevelResponse> {
  return get<MembersByTrustLevelResponse>(
    `/sparkdream/rep/v1/members_by_trust_level/${trustLevel}`,
    paginationParams(pagination)
  );
}

export async function getRepProject(id: string): Promise<GetProjectResponse> {
  return get<GetProjectResponse>(`/sparkdream/rep/v1/project/${id}`);
}

export async function listRepProjects(
  pagination?: PaginationRequest
): Promise<ListProjectResponse> {
  return get<ListProjectResponse>("/sparkdream/rep/v1/project", paginationParams(pagination));
}

export async function getRepInitiative(id: string): Promise<GetInitiativeResponse> {
  return get<GetInitiativeResponse>(`/sparkdream/rep/v1/initiative/${id}`);
}

export async function listRepInitiatives(
  pagination?: PaginationRequest
): Promise<ListInitiativeResponse> {
  return get<ListInitiativeResponse>("/sparkdream/rep/v1/initiative", paginationParams(pagination));
}

export async function initiativesByProject(
  projectId: string,
  pagination?: PaginationRequest
): Promise<InitiativesByProjectResponse> {
  return get<InitiativesByProjectResponse>(
    `/sparkdream/rep/v1/initiatives_by_project/${projectId}`,
    paginationParams(pagination)
  );
}

export async function initiativesByAssignee(
  assignee: string,
  pagination?: PaginationRequest
): Promise<InitiativesByAssigneeResponse> {
  return get<InitiativesByAssigneeResponse>(
    `/sparkdream/rep/v1/initiatives_by_assignee/${assignee}`,
    paginationParams(pagination)
  );
}

export async function availableInitiatives(
  pagination?: PaginationRequest
): Promise<AvailableInitiativesResponse> {
  return get<AvailableInitiativesResponse>(
    "/sparkdream/rep/v1/available_initiatives",
    paginationParams(pagination)
  );
}

export async function getRepStake(id: string): Promise<GetStakeResponse> {
  return get<GetStakeResponse>(`/sparkdream/rep/v1/stake/${id}`);
}

export async function stakesByStaker(
  staker: string,
  pagination?: PaginationRequest
): Promise<StakesByStakerResponse> {
  return get<StakesByStakerResponse>(
    `/sparkdream/rep/v1/stakes_by_staker/${staker}`,
    paginationParams(pagination)
  );
}

export async function pendingStakeRewards(stakeId: string): Promise<PendingStakeRewardsResponse> {
  return get<PendingStakeRewardsResponse>(
    `/sparkdream/rep/v1/stake/${stakeId}/pending_rewards`
  );
}

export async function getRepInvitation(id: string): Promise<GetInvitationResponse> {
  return get<GetInvitationResponse>(`/sparkdream/rep/v1/invitation/${id}`);
}

export async function listRepInvitations(
  pagination?: PaginationRequest
): Promise<ListInvitationResponse> {
  return get<ListInvitationResponse>("/sparkdream/rep/v1/invitation", paginationParams(pagination));
}

export async function invitationsByInviter(
  inviter: string,
  pagination?: PaginationRequest
): Promise<InvitationsByInviterResponse> {
  return get<InvitationsByInviterResponse>(
    `/sparkdream/rep/v1/invitations_by_inviter/${inviter}`,
    paginationParams(pagination)
  );
}

export async function getRepParams(): Promise<RepParamsResponse> {
  return get<RepParamsResponse>("/sparkdream/rep/v1/params");
}

/** Collect unique tags from all projects and initiatives. */
export async function collectTags(): Promise<string[]> {
  const [projects, initiatives] = await Promise.all([
    listRepProjects({ limit: "200" }).catch(() => ({ project: [], pagination: { next_key: null, total: "0" } })),
    listRepInitiatives({ limit: "200" }).catch(() => ({ initiative: [], pagination: { next_key: null, total: "0" } })),
  ]);
  const tags = new Set<string>();
  for (const p of projects.project || []) {
    for (const t of p.tags || []) tags.add(t);
  }
  for (const i of initiatives.initiative || []) {
    for (const t of i.tags || []) tags.add(t);
  }
  return Array.from(tags).sort();
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
