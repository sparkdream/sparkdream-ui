// Builders for the x/storage messages a council signs through a proposal
// (docs/x-storage-spec.md, "Councils and governance"), and the checks the
// proposal form runs on their fields before anything is signed. The form
// calls these, and aminoSigning.test.ts signs what they build inside a
// council proposal, so the form can never propose a shape the test did not
// cover. `authority` is always the policy address the proposal executes as.

import { fromBech32 } from "@cosmjs/encoding";
import type { StorageBackendWithBounds } from "@/types/storage";
import type { StorageMsg } from "./storageMsgs";
import { formatSpark } from "./utils";

export const StorageCouncilMsgTypeUrls = {
  ApproveOperator: "/sparkdream.storage.v1.MsgApproveOperator",
  RemoveOperator: "/sparkdream.storage.v1.MsgRemoveOperator",
  ApproveScanner: "/sparkdream.storage.v1.MsgApproveScanner",
  RemoveScanner: "/sparkdream.storage.v1.MsgRemoveScanner",
  VoidCompletion: "/sparkdream.storage.v1.MsgVoidCompletion",
  UnflagRemoved: "/sparkdream.storage.v1.MsgUnflagRemoved",
  UpdateOperationalParams: "/sparkdream.storage.v1.MsgUpdateOperationalParams",
} as const;

export function approveOperatorMsg(authority: string, backend: string, operator: string): StorageMsg {
  return { typeUrl: StorageCouncilMsgTypeUrls.ApproveOperator, value: { authority, backend, operator } };
}

export function removeOperatorMsg(authority: string, backend: string, operator: string): StorageMsg {
  return { typeUrl: StorageCouncilMsgTypeUrls.RemoveOperator, value: { authority, backend, operator } };
}

export function approveScannerMsg(authority: string, scanner: string): StorageMsg {
  return { typeUrl: StorageCouncilMsgTypeUrls.ApproveScanner, value: { authority, scanner } };
}

export function removeScannerMsg(authority: string, scanner: string): StorageMsg {
  return { typeUrl: StorageCouncilMsgTypeUrls.RemoveScanner, value: { authority, scanner } };
}

export function voidCompletionMsg(authority: string, requestId: string, reason: string): StorageMsg {
  return { typeUrl: StorageCouncilMsgTypeUrls.VoidCompletion, value: { authority, requestId: BigInt(requestId), reason } };
}

export function unflagRemovedMsg(authority: string, hashes: string[]): StorageMsg {
  return { typeUrl: StorageCouncilMsgTypeUrls.UnflagRemoved, value: { authority, hashes } };
}

/** Both prices are in base units (micro-denominated), as decimal strings. */
export function updateStoragePricesMsg(authority: string, backend: string, pricePerByte: string, minFee: string): StorageMsg {
  return { typeUrl: StorageCouncilMsgTypeUrls.UpdateOperationalParams, value: { authority, backend, pricePerByte, minFee } };
}

/**
 * A built message as the proposal carries it: packed into an Any with the
 * package's own encoder.
 */
export async function packStorageCouncilMsg(msg: StorageMsg): Promise<{ typeUrl: string; value: Uint8Array }> {
  const tx = await import("@sparkdreamnft/sparkdreamjs/sparkdream/storage/v1/tx");
  const v = msg.value as never;
  const enc = <T,>(t: { fromPartial(o: never): T; encode(m: T): { finish(): Uint8Array } }) => t.encode(t.fromPartial(v)).finish();
  switch (msg.typeUrl) {
    case StorageCouncilMsgTypeUrls.ApproveOperator:
      return { typeUrl: msg.typeUrl, value: enc(tx.MsgApproveOperator) };
    case StorageCouncilMsgTypeUrls.RemoveOperator:
      return { typeUrl: msg.typeUrl, value: enc(tx.MsgRemoveOperator) };
    case StorageCouncilMsgTypeUrls.ApproveScanner:
      return { typeUrl: msg.typeUrl, value: enc(tx.MsgApproveScanner) };
    case StorageCouncilMsgTypeUrls.RemoveScanner:
      return { typeUrl: msg.typeUrl, value: enc(tx.MsgRemoveScanner) };
    case StorageCouncilMsgTypeUrls.VoidCompletion:
      return { typeUrl: msg.typeUrl, value: enc(tx.MsgVoidCompletion) };
    case StorageCouncilMsgTypeUrls.UnflagRemoved:
      return { typeUrl: msg.typeUrl, value: enc(tx.MsgUnflagRemoved) };
    case StorageCouncilMsgTypeUrls.UpdateOperationalParams:
      return { typeUrl: msg.typeUrl, value: enc(tx.MsgUpdateOperationalParams) };
    default:
      throw new Error(`Not a storage council message: ${msg.typeUrl}`);
  }
}

