// The chain-archiver service type (chain repo: deploy/docs/archival-strategy.md,
// "Chain Archiver"): an x/service operator that keeps the permanent copy of
// the block history on Arweave. Its operator metadata names the Arweave
// wallets its uploads are signed by, which is what a reader of the copy
// trusts; this file builds and reads that metadata.

/** Service type seeded by x/service for the chain archivers. */
export const CHAIN_ARCHIVER_SERVICE_TYPE = "chain-archiver";

/** What cmd/archiveworker reads from the operator's metadata. */
export interface ArchiverMetadata {
  v: number;
  backend: string;
  wallets: string[];
}

/** An Arweave address: the base64url SHA-256 of the wallet's public key. */
const ARWEAVE_ADDRESS = /^[A-Za-z0-9_-]{43}$/;

/** Wallet addresses typed one per line or separated by commas or spaces. */
export function parseWallets(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

/** Problems with the wallet list, or none. */
export function walletProblems(wallets: string[]): string[] {
  if (wallets.length === 0) return ["Enter the Arweave wallet address the worker uploads from"];
  return wallets
    .filter((w) => !ARWEAVE_ADDRESS.test(w))
    .map((w) => `${w} is not an Arweave address (43 letters, digits, - or _)`);
}

export function buildArchiverMetadata(wallets: string[]): ArchiverMetadata {
  return { v: 1, backend: "arweave", wallets };
}

export function archiverMetadataBytes(m: ArchiverMetadata): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(m));
}

/** Decode operator metadata bytes (base64 in LCD JSON). Null if it isn't archiver metadata. */
export function parseArchiverMetadata(b64: string): ArchiverMetadata | null {
  try {
    const bin = atob((b64 || "").trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const m = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ArchiverMetadata>;
    if (m.backend !== "arweave" || !Array.isArray(m.wallets)) return null;
    const wallets = m.wallets.filter((w): w is string => typeof w === "string");
    if (wallets.length === 0 || wallets.length !== m.wallets.length || walletProblems(wallets).length > 0) return null;
    return { v: typeof m.v === "number" ? m.v : 1, backend: "arweave", wallets };
  } catch {
    return null;
  }
}

/**
 * Service type of the operators that make members' permanent copies on
 * Arweave (chain repo: docs/x-storage-spec.md §8.1). Its operator metadata is
 * the same document as the archiver's, so the functions above serve both.
 */
export const STORAGE_ARWEAVE_SERVICE_TYPE = "storage-arweave";
