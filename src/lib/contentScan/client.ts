// Browser-side verdict client (docs/content-scanning.md §6).
//
//  1. Trusted workers come from the chain: ACTIVE content-scanner operators
//     and their verdict keys (workers.ts), read through the LCD like any
//     other record, never from the verdict relay.
//  2. Verdicts for the subjects on screen come from /api/content-scan, which
//     relays the workers' feeds (feedIndex.ts). Requests made in the same
//     tick are batched into one call.
//  3. Every signature is checked here with WebCrypto Ed25519 against the
//     chain's keys, then the verdicts are combined per §4.4.
//  4. Freshness: if the quorum's effective scanned height trails the chain by
//     more than the operator's limit (CONTENT_SCAN_MAX_LAG_BLOCKS), "clean"
//     is downgraded to unchecked. Removed and held still apply. Text never
//     waits on any of this.
//
// Every failure lands on "unchecked": flagged content then stays behind its
// placeholder and plain text still shows, so a broken scanner setup degrades
// the site without taking it down.

import { isArchiveModeActive } from "@/lib/api";
import { loadRepMember } from "@/lib/repMember";
import { TrustLevel } from "@/types/rep";
import {
  combine,
  ed25519Available,
  effectiveScannedHeight,
  importVerdictKey,
  normalizeAttestation,
  quorumFor,
  verifyAttestation,
  type Attestation,
  type VerdictState,
} from "./protocol";
import { loadScannerSetup } from "./workers";

/** Why a subject is unchecked, for the placeholder copy. */
export type VerdictReason =
  | "loading" // not resolved yet
  | "pending" // scanners are running but have not cleared it (yet)
  | "no-scanners" // no ACTIVE content-scanner operators, or the type does not attest
  | "no-crypto" // this browser cannot verify Ed25519 signatures
  | "stale" // the scanners' data is older than the freshness limit
  | "unreachable" // the chain or the verdict relay did not answer
  | "archive"; // a read-only snapshot of another chain

export interface Verdict {
  state: VerdictState;
  reason?: VerdictReason;
  /** Category of a removed or held verdict. */
  category?: string;
  /** The hash a clean quorum agreed on: what fetched bytes must hash to. */
  sha256?: string;
  /** The off-chain id a clean quorum agreed on. */
  cid?: string;
}

export interface VerdictQuery {
  /** module/type/id, e.g. "blog/post/12". */
  record?: string;
  /** An external URI (collect item image, link). */
  uri?: string;
  /** Lowercase hex the verdicts must be about (a record's body_hash). Omit
   *  when the hash is only known from what the scanners fetched. */
  sha256?: string;
  /** Author address, for the elevated quorum on low-trust media (§9). */
  author?: string;
  /** Force the elevated quorum (e.g. federated authors, who are not members). */
  lowTrust?: boolean;
}

export const LOADING: Verdict = { state: "unchecked", reason: "loading" };

const SETUP_TTL_MS = 60_000;
const SUBJECT_TTL_MS = 60_000;
const BATCH_DELAY_MS = 15;
const MAX_PER_REQUEST = 40;

// ---- Trusted setup -------------------------------------------------------------

interface ClientSetup {
  keys: Map<string, CryptoKey>;
  quorum: number;
  elevatedQuorum: number;
  crypto: boolean;
}

let setupCache: { at: number; value: Promise<ClientSetup> } | null = null;

function getSetup(): Promise<ClientSetup> {
  if (setupCache && Date.now() - setupCache.at < SETUP_TTL_MS) return setupCache.value;
  const value = (async () => {
    const [setup, crypto] = await Promise.all([loadScannerSetup(), ed25519Available()]);
    const keys = new Map<string, CryptoKey>();
    if (crypto) {
      await Promise.all(
        setup.workers.map(async (w) => {
          const k = await importVerdictKey(w.verdictKey);
          if (k) keys.set(w.address, k);
        })
      );
    }
    return { keys, quorum: setup.quorum, elevatedQuorum: setup.elevatedQuorum, crypto };
  })();
  setupCache = { at: Date.now(), value };
  // A failed read is retried on the next request rather than cached.
  value.catch(() => {
    if (setupCache?.value === value) setupCache = null;
  });
  return value;
}

// ---- Relay fetch, batched -----------------------------------------------------

interface RelayMeta {
  chainId: string;
  heights: Record<string, number>;
  latestHeight: number;
  maxLagBlocks: number;
}

interface SubjectEntry {
  at: number;
  value: Promise<{ atts: Attestation[]; meta: RelayMeta }>;
}

