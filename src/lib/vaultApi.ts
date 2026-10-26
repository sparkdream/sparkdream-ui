// LCD reads for x/vault (shared accounts). Paths follow the google.api.http
// rules in proto/sparkdream/vault/v1/query.proto. Call invalidateVaults()
// right after any vault tx so the follow-up refetch misses the cache.

import { lcdGet, paginationParams } from "./api";
import { cachedFetch, invalidate } from "./queryCache";
import { isMissingEndpoint } from "./errors";
import type { PaginationRequest } from "@/types/blog";
import {
  VAULT_PROPOSAL_STATUS_NUMBER,
  type Vault,
  type VaultParamsResponse,
  type VaultProposal,
  type VaultProposalsResponse,
  type VaultResponse,
  type VaultsResponse,
  type VaultTallyResponse,
} from "@/types/vault";

const PREFIX = "vault|";
const TTL = { ttl: 15_000, swr: false };

function pageKey(p?: PaginationRequest): string {
  return `${p?.limit ?? ""}|${p?.key ?? ""}|${p?.reverse ? 1 : 0}`;
}

/** Drop every cached vault read. Call after any x/vault broadcast. */
export function invalidateVaults(): void {
  invalidate(PREFIX);
}

export function getVaultParams(): Promise<VaultParamsResponse> {
  return cachedFetch(`${PREFIX}params`, () => lcdGet<VaultParamsResponse>("/sparkdream/vault/v1/params"), {
    ttl: 60_000,
    swr: true,
  });
}

export async function getVault(vaultId: string): Promise<Vault> {
  const res = await cachedFetch(
    `${PREFIX}vault|${vaultId}`,
    () => lcdGet<VaultResponse>(`/sparkdream/vault/v1/vault/${vaultId}`),
    TTL
  );
  return res.vault;
}

/** The vault at a module-derived address, or null when the address is not a vault. */
export async function getVaultByAddress(address: string): Promise<Vault | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}by_address|${address}`,
      () => lcdGet<VaultResponse>(`/sparkdream/vault/v1/vault_by_address/${address}`),
      { ttl: 60_000, swr: true }
    );
    return res.vault ?? null;
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

/**
 * Vaults the address (or any earlier address of the same member) signs for.
 * Pagination is offset-based: pass `offset`, read `pagination.total`.
 */
export function listVaultsBySigner(address: string, offset = 0, limit = 50): Promise<VaultsResponse> {
  return cachedFetch(
    `${PREFIX}by_signer|${address}|${offset}|${limit}`,
    () => {
      const params = new URLSearchParams({ "pagination.offset": String(offset), "pagination.limit": String(limit) });
      return lcdGet<VaultsResponse>(`/sparkdream/vault/v1/vaults_by_signer/${address}`, params);
    },
    TTL
  );
}

export async function getVaultProposal(proposalId: string): Promise<VaultProposal | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}proposal|${proposalId}`,
      () => lcdGet<{ vault_proposal: VaultProposal }>(`/sparkdream/vault/v1/vault_proposal/${proposalId}`),
      TTL
    );
    return res.vault_proposal ?? null;
  } catch (err) {
    // Resolved proposals are pruned after the retention window.
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

/** A vault's proposals (newest first by default), optionally of one status. */
export function listVaultProposals(vaultId: string, status?: string, p?: PaginationRequest): Promise<VaultProposalsResponse> {
  const page = { reverse: true, ...p };
  return cachedFetch(
    `${PREFIX}proposals|${vaultId}|${status ?? ""}|${pageKey(page)}`,
    () => {
      const params = paginationParams(page);
      if (status) params.set("status", String(VAULT_PROPOSAL_STATUS_NUMBER[status] ?? 0));
      return lcdGet<VaultProposalsResponse>(`/sparkdream/vault/v1/proposals_by_vault/${vaultId}`, params);
    },
    TTL
  );
}

/** Proposals the address (or an earlier address of the same member) opened, across vaults. */
export function listVaultProposalsByProposer(proposer: string, status?: string, p?: PaginationRequest): Promise<VaultProposalsResponse> {
  return cachedFetch(
    `${PREFIX}by_proposer|${proposer}|${status ?? ""}|${pageKey(p)}`,
    () => {
      const params = paginationParams(p);
      if (status) params.set("status", String(VAULT_PROPOSAL_STATUS_NUMBER[status] ?? 0));
      return lcdGet<VaultProposalsResponse>(`/sparkdream/vault/v1/proposals_by_proposer/${proposer}`, params);
    },
    TTL
  );
}

export function getVaultTally(proposalId: string): Promise<VaultTallyResponse> {
  // Not cached: approvals and signer weights change between reads.
  return lcdGet<VaultTallyResponse>(`/sparkdream/vault/v1/tally/${proposalId}`);
}
