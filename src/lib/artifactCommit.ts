// Off-chain side of x/artifact commit-reveal (docs/x-artifact-spec.md §7.15),
// a port of the chain's cmd/artifactcommit and x/artifact/types/commitment.go.
//
// A blind-mint class commits one Merkle root over every token's metadata:
//
//   leaf = SHA-256(0x00 || be64(class_id) || be64(token_id) || salt || SHA-256(metadata))
//   node = SHA-256(0x01 || min(a,b) || max(a,b))
//
// where SHA-256(metadata) is the hash of the protobuf encoding of
// TokenMetadata (the chain's MetadataHash). Odd levels carry their last node
// up unchanged, and a proof is the sibling hashes from the leaf up.
//
// A generative class commits SHA-256(seed) and reveals the seed later.
//
// The salts are the secret: whoever loses them can never reveal, and holders
// of unrevealed tokens can then burn for a refund after the deadline. They
// are kept in localStorage per class and offered as a JSON download.

import { sha256 } from "@cosmjs/crypto";
import { fromHex, toHex } from "@cosmjs/encoding";
import { TokenMetadata as ProtoTokenMetadata } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/types";
import type { TokenMetadata } from "@/types/artifact";

/** MsgReveal proofs are at most this deep (2^32 leaves). */
export const MAX_REVEAL_PROOF_DEPTH = 32;
/** Salts and seeds are 1..64 bytes. */
export const MAX_REVEAL_SECRET_BYTES = 64;

const LEAF_DOMAIN = 0x00;
const NODE_DOMAIN = 0x01;

/** One input entry, in artifactcommit's entries.json shape. An empty salt is filled with 32 random bytes. */
export interface CommitEntry {
  token_id: number | string;
  salt?: string;
  metadata: TokenMetadata;
}

/** One committed token: what MsgReveal needs later. */
export interface CommitLeaf {
  token_id: string;
  salt: string;
  metadata_hash: string;
  proof: string[];
  /** The committed metadata. artifactcommit's output omits it; ours keeps it so a reveal needs nothing else. */
  metadata?: TokenMetadata;
}

/** artifactcommit's tree output, plus the metadata of each leaf when known. */
export interface CommitTree {
  class_id: string;
  root: string;
  leaves: CommitLeaf[];
}

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function be64(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, false);
  return b;
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/** LCD-shaped metadata to the proto message, fields taken exactly as given (no trimming). */
export function toProtoMetadata(m: TokenMetadata | undefined) {
  return {
    name: m?.name ?? "",
    description: m?.description ?? "",
    uri: m?.uri ?? "",
    uriHash: m?.uri_hash ?? "",
    attributes: (m?.attributes ?? []).map((a) => ({ key: a.key ?? "", value: a.value ?? "" })),
  };
}

/** The chain's MetadataHash: lowercase hex SHA-256 of the protobuf encoding. */
export function metadataHash(m: TokenMetadata | undefined): string {
  return toHex(sha256(ProtoTokenMetadata.encode(toProtoMetadata(m)).finish()));
}

/** Parse a lowercase-hex salt or seed of 1..64 bytes, or throw. */
export function decodeHexSecret(field: string, s: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/.test(s)) throw new Error(`The ${field} must be lowercase hex bytes.`);
  const bz = fromHex(s);
  if (bz.length > MAX_REVEAL_SECRET_BYTES) throw new Error(`The ${field} can be at most ${MAX_REVEAL_SECRET_BYTES} bytes.`);
  return bz;
}

export function revealLeaf(classId: bigint, tokenId: bigint, salt: Uint8Array, m: TokenMetadata | undefined): Uint8Array {
  return sha256(cat(Uint8Array.of(LEAF_DOMAIN), be64(classId), be64(tokenId), salt, fromHex(metadataHash(m))));
}

export function revealNode(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = compare(a, b) > 0 ? [b, a] : [a, b];
  return sha256(cat(Uint8Array.of(NODE_DOMAIN), lo, hi));
}

export function verifyRevealProof(leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean {
  let cur = leaf;
  for (const sib of proof) cur = revealNode(cur, sib);
  return compare(cur, root) === 0;
}

/** Root and per-leaf proofs over leaves, in order, exactly as BuildRevealTree builds them. */
export function buildRevealTree(leaves: Uint8Array[]): { root: Uint8Array; proofs: Uint8Array[][] } {
  if (leaves.length === 0) throw new Error("No leaves.");
  const proofs: Uint8Array[][] = leaves.map(() => []);
  const idx = leaves.map((_, i) => i);
  let level = [...leaves];
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 === level.length ? level[i] : revealNode(level[i], level[i + 1]));
    }
    for (let leaf = 0; leaf < idx.length; leaf++) {
      const pos = idx[leaf];
      if ((pos ^ 1) < level.length) proofs[leaf].push(level[pos ^ 1]);
      idx[leaf] = Math.floor(pos / 2);
    }
    level = next;
  }
  return { root: level[0], proofs };
}