// ── Field checks. Each returns a plain sentence, or null when fine. ──────

/** `what` names the field, for example "operator" or "scanner". */
export function addressProblem(value: string, prefix: string, what: string): string | null {
  if (!value) return `Enter the ${what}'s address.`;
  try {
    const decoded = fromBech32(value);
    if (decoded.prefix !== prefix) return `The ${what}'s address must start with ${prefix}1.`;
    if (decoded.data.length !== 20 && decoded.data.length !== 32) return `The ${what}'s address is not a valid address on this chain.`;
  } catch {
    return `The ${what}'s address is not a valid address on this chain.`;
  }
  return null;
}

/** The chain numbers requests from 1. */
export function requestIdProblem(value: string): string | null {
  if (!value) return "Enter the request number.";
  if (!/^[0-9]+$/.test(value) || /^0+$/.test(value)) return "The request number must be a whole number, 1 or more.";
  // uint64
  if (BigInt(value) > BigInt("18446744073709551615")) return "That request number is too large.";
  return null;
}

/** The chain counts the reason in bytes (params.max_reason_bytes). */
export function reasonProblem(value: string, maxBytes: number): string | null {
  if (!value.trim()) return "Give the reason for voiding. It goes on the record.";
  const bytes = new TextEncoder().encode(value.trim()).length;
  if (bytes > maxBytes) return `The reason is ${bytes} bytes long. The chain allows at most ${maxBytes}.`;
  return null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The file hashes in pasted text, separated by spaces, commas or line breaks.
 * The chain takes sha256 as 64 lowercase hex characters, so hex typed in
 * upper case is lowered; anything else is reported.
 */
export function parseHashes(text: string, max: number): { hashes: string[]; problem: string | null } {
  const parts = text.split(/[\s,]+/).filter(Boolean).map((p) => (/^[0-9a-fA-F]{64}$/.test(p) ? p.toLowerCase() : p));
  if (parts.length === 0) return { hashes: [], problem: "Enter at least one file hash." };
  const bad = parts.find((p) => !SHA256_HEX.test(p));
  if (bad !== undefined) {
    const shown = bad.length > 20 ? `${bad.slice(0, 12)}...` : bad;
    return { hashes: [], problem: `"${shown}" is not a file hash. A hash is the file's sha256: 64 characters, 0 to 9 and a to f.` };
  }
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p)) return { hashes: [], problem: `The hash ${p.slice(0, 12)}... is listed twice.` };
    seen.add(p);
  }
  if (parts.length > max) return { hashes: [], problem: `One proposal message lifts at most ${max} hashes. You entered ${parts.length}.` };
  return { hashes: parts, problem: null };
}

/**
 * A typed amount in the display denom as base units, or null when it is not
 * a number or has more than six decimals (which would be cut off silently).
 */
export function displayAmountToMicro(input: string): string | null {
  const s = input.trim();
  if (!/^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return (BigInt(whole || "0") * BigInt(1_000_000) + BigInt((frac + "000000").slice(0, 6))).toString();
}

function inBounds(value: string, min: string, max: string): boolean {
  const v = BigInt(value);
  return v >= BigInt(min) && v <= BigInt(max);
}

/**
 * Why the chain would refuse these prices for the backend (both in base
 * units), or null. Mirrors Backend.ValidatePrices.
 */
export function pricesProblem(
  backend: StorageBackendWithBounds,
  pricePerByte: string | null,
  minFee: string | null,
  displayDenom: string
): string | null {
  if (pricePerByte === null) return "Enter the price per byte as a number with at most six decimals.";
  if (minFee === null) return "Enter the minimum fee as a number with at most six decimals.";
  if (!inBounds(pricePerByte, backend.min_price_per_byte, backend.max_price_per_byte)) {
    return `The price per byte must be between ${formatSpark(backend.min_price_per_byte)} and ${formatSpark(backend.max_price_per_byte)} ${displayDenom}.`;
  }
  if (!inBounds(minFee, backend.min_min_fee, backend.max_min_fee)) {
    return `The minimum fee must be between ${formatSpark(backend.min_min_fee)} and ${formatSpark(backend.max_min_fee)} ${displayDenom}.`;
  }
  return null;
}