const subjectCache = new Map<string, SubjectEntry>();
let queue = new Map<string, { resolve: (v: { atts: Attestation[]; meta: RelayMeta }) => void; reject: (e: unknown) => void }[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function subjectKey(q: VerdictQuery): string {
  return q.record ? `record:${q.record}` : `uri:${q.uri}`;
}

async function flushChunk(keys: string[], waiters: typeof queue): Promise<void> {
  const qs = new URLSearchParams();
  for (const k of keys) {
    if (k.startsWith("record:")) qs.append("record", k.slice(7));
    else qs.append("uri", k.slice(4));
  }
  try {
    const res = await fetch(`/api/content-scan?${qs}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`verdict relay answered ${res.status}`);
    const body = (await res.json()) as {
      chain_id?: string;
      heights?: Record<string, number>;
      latest_height?: number;
      max_lag_blocks?: number;
      attestations?: unknown[];
    };
    const meta: RelayMeta = {
      chainId: body.chain_id || "",
      heights: body.heights || {},
      latestHeight: Number(body.latest_height) || 0,
      maxLagBlocks: Number(body.max_lag_blocks ?? 0) || 0,
    };
    const atts = (body.attestations || []).map(normalizeAttestation).filter((a): a is Attestation => !!a);
    for (const k of keys) {
      const mine = atts.filter((a) =>
        k.startsWith("record:") ? a.subject.record === k.slice(7) : a.subject.uri === k.slice(4)
      );
      for (const w of waiters.get(k) || []) w.resolve({ atts: mine, meta });
    }
  } catch (err) {
    for (const k of keys) for (const w of waiters.get(k) || []) w.reject(err);
  }
}

function flush(): void {
  timer = null;
  const waiters = queue;
  queue = new Map();
  const keys = [...waiters.keys()];
  for (let i = 0; i < keys.length; i += MAX_PER_REQUEST) {
    void flushChunk(keys.slice(i, i + MAX_PER_REQUEST), waiters);
  }
}

function fetchSubject(key: string): Promise<{ atts: Attestation[]; meta: RelayMeta }> {
  const hit = subjectCache.get(key);
  if (hit && Date.now() - hit.at < SUBJECT_TTL_MS) return hit.value;
  const value = new Promise<{ atts: Attestation[]; meta: RelayMeta }>((resolve, reject) => {
    const list = queue.get(key);
    if (list) list.push({ resolve, reject });
    else queue.set(key, [{ resolve, reject }]);
    if (!timer) timer = setTimeout(flush, BATCH_DELAY_MS);
  });
  subjectCache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (subjectCache.get(key)?.value === value) subjectCache.delete(key);
  });
  if (subjectCache.size > 2000) {
    const oldest = subjectCache.keys().next().value;
    if (oldest !== undefined) subjectCache.delete(oldest);
  }
  return value;
}

// ---- Verification and combination ---------------------------------------------

const sigOk = new Map<string, boolean>();

async function verified(atts: Attestation[], keys: Map<string, CryptoKey>): Promise<Attestation[]> {
  const out: Attestation[] = [];
  for (const a of atts) {
    const key = keys.get(a.worker);
    if (!key || !a.sig) continue;
    const ck = `${a.worker}|${a.sig}`;
    let ok = sigOk.get(ck);
    if (ok === undefined) {
      ok = await verifyAttestation(a, key);
      sigOk.set(ck, ok);
    }
    if (ok) out.push(a);
  }
  return out;
}

async function lowTrustAuthor(q: VerdictQuery): Promise<boolean> {
  if (q.lowTrust) return true;
  if (!q.author) return false;
  const m = await loadRepMember(q.author);
  // Non-members cannot post media; one that did is treated as low trust.
  if (!m) return true;
  return m.trust_level === TrustLevel.NEW || m.trust_level === TrustLevel.PROVISIONAL;
}

function stale(meta: RelayMeta, workers: string[], quorum: number): boolean {
  if (meta.maxLagBlocks <= 0) return false;
  const effective = effectiveScannedHeight(
    workers.map((w) => meta.heights[w] || 0).filter((h) => h > 0),
    quorum
  );
  if (!effective || !meta.latestHeight) return true;
  return meta.latestHeight - effective > meta.maxLagBlocks;
}

/** Combine the trusted, verified verdicts for one subject. */
export async function resolveVerdict(q: VerdictQuery): Promise<Verdict> {
  if (!q.record && !q.uri) return { state: "unchecked", reason: "pending" };
  if (typeof window === "undefined") return LOADING;
  if (isArchiveModeActive()) return { state: "unchecked", reason: "archive" };

  let setup: ClientSetup;
  try {
    setup = await getSetup();
  } catch {
    return { state: "unchecked", reason: "unreachable" };
  }
  if (setup.quorum < 1 || setup.keys.size === 0) {
    return { state: "unchecked", reason: setup.crypto ? "no-scanners" : "no-crypto" };
  }

  let data: { atts: Attestation[]; meta: RelayMeta };
  try {
    data = await fetchSubject(subjectKey(q));
  } catch {
    return { state: "unchecked", reason: "unreachable" };
  }
  const good = await verified(data.atts, setup.keys);
  const base = {
    sha256: q.sha256 || undefined,
    now: new Date(),
    chainId: data.meta.chainId || undefined,
  };
  let res = combine(good, { ...base, quorum: setup.quorum });
  if (res.verdict === "clean" && setup.elevatedQuorum > setup.quorum && (await lowTrustAuthor(q))) {
    res = combine(good, { ...base, quorum: quorumFor(setup.quorum, setup.elevatedQuorum, true) });
  }

  if (res.verdict === "removed" || res.verdict === "held") {
    return { state: res.verdict, category: res.category };
  }
  if (res.verdict === "clean") {
    if (stale(data.meta, [...setup.keys.keys()], setup.quorum)) return { state: "unchecked", reason: "stale" };
    return { state: "clean", sha256: res.sha256, cid: res.cid };
  }
  return { state: "unchecked", reason: "pending" };
}

/** Drop cached verdicts so the next read refetches (e.g. after an edit). */
export function invalidateVerdict(q: VerdictQuery): void {
  subjectCache.delete(subjectKey(q));
}
