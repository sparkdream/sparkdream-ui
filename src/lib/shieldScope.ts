// The raw nullifier scope of a shielded exec, client side. Kept free of
// browser and cosmjs imports so its test (shieldScope.test.ts) can run it
// against the chain's own scope vectors.

import type { ShieldedOpRegistration } from "@/types/shield";

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function scopeField(inner: Record<string, unknown>, path: string): bigint {
  const v = inner[snakeToCamel(path)] ?? inner[path];
  if (v === undefined || v === null) throw new Error(`missing ${path} for an anonymous action`);
  return BigInt(v as string | number | bigint);
}

// types.PackNullifierScope: an 8-bit qualifier in the top byte of a 56-bit id.
function packScope(qualifier: bigint, id: bigint, path: string): string {
  if (qualifier >= BigInt(256) || id >= BigInt(1) << BigInt(56)) {
    throw new Error(`${path} out of range for an anonymous action`);
  }
  return ((qualifier << BigInt(56)) | id).toString();
}

// The raw nullifier scope this op's registration binds the proof to. Must
// mirror x/shield's resolveNullifierScope exactly: the proof commits to it, so
// any difference fails at broadcast as "ZK proof verification failed".
// - EPOCH: current_epoch / epoch_window (registration.EpochScope).
// - Two fields "a,b" (e.g. "target_type,target_id"): a packed into the top
//   byte, so a collection and an item with the same id get different scopes.
// - Fallback "a|b" (e.g. "reply_id|post_id"): (1, a) when a is non-zero,
//   else (0, b), so a reply and a post with the same id differ too.
export function resolveScope(reg: ShieldedOpRegistration, inner: Record<string, unknown>, epoch: string): string {
  const path = reg.scope_field_path;
  switch (reg.nullifier_scope_type) {
    case "NULLIFIER_SCOPE_MESSAGE_FIELD": {
      if (path.includes("|")) {
        const [first, second] = path.split("|");
        const a = scopeField(inner, first);
        return a !== BigInt(0) ? packScope(BigInt(1), a, path) : packScope(BigInt(0), scopeField(inner, second), path);
      }
      const [first, second] = path.split(",");
      if (second === undefined) return scopeField(inner, first).toString();
      return packScope(scopeField(inner, first), scopeField(inner, second), path);
    }
    case "NULLIFIER_SCOPE_GLOBAL":
      return "0";
    case "NULLIFIER_SCOPE_EPOCH": {
      const window = BigInt(reg.epoch_window || "0");
      return (BigInt(epoch) / (window > BigInt(0) ? window : BigInt(1))).toString();
    }
    default:
      return epoch;
  }
}
