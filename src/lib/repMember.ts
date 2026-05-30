import { getRepMember } from "@/lib/api";
import type { RepMember } from "@/types/rep";

// Shared cache + in-flight dedupe for `/rep/v1/member/<addr>`. Several
// hooks read the same record per page (useIsRepMember, useCanPin,
// useTrustRank, useCanCreateTags) — without coalescing, a single dream
// detail with replies fires that endpoint 7+ times on mount, each with
// its own 404 when the connected key isn't a registered member.
const cache = new Map<string, RepMember | null>();
const cacheTs = new Map<string, number>();
const pending = new Map<string, Promise<RepMember | null>>();
const CACHE_TTL = 5 * 60 * 1000;

export function freshRepMember(addr: string): RepMember | null | undefined {
  const ts = cacheTs.get(addr);
  if (ts === undefined) return undefined;
  if (Date.now() - ts > CACHE_TTL) {
    cache.delete(addr);
    cacheTs.delete(addr);
    return undefined;
  }
  return cache.get(addr);
}

export function loadRepMember(addr: string): Promise<RepMember | null> {
  const cached = freshRepMember(addr);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = pending.get(addr);
  if (inflight) return inflight;
  const p = getRepMember(addr)
    .then((res) => (res.member?.address ? res.member : null))
    .catch(() => null)
    .then((v) => {
      cache.set(addr, v);
      cacheTs.set(addr, Date.now());
      return v;
    })
    .finally(() => pending.delete(addr));
  pending.set(addr, p);
  return p;
}