export function randomSaltHex(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

/** artifactcommit tree: the commitment and every token's salt and proof. */
export function buildCommitTree(classId: bigint, entries: CommitEntry[]): CommitTree {
  if (entries.length === 0) throw new Error("Add at least one token.");
  const seen = new Set<string>();
  const leaves: Uint8Array[] = [];
  const out: CommitLeaf[] = [];
  entries.forEach((e, i) => {
    const id = String(e.token_id ?? "");
    if (!/^\d+$/.test(id) || BigInt(id) === BigInt(0) || seen.has(id)) {
      throw new Error(`Entry ${i + 1}: token ids must be unique and at least 1.`);
    }
    seen.add(id);
    const salt = e.salt || randomSaltHex();
    const saltBytes = decodeHexSecret("salt", salt);
    leaves.push(revealLeaf(classId, BigInt(id), saltBytes, e.metadata));
    out.push({ token_id: id, salt, metadata_hash: metadataHash(e.metadata), proof: [], metadata: e.metadata });
  });
  const { root, proofs } = buildRevealTree(leaves);
  out.forEach((l, i) => (l.proof = proofs[i].map(toHex)));
  return { class_id: classId.toString(), root: toHex(root), leaves: out };
}

/** SHA-256 of a hex seed: what a generative class commits. */
export function seedCommitment(seedHex: string): string {
  return toHex(sha256(decodeHexSecret("seed", seedHex)));
}

/**
 * Check a leaf against a commitment: the metadata hashes to metadata_hash and
 * the leaf proves into root. Returns an error message or null.
 */
export function checkLeaf(classId: bigint, root: string, leaf: CommitLeaf, metadata: TokenMetadata | undefined): string | null {
  if (metadataHash(metadata) !== leaf.metadata_hash) return "This metadata doesn't match what was committed for the token.";
  let salt: Uint8Array;
  try {
    salt = decodeHexSecret("salt", leaf.salt);
  } catch (err) {
    return err instanceof Error ? err.message : "Bad salt.";
  }
  if (leaf.proof.length > MAX_REVEAL_PROOF_DEPTH) return "The proof is too long.";
  const ok = verifyRevealProof(revealLeaf(classId, BigInt(leaf.token_id), salt, metadata), leaf.proof.map((p) => fromHex(p)), fromHex(root));
  return ok ? null : "The proof doesn't lead to the class commitment. Check the class id and the file.";
}

/** Read an artifactcommit (or our own) tree file. Throws on a bad shape. */
export function parseCommitTree(text: string): CommitTree {
  const raw = JSON.parse(text) as Partial<CommitTree> & { class_id?: number | string };
  if (!raw || typeof raw.root !== "string" || !/^[0-9a-f]{64}$/.test(raw.root) || !Array.isArray(raw.leaves)) {
    throw new Error("Not a commitment file: it needs a root and leaves.");
  }
  const leaves = raw.leaves.map((l, i) => {
    if (!l || !/^\d+$/.test(String(l.token_id)) || typeof l.salt !== "string" || !Array.isArray(l.proof)) {
      throw new Error(`Leaf ${i + 1} is missing its token id, salt or proof.`);
    }
    return {
      token_id: String(l.token_id),
      salt: l.salt,
      metadata_hash: String(l.metadata_hash || ""),
      proof: l.proof.map(String),
      metadata: l.metadata,
    };
  });
  return { class_id: String(raw.class_id ?? ""), root: raw.root, leaves };
}

// ---- Browser storage ---------------------------------------------------------

const TREE_KEY = "sparkdream-artifact-reveal:";
const SEED_KEY = "sparkdream-artifact-seed:";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The saved tree for a class, or null. */
export function loadCommitTree(classId: string): CommitTree | null {
  const s = read(TREE_KEY + classId);
  if (!s) return null;
  try {
    return parseCommitTree(s);
  } catch {
    return null;
  }
}

export function saveCommitTree(classId: string, tree: CommitTree): boolean {
  return write(TREE_KEY + classId, JSON.stringify(tree));
}

export function loadSeedSecret(classId: string): string | null {
  return read(SEED_KEY + classId);
}

export function saveSeedSecret(classId: string, seedHex: string): boolean {
  return write(SEED_KEY + classId, seedHex);
}

/** Offer a JSON file download (browser only). */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
