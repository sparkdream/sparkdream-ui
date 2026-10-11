// Server-side verdict index behind /api/content-scan (and the RSS feed).
//
// Scanner feeds are static files on arbitrary hosts (docs/content-scanning.md
// §5.4), usually without CORS headers, and a feed holds every verdict a worker
// ever issued. So the Next server fetches them, not the browser: it keeps the
// trusted workers' attestations in memory, indexed by record and by URI, and
// answers lookups for the handful of subjects a page shows. The browser still
// verifies every signature and combines the verdicts itself (lib/contentScan/
// client.ts), so this server is a relay, the same as anyone's merged file.
//
// Do not import this from client components.

import { getLatestBlockHeight } from "@/lib/api";
import { combine, importVerdictKey, parseJSONL, verifyAttestation, type Attestation, type VerdictState } from "./protocol";
import { loadScannerSetup, type ScannerSetup, type ScannerWorker } from "./workers";

/** Default for CONTENT_SCAN_MAX_LAG_BLOCKS. Workers checkpoint every 600 blocks by default. */
const DEFAULT_MAX_LAG_BLOCKS = 1800;
const REFRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export interface IndexSnapshot {
  setup: ScannerSetup;
  /** Scanned height per trusted worker: the most advanced of its manifest,
   *  its onchain checkpoint and its newest verdict. */
  heights: Record<string, number>;
  latestHeight: number;
  maxLagBlocks: number;
  generatedAt: number;
  /** Per-worker fetch problems, for operators reading the API response. */
  errors: Record<string, string>;
  byRecord: Map<string, Attestation[]>;
  byUri: Map<string, Attestation[]>;
}

export function maxLagBlocks(): number {
  const n = parseInt(process.env.CONTENT_SCAN_MAX_LAG_BLOCKS || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_LAG_BLOCKS;
}

/** CONTENT_SCAN_FEED_URL: one or more merged files (comma or space separated). */
function mergedFeedUrls(): string[] {
  return (process.env.CONTENT_SCAN_FEED_URL || "")
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json, application/x-ndjson, text/plain" },
  });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_FILE_BYTES) throw new Error(`${url} is too large`);
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) throw new Error(`${url} is too large`);
  return text;
}

