// Recovery commitments for x/rep member key migration (docs/x-rep-spec.md,
// "Recovery commitments"). The hashes must equal the chain's byte for byte
// (x/rep/types/migration.go RecoveryCommitmentHash / RecoverySeal), or a
// reveal fails with "recovery commitment inactive" / "seal not found" long
// after the user backed up a code that can never work. recovery.test.ts pins
// both against vectors produced by the chain functions.
//
// Pure functions only (plus a little localStorage), so node --test can run
// them without a browser.

export const RECOVERY_COMMIT_DOMAIN = "sparkdream/recovery/commit/v1";
export const RECOVERY_SEAL_DOMAIN = "sparkdream/recovery/seal/v1";
/** MaxRecoveryCommitments: active plus pending. */
export const MAX_RECOVERY_COMMITMENTS = 4;
/** Generated preimages are 32 random bytes; the chain accepts 1..256. */
export const RECOVERY_PREIMAGE_BYTES = 32;
export const MAX_RECOVERY_PREIMAGE_BYTES = 256;

const utf8 = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer: subtle.digest refuses a view over a
  // SharedArrayBuffer and some TS lib versions refuse Uint8Array<ArrayBufferLike>.
  const buf = new Uint8Array(bytes).buffer;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

/** A fresh random preimage. Never leaves the browser except in the user's backup and, at recovery, a reveal. */
export function randomPreimage(): Uint8Array {
  const b = new Uint8Array(RECOVERY_PREIMAGE_BYTES);
  crypto.getRandomValues(b);
  return b;
}

/** SHA-256(utf8("sparkdream/recovery/commit/v1") || preimage): what MsgSetRecoveryCommitment stores. */
export function recoveryCommitment(preimage: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(utf8.encode(RECOVERY_COMMIT_DOMAIN), preimage));
}

/**
 * SHA-256(utf8("sparkdream/recovery/seal/v1") || preimage || utf8(from) ||
 * utf8(to)), from and to as bech32 strings: what MsgCommitRecovery carries.
 * Binding the new address is what stops a mempool observer from redirecting
 * the reveal to themselves.
 */
export function recoverySeal(preimage: Uint8Array, from: string, to: string): Promise<Uint8Array> {
  return sha256(concat(utf8.encode(RECOVERY_SEAL_DOMAIN), preimage, utf8.encode(from), utf8.encode(to)));
}

// ── Encodings ───────────────────────────────────────────────────────

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** bytes fields come back from the LCD as base64. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The recovery code as the user sees it: hex in groups of 4, easier to copy by hand. */
export function formatRecoveryCode(preimage: Uint8Array): string {
  return toHex(preimage).match(/.{1,4}/g)?.join("-") ?? "";
}

/**
 * Reads a recovery code back from what the user pasted: the bare code (with
 * or without the group dashes and spaces) or the whole backup file, whose
 * "Recovery code:" line is picked out. Null when no valid code is found.
 */
export function parseRecoveryCode(input: string): Uint8Array | null {
  const line = input.match(/recovery code:[ \t]*([0-9a-fA-F \t-]+)/i);
  const raw = (line ? line[1] : input).replace(/[\s-]/g, "");
  if (!raw || raw.length > MAX_RECOVERY_PREIMAGE_BYTES * 2) return null;
  return fromHex(raw);
}

/** The text of the downloadable backup. Naming the member saves a lookup at recovery time. */
export function recoveryBackupText(member: string, preimage: Uint8Array, commitment: Uint8Array): string {
  return [
    "Spark Dream recovery code",
    "",
    "Anyone holding this code can move your membership to an address they choose,",
    "after a short delay. Keep it offline and private, like a seed phrase.",
    "It does not give access to your wallet or your SPARK.",
    "",
    `Member: ${member}`,
    `Recovery code: ${formatRecoveryCode(preimage)}`,
    `Commitment: ${toHex(commitment)}`,
    "",
    "To recover: connect a new, unused address on the Permissions page, open",
    "\"Recover a membership\", and enter the member address and this code.",
    "",
  ].join("\n");
}

/** Pulls "Member: <address>" out of a pasted backup, if present. */
export function parseBackupMember(input: string): string | null {
  const m = input.match(/member:\s*([a-z0-9]+1[02-9ac-hj-np-z]+)/i);
  return m ? m[1] : null;
}
