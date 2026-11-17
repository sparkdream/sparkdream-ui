// Server-side check of a member's signed upload authorisation (ADR-036, as
// Keplr's signArbitrary produces it).

import { makeSignDoc, pubkeyToAddress, serializeSignDoc, type StdSignature } from "@cosmjs/amino";
import { Secp256k1, Secp256k1Signature, sha256 } from "@cosmjs/crypto";
import { fromBase64, toBase64, toUtf8 } from "@cosmjs/encoding";
import { AUTH_MAX_AGE_MS, parseUploadAuthMessage } from "./policy";

/** What the browser sends with an upload. */
export interface SignedUploadAuth {
  message: string;
  signature: StdSignature;
}

/** The sign doc ADR-036 defines for arbitrary data. */
export function adr36SignDoc(signer: string, data: string) {
  return makeSignDoc(
    [{ type: "sign/MsgSignData", value: { signer, data: toBase64(toUtf8(data)) } }],
    { gas: "0", amount: [] },
    "",
    "",
    0,
    0
  );
}

export type AuthResult = { ok: true; address: string } | { ok: false; reason: string };

/**
 * Verify that `auth` is this app's upload message for this chain, unexpired,
 * and signed by the key of the address it names.
 */
export async function verifyUploadAuth(
  auth: SignedUploadAuth,
  expected: { chainId: string; bech32Prefix: string; now: Date }
): Promise<AuthResult> {
  const fail = (reason: string): AuthResult => ({ ok: false, reason });
  const parsed = typeof auth?.message === "string" ? parseUploadAuthMessage(auth.message) : null;
  if (!parsed) return fail("not an upload authorisation");
  if (parsed.chainId !== expected.chainId) return fail("signed for another chain");
  const expires = Date.parse(parsed.expires);
  if (!Number.isFinite(expires) || new Date(expires).toISOString() !== parsed.expires) return fail("bad expiry");
  if (expires <= expected.now.getTime()) return fail("expired");
  // A far-off expiry is refused: the authorisation is meant to be short-lived.
  if (expires > expected.now.getTime() + AUTH_MAX_AGE_MS + 5 * 60 * 1000) return fail("expiry too far away");

  try {
    const pub = auth.signature?.pub_key;
    if (pub?.type !== "tendermint/PubKeySecp256k1" || typeof pub.value !== "string") return fail("unsupported key");
    if (pubkeyToAddress(pub, expected.bech32Prefix) !== parsed.address) return fail("signed by another address");
    const sig = Secp256k1Signature.fromFixedLength(fromBase64(auth.signature.signature));
    const digest = sha256(serializeSignDoc(adr36SignDoc(parsed.address, auth.message)));
    if (!(await Secp256k1.verifySignature(sig, digest, fromBase64(pub.value)))) return fail("bad signature");
  } catch {
    return fail("bad signature");
  }
  return { ok: true, address: parsed.address };
}