function feedFile(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path}`;
}

interface Manifest {
  worker?: string;
  latest_segment?: number;
  count?: number;
  scanned_height?: number;
}

// ---- Signature cache ----------------------------------------------------------

const keyCache = new Map<string, Promise<CryptoKey | null>>();
function keyFor(b64: string): Promise<CryptoKey | null> {
  let k = keyCache.get(b64);
  if (!k) {
    k = importVerdictKey(b64);
    keyCache.set(b64, k);
  }
  return k;
}

const verified = new Map<string, boolean>();
async function keepVerified(atts: Attestation[], worker: ScannerWorker): Promise<Attestation[]> {
  const key = await keyFor(worker.verdictKey);
  if (!key) return [];
  if (verified.size > 500_000) verified.clear();
  const out: Attestation[] = [];
  for (const a of atts) {
    if (a.worker !== worker.address || !a.sig) continue;
    const cacheKey = `${worker.verdictKey}|${a.sig}`;
    let ok = verified.get(cacheKey);
    if (ok === undefined) {
      ok = await verifyAttestation(a, key);
      verified.set(cacheKey, ok);
    }
    if (ok) out.push(a);
  }
  return out;
}

// ---- Per-worker feeds ---------------------------------------------------------

interface WorkerFeed {
  feedUrl: string;
  verdictKey: string;
  /** Segments before the latest are full and append-only: fetched once. */
  finalSegments: Map<number, Attestation[]>;
  latest: Attestation[];
  latestSegment: number;
  count: number;
  scannedHeight: number;
}

const feeds = new Map<string, WorkerFeed>();

async function refreshWorkerFeed(worker: ScannerWorker): Promise<WorkerFeed> {
  let feed = feeds.get(worker.address);
  if (!feed || feed.feedUrl !== worker.feedUrl || feed.verdictKey !== worker.verdictKey) {
    feed = {
      feedUrl: worker.feedUrl,
      verdictKey: worker.verdictKey,
      finalSegments: new Map(),
      latest: [],
      latestSegment: 0,
      count: -1,
      scannedHeight: 0,
    };
    feeds.set(worker.address, feed);
  }
  const manifest = JSON.parse(await fetchText(feedFile(worker.feedUrl, "manifest.json"))) as Manifest;
  if (manifest.worker && manifest.worker !== worker.address) {
    throw new Error(`feed at ${worker.feedUrl} belongs to ${manifest.worker}`);
  }
  const latestSegment = Math.max(1, Number(manifest.latest_segment) || 1);
  const count = Number(manifest.count) || 0;
  feed.scannedHeight = Math.max(feed.scannedHeight, Number(manifest.scanned_height) || 0);
  if (count === feed.count && latestSegment === feed.latestSegment) return feed;

  const segPath = (n: number) => `segments/${String(n).padStart(6, "0")}.jsonl`;
  for (let n = 1; n < latestSegment; n++) {
    if (feed.finalSegments.has(n)) continue;
    const atts = parseJSONL(await fetchText(feedFile(worker.feedUrl, segPath(n))));
    feed.finalSegments.set(n, await keepVerified(atts, worker));
  }
  feed.latest =
    count === 0 ? [] : await keepVerified(parseJSONL(await fetchText(feedFile(worker.feedUrl, segPath(latestSegment)))), worker);
  feed.latestSegment = latestSegment;
  feed.count = count;
  return feed;
}

function* feedAttestations(feed: WorkerFeed): Generator<Attestation> {
  for (const seg of feed.finalSegments.values()) yield* seg;
  yield* feed.latest;
}

// ---- Merged files -------------------------------------------------------------

const mergedCache = new Map<string, Attestation[]>();

async function refreshMerged(urls: string[], workers: ScannerWorker[]): Promise<{ atts: Attestation[]; errors: Record<string, string> }> {
  const byAddr = new Map(workers.map((w) => [w.address, w]));
  const errors: Record<string, string> = {};
  const all: Attestation[] = [];
  for (const url of urls) {
    try {
      const parsed = parseJSONL(await fetchText(url));
      const grouped = new Map<string, Attestation[]>();
      for (const a of parsed) {
        if (!byAddr.has(a.worker)) continue;
        const list = grouped.get(a.worker);
        if (list) list.push(a);
        else grouped.set(a.worker, [a]);
      }
      const kept: Attestation[] = [];
      for (const [addr, list] of grouped) kept.push(...(await keepVerified(list, byAddr.get(addr)!)));
      mergedCache.set(url, kept);
    } catch (err) {
      errors[url] = err instanceof Error ? err.message : String(err);
      // Keep serving what the file held last time; freshness covers the lag.
    }
    all.push(...(mergedCache.get(url) || []).filter((a) => byAddr.has(a.worker)));
  }
  return { atts: all, errors };
}

// ---- Index --------------------------------------------------------------------

async function build(): Promise<IndexSnapshot> {
  const setup = await loadScannerSetup();
  const errors: Record<string, string> = {};
  const heights: Record<string, number> = {};
  const trusted = new Set(setup.workers.map((w) => w.address));
  for (const w of setup.workers) heights[w.address] = setup.checkpoints[w.address] || 0;

  let atts: Attestation[] = [];
  const merged = mergedFeedUrls();
  if (merged.length) {
    const res = await refreshMerged(merged, setup.workers);
    atts = res.atts;
    Object.assign(errors, res.errors);
  } else {
    await Promise.all(
      setup.workers.map(async (w) => {
        try {
          await refreshWorkerFeed(w);
        } catch (err) {
          errors[w.address] = err instanceof Error ? err.message : String(err);
        }
        const feed = feeds.get(w.address);
        if (!feed || feed.feedUrl !== w.feedUrl) return;
        heights[w.address] = Math.max(heights[w.address], feed.scannedHeight);
        for (const a of feedAttestations(feed)) atts.push(a);
      })
    );
    // Workers no longer trusted drop out of the cache.
    for (const addr of feeds.keys()) if (!trusted.has(addr)) feeds.delete(addr);
  }

  const byRecord = new Map<string, Attestation[]>();
  const byUri = new Map<string, Attestation[]>();
  const push = (m: Map<string, Attestation[]>, k: string, a: Attestation) => {
    const list = m.get(k);
    if (list) list.push(a);
    else m.set(k, [a]);
  };
  for (const a of atts) {
    if (!trusted.has(a.worker)) continue;
    heights[a.worker] = Math.max(heights[a.worker] || 0, a.scanned_height);
    if (a.subject.record) push(byRecord, a.subject.record, a);
    if (a.subject.uri) push(byUri, a.subject.uri, a);
  }

  let latestHeight = 0;
  try {
    latestHeight = parseInt(await getLatestBlockHeight(), 10) || 0;
  } catch {
    // Unknown chain height: the client treats the data as stale.
  }

  return {
    setup,
    heights,
    latestHeight,
    maxLagBlocks: maxLagBlocks(),
    generatedAt: Date.now(),
    errors,
    byRecord,
    byUri,
  };
}

let current: IndexSnapshot | null = null;
let building: Promise<IndexSnapshot> | null = null;

/**
 * The current index. Built on first use, then refreshed in the background
 * once a minute while the previous snapshot keeps serving. If a refresh
 * fails, the old snapshot stays and ages; the freshness check then holds
 * flagged content back, while text keeps working.
 */
export async function getVerdictIndex(): Promise<IndexSnapshot> {
  const stale = !current || Date.now() - current.generatedAt > REFRESH_MS;
  if (stale && !building) {
    building = build()
      .then((snap) => {
        current = snap;
        return snap;
      })
      .finally(() => {
        building = null;
      });
  }
  if (current) {
    building?.catch(() => {});
    return current;
  }
  return building!;
}

/** The attestations a page needs: everything about these records and URIs. */
export function lookup(snap: IndexSnapshot, records: string[], uris: string[]): Attestation[] {
  const out: Attestation[] = [];
  for (const r of records) out.push(...(snap.byRecord.get(r) || []));
  for (const u of uris) {
    for (const a of snap.byUri.get(u) || []) if (!a.subject.record || !records.includes(a.subject.record)) out.push(a);
  }
  return out;
}

/**
 * Server-side combined verdict for one record, for output the server renders
 * itself (the RSS feed). Signatures were verified when the feed was indexed.
 * Only removed/held matter there: the server never fetches flagged bodies.
 */
export async function serverRecordVerdict(record: string, sha256?: string): Promise<VerdictState> {
  try {
    const snap = await getVerdictIndex();
    if (snap.setup.quorum < 1) return "unchecked";
    return combine(snap.byRecord.get(record) || [], {
      sha256: sha256 || undefined,
      quorum: snap.setup.quorum,
      now: new Date(),
      chainId: process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || undefined,
    }).verdict;
  } catch {
    return "unchecked";
  }
}
