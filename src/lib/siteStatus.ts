// Server-side health checks behind /api/status: the services other than the
// chain node (lib/serviceStatus.ts checks that one from the browser).
//
// These run here, not in the browser, for two reasons. Some need what only the
// server holds (the image bucket's keys, the scanner pre-check address), and
// the rest sit on hosts that don't allow cross-origin reads, where a browser
// could tell "answered" from "refused" but not a 200 from a 522. So the page
// shows what this site can reach, and says so.
//
// The response names no private address: bucket endpoint, pre-check URL and
// tokens stay here. Do not import this from client components.

import { getVerdictIndex, imagesDisabled } from "@/lib/contentScan/feedIndex";
import { effectiveScannedHeight } from "@/lib/contentScan/protocol";
import { arweaveGateway, permanentCopiesOn, uploadConfig } from "@/lib/imageUpload/server";
import { listKeys } from "@/lib/imageUpload/s3";
import { isGatewayStatus, type ServiceReport, type ServiceState } from "@/lib/serviceStatus";
import {
  ARCHIVE_APP_NAME,
  assessArchiver,
  checkpointTxId,
  leadingArchiver,
  parseArweaveTx,
  parseNewestRange,
  type ArchiveWorker,
  type ArweaveTx,
} from "@/lib/archiverStatus";
import { CHAIN_ARCHIVER_SERVICE_TYPE, parseArchiverMetadata } from "@/lib/chainArchiver";
import { defaults } from "@/lib/chain";
import { arweaveNodeOf, operatorWallets } from "@/lib/storageFunds";
import {
  assessStorage,
  checkpointWallet,
  fundedOperators,
  largestFileBytes,
  readyOperators,
  type WorkerEvidence,
} from "@/lib/storageStatus";
import {
  assessBridges,
  BRIDGE_SERVICE_TYPE_PREFIX,
  canVerify,
  type VerifierInput,
  type VerifierRole,
} from "@/lib/bridgeStatus";
import type { BridgeBinding } from "@/types/federation";
import { headPinned, publicHttpsTarget } from "@/lib/publicUrl";
import { createHash } from "node:crypto";
import { toBech32 } from "@cosmjs/encoding";
import { assessValidators, type ActiveValidator } from "@/lib/validatorStatus";
import { assessGov, type GovProposal } from "@/lib/govStatus";
import { assessShield } from "@/lib/shieldStatus";
import { assessCerts, httpsHosts, type CertReading } from "@/lib/certStatus";
import { connect as tlsConnect } from "node:tls";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { assessIbc, type IbcChannel, type IbcLink, type IbcPeerClient, type IbcRelayer } from "@/lib/ibcStatus";
import { assessMirror, type MirrorRebuild, type MirrorSync } from "@/lib/mirrorStatus";
import {
  assessSession,
  rememberExpiry,
  withSessions,
  type AlsoSends,
  type ExpiryMemory,
  type SessionNote,
} from "@/lib/sessionStatus";
import type { Session } from "@/types/session";
import { CONTENT_SCANNER_SERVICE_TYPE, OperatorStatus, OPERATOR_STATUS_LABELS } from "@/types/service";
import type { Checkpoint, Operator, ServiceTypeConfig } from "@/types/service";
import type { ApprovedOperator, ApprovedScanner, StorageBackend } from "@/types/storage";

const TIMEOUT_MS = 6_000;
// One round of checks serves everyone who has the page open.
const CACHE_MS = 15_000;

type Reached =
  | { res: Response; ms: number }
  | { res: null; reason: string };

async function reach(url: string, method: "GET" | "HEAD" = "GET"): Promise<Reached> {
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method,
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { res, ms: Math.round(performance.now() - started) };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      res: null,
      reason: timedOut ? `Did not respond within ${TIMEOUT_MS / 1000} seconds.` : "Could not be reached.",
    };
  }
}

/** Something at the address answered, whatever it said. */
function answering(r: Reached): boolean {
  return !!r.res && !isGatewayStatus(r.res.status);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// ---- The chain's own denomination -----------------------------------------------

/** The chain's fee and bond denomination and its display name. */
export interface ChainUnits {
  denom: string;
  symbol: string;
  /** This chain's id, to tell a peer's light client of it from one of another chain. */
  chainId?: string;
}

/** As /api/config resolves them: the runtime setting wins over the build's. */
export function chainUnits(env: NodeJS.ProcessEnv = process.env): ChainUnits {
  return {
    denom: env.CHAIN_DENOM || defaults.denom,
    symbol: env.DISPLAY_DENOM || defaults.displayDenom,
    chainId: env.CHAIN_ID || defaults.chainId,
  };
}

// ---- Session keys ---------------------------------------------------------------

const CHECKPOINT_MSG = "/sparkdream.service.v1.MsgSubmitCheckpoint";
// At most this many operators' keys are read for one card.
const MAX_SESSION_OWNERS = 5;

// The expiry of each worker key this process has seen, so a key the chain
// has since removed is reported as expired, not as absent.
const keyExpiries: ExpiryMemory = new Map();

/**
 * The session each of these operators gave its worker for `msgType`
 * (lib/sessionStatus.ts), in the order given. An operator whose sessions
 * can't be read is left out: nothing is known of its key.
 */
async function sessionNotes(
  lcd: string,
  owners: { address: string; who: string; also?: AlsoSends }[],
  msgType: string,
  also?: AlsoSends
): Promise<SessionNote[]> {
  const base = `${lcd.replace(/\/+$/, "")}/sparkdream/session/v1/sessions_by_granter`;
  const notes = await Promise.all(
    owners.slice(0, MAX_SESSION_OWNERS).map(async ({ address, who, also: own }) => {
      const r = await reach(`${base}/${encodeURIComponent(address)}?pagination.limit=100`);
      if (!r.res?.ok) return null;
      try {
        const sessions = ((await r.res.json()) as { sessions?: Session[] }).sessions ?? [];
        const now = Date.now();
        const note = assessSession(sessions, msgType, who, now, own ?? also);
        return rememberExpiry(keyExpiries, `${address}|${msgType}`, sessions, msgType, note, who, now);
      } catch {
        return null;
      }
    })
  );
  return notes.filter((n): n is SessionNote => n !== null);
}

// ---- A plain web address --------------------------------------------------------

/** A page that should answer 2xx: the explorer. */
export async function checkPage(id: string, url: string): Promise<ServiceReport> {
  const r = await reach(url);
  if (!r.res) return { id, state: "unreachable", issues: [r.reason], latency_ms: null, facts: [] };
  if (r.res.ok) return { id, state: "ok", issues: [], latency_ms: r.ms, facts: [] };
  return {
    id,
    state: isGatewayStatus(r.res.status) ? "unreachable" : "degraded",
    issues: [`Answered with HTTP ${r.res.status}.`],
    latency_ms: null,
    facts: [],
  };
}

// ---- Content scanners -----------------------------------------------------------

export interface ScannerMeta {
  workers: string[];
  quorum: number;
  heights: Record<string, number>;
  latestHeight: number;
  maxLagBlocks: number;
  /** Feed addresses (or worker addresses) that could not be read. */
  errors: Record<string, string>;
  imagesDisabled: boolean;
  /** Hosts the active scanners publish their verdicts from. */
  feedHosts?: string[];
  /** Latest onchain checkpoint height per active scanner. */
  checkpoints?: Record<string, number>;
  /** The type's checkpoint_max_lag_blocks: past it the chain files a liveness report. 0 = not tracked. */
  checkpointMaxLag?: number;
  /** Why each registered scanner that isn't counted is left out ("underfunded", ...). */
  notCounted?: string[];
}

const n = (v: number) => v.toLocaleString("en-US");

/**
 * Judge the scanner setup the way a reader's browser will (lib/contentScan/
 * client.ts): media clears only when a quorum of trusted workers is active and
 * has scanned to within the freshness limit of the chain's head.
 */
export function assessScanners(meta: ScannerMeta): ServiceReport {
  const id = "scanners";
  if (meta.quorum < 1) {
    return {
      id,
      state: "off",
      issues: ["Content scanning isn't set up on this chain. Text shows as usual, and media that needs a check stays hidden."],
      latency_ms: null,
      facts: [],
    };
  }
  const issues: string[] = [];
  const facts = [{ label: "Active scanners", value: `${meta.workers.length}, ${meta.quorum} must agree` }];

  const idle = [...new Set(meta.notCounted ?? [])];
  if (idle.length > 0) facts.push({ label: "Registered, not counted", value: `${meta.notCounted!.length} (${idle.join(", ")})` });
  if (meta.feedHosts?.length) facts.push({ label: meta.feedHosts.length === 1 ? "Verdict feed" : "Verdict feeds", value: meta.feedHosts.join(", ") });

  if (meta.workers.length < meta.quorum) {
    issues.push(
      `Only ${meta.workers.length} of the ${meta.quorum} scanners needed ${meta.workers.length === 1 ? "is" : "are"} active, so media can't be cleared.`
    );
  } else if (meta.maxLagBlocks > 0) {
    const effective = effectiveScannedHeight(
      meta.workers.map((w) => meta.heights[w] || 0).filter((h) => h > 0),
      meta.quorum
    );
    if (!effective || !meta.latestHeight) {
      issues.push("How far the scanners have read is unknown, so media is held back.");
    } else {
      const lag = Math.max(0, meta.latestHeight - effective);
      facts.push({ label: "Behind the chain", value: `${n(lag)} blocks, limit ${n(meta.maxLagBlocks)}` });
      if (lag > meta.maxLagBlocks) {
        issues.push(`The scanners are ${n(lag)} blocks behind the chain, so media is held back until they catch up.`);
      }
    }
  }

  // The scanners' onchain checkpoints: what the chain itself holds them to,
  // apart from the freshness limit this site applies to their feeds.
  if (meta.checkpoints && meta.latestHeight > 0 && meta.workers.length > 0) {
    const limit = meta.checkpointMaxLag ?? 0;
    const lags = meta.workers.map((w) => (meta.checkpoints![w] ? Math.max(0, meta.latestHeight - meta.checkpoints![w]) : null));
    const newest = lags.filter((l): l is number => l !== null).sort((a, b) => a - b)[0];
    facts.push({
      label: "Last onchain checkpoint",
      value: newest === undefined ? "None yet" : `${n(newest)} blocks ago${limit > 0 ? `, limit ${n(limit)}` : ""}`,
    });
    const late = limit > 0 ? lags.filter((l) => l !== null && l > limit).length : 0;
    if (late > 0) {
      issues.push(
        `${late === 1 ? "One scanner hasn't" : `${late} scanners haven't`} checkpointed on chain within the ${n(limit)} blocks it allows.`
      );
    }
  }

  const unread = Object.keys(meta.errors).length;
  if (unread > 0) {
    issues.push(unread === 1 ? "One scanner feed could not be read." : `${unread} scanner feeds could not be read.`);
  }
  if (meta.imagesDisabled) {
    issues.push("Images are switched off by the site operator.");
  }
  return { id, state: issues.length ? "degraded" : "ok", issues, latency_ms: null, facts };
}

/**
 * What the chain says of the scanner operators beyond the ones the verdict
 * index trusts: the liveness limit, and the registered scanners left out.
 * Empty when it can't be read; the card then shows what the index knows.
 */
async function scannerRegistrations(lcd: string, trusted: Set<string>): Promise<Pick<ScannerMeta, "checkpointMaxLag" | "notCounted">> {
  const base = `${lcd.replace(/\/+$/, "")}/sparkdream/service/v1`;
  const type = encodeURIComponent(CONTENT_SCANNER_SERVICE_TYPE);
  const [cfgR, opsR] = await Promise.all([
    reach(`${base}/service_type/${type}`),
    reach(`${base}/operators_by_service_type/${type}?pagination.limit=200`),
  ]);
  const out: Pick<ScannerMeta, "checkpointMaxLag" | "notCounted"> = {};
  try {
    if (cfgR.res?.ok) {
      const config = ((await cfgR.res.json()) as { config?: ServiceTypeConfig }).config;
      out.checkpointMaxLag = Number(config?.checkpoint_max_lag_blocks || 0) || 0;
    }
    if (opsR.res?.ok) {
      const operators = ((await opsR.res.json()) as { operators?: Operator[] }).operators ?? [];
      out.notCounted = operators
        .filter((o) => !trusted.has(o.address) && o.status !== OperatorStatus.RETIRED)
        .map((o) =>
          // An active scanner the index leaves out names no verdict key or feed.
          o.status === OperatorStatus.ACTIVE ? "metadata unreadable" : (OPERATOR_STATUS_LABELS[o.status] ?? "Unknown").toLowerCase()
        );
    }
  } catch {
    // Unreadable answers: leave the extras out.
  }
  return out;
}

const FLAG_REMOVED_MSG = "/sparkdream.storage.v1.MsgFlagRemoved";

/** The scanners x/storage counts for permanent copies. Empty when it can't be read or the chain has no x/storage. */
async function storageScanners(lcd: string): Promise<Set<string>> {
  const r = await reach(`${lcd.replace(/\/+$/, "")}/sparkdream/storage/v1/approved_scanners?pagination.limit=200`);
  if (!r.res?.ok) return new Set();
  try {
    const scanners = ((await r.res.json()) as { scanners?: ApprovedScanner[] }).scanners ?? [];
    return new Set(scanners.filter((a) => !a.stale).map((a) => a.scanner));
  } catch {
    return new Set();
  }
}

/**
 * The session key of each active scanner's worker. Every scanner checkpoints
 * with it; one approved for permanent copies also flags removed files there
 * (MsgFlagRemoved) with the same key, so for it that message has to be
 * covered too.
 */
export async function scannerKeys(lcd: string, workers: string[]): Promise<SessionNote[]> {
  if (workers.length === 0) return [];
  const forStorage = await storageScanners(lcd);
  return sessionNotes(
    lcd,
    workers.map((address) => ({
      address,
      who: workers.length > 1 ? "A scanner's" : "The scanner's",
      also: forStorage.has(address) ? { required: [FLAG_REMOVED_MSG] } : undefined,
    })),
    CHECKPOINT_MSG
  );
}

async function checkScanners(lcd: string): Promise<ServiceReport> {
  try {
    const snap = await withTimeout(getVerdictIndex(), TIMEOUT_MS);
    const trusted = new Set(snap.setup.workers.map((w) => w.address));
    // Read together: each may take its full timeout.
    const [keys, registrations] = await Promise.all([
      scannerKeys(lcd, snap.setup.workers.map((w) => w.address)),
      snap.setup.quorum > 0 ? scannerRegistrations(lcd, trusted) : Promise.resolve({}),
    ]);
    return withSessions(assessScanners({
      feedHosts: [...new Set(snap.setup.workers.map((w) => hostOf(w.feedUrl)).filter(Boolean))],
      checkpoints: snap.setup.checkpoints,
      ...registrations,
      workers: snap.setup.workers.map((w) => w.address),
      quorum: snap.setup.quorum,
      heights: snap.heights,
      latestHeight: snap.latestHeight,
      maxLagBlocks: snap.maxLagBlocks,
      errors: snap.errors,
      imagesDisabled: imagesDisabled(),
    }), keys);
  } catch {
    return {
      id: "scanners",
      state: "unreachable",
      issues: ["The scanners' verdicts can't be loaded, so media that needs a check stays hidden."],
      latency_ms: null,
      facts: [],
    };
  }
}

// ---- Image uploads --------------------------------------------------------------

async function checkImages(env: NodeJS.ProcessEnv): Promise<ServiceReport> {
  const id = "images";
  const cfg = uploadConfig(env);
  if (!cfg) {
    return { id, state: "off", issues: ["Image uploads aren't set up on this site."], latency_ms: null, facts: [] };
  }
  const [bucket, served, scanner] = await Promise.all([
    // A signed listing of a prefix nothing uses: proves the endpoint, the
    // bucket and the keys in one request, and reads no member's data.
    withTimeout(listKeys(cfg.s3, "status-check/", 1), TIMEOUT_MS).then(
      () => true,
      () => false
    ),
    reach(cfg.publicBase, "HEAD"),
    // The pre-check only accepts an image with the token. Without one it
    // refuses, which still shows the scanner is up and listening.
    reach(cfg.precheckUrl),
  ]);
  const issues: string[] = [];
  if (!bucket) issues.push("Image storage didn't answer, so new images can't be uploaded.");
  if (!answering(scanner)) issues.push("The upload scanner didn't answer, so new images can't be uploaded.");
  if (!answering(served)) issues.push("The address uploaded images are served from didn't answer.");
  const word = (ok: boolean) => (ok ? "Answering" : "Not answering");
  let state: ServiceState = "ok";
  if (issues.length) state = !bucket && !answering(served) ? "unreachable" : "degraded";
  return {
    id,
    state,
    issues,
    latency_ms: null,
    facts: [
      { label: "Storage", value: word(bucket) },
      { label: "Upload scanner", value: word(answering(scanner)) },
      { label: "Served from", value: hostOf(cfg.publicBase) },
    ],
  };
}

// ---- Arweave gateway ------------------------------------------------------------

export async function checkArweave(template: string): Promise<ServiceReport> {
  const id = "arweave";
  const host = hostOf(template);
  const facts = host ? [{ label: "Gateway", value: host }] : [];
  let origin: string;
  try {
    origin = new URL(template).origin;
  } catch {
    return { id, state: "degraded", issues: ["The gateway address isn't a valid URL."], latency_ms: null, facts };
  }
  // Arweave gateways serve the network's /info. One that answers some other
  // way is still up; it just doesn't tell us the height.
  const r = await reach(`${origin}/info`);
  if (!r.res || isGatewayStatus(r.res.status)) {
    return {
      id,
      state: "unreachable",
      issues: [r.res ? `Answered with HTTP ${r.res.status}.` : r.reason],
      latency_ms: null,
      facts,
    };
  }
  if (r.res.ok) {
    try {
      const body = (await r.res.json()) as { height?: unknown };
      if (typeof body.height === "number") facts.push({ label: "Arweave height", value: n(body.height) });
    } catch {
      // Not the network's /info: reachable is all we learn.
    }
  }
  return { id, state: "ok", issues: [], latency_ms: r.ms, facts };
}

// ---- Chain archiver -------------------------------------------------------------

/** What the gateway's index says about one transaction; undefined when it can't say. */
async function arweaveTx(origin: string, id: string): Promise<ArweaveTx | null | undefined> {
  try {
    const res = await fetch(`${origin}/graphql`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // The id is 43 base64url characters (checkpointTxId), safe to inline.
      body: JSON.stringify({
        query: `{transaction(id:"${id}"){owner{address} tags{name value} block{timestamp}}}`,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    return parseArweaveTx(await res.json());
  } catch {
    return undefined;
  }
}

// A gateway's index can take several seconds over a wallet's transactions.
const INDEX_TIMEOUT_MS = 10_000;

/** A gateway's GraphQL answer, or undefined when it gave none. */
async function arweaveQuery(origin: string, query: string): Promise<unknown> {
  try {
    const res = await fetch(`${origin}/graphql`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
    });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

// How many of a wallet's latest ranges are read to find the one that reaches
// furthest: several can be mined in one Arweave block, in no set order. Kept
// small, since the index slows with every transaction it returns.
const NEWEST_RANGES = 5;
// A range is uploaded about every 16 hours and the index is slow, so its
// answer is asked for at most this often, and the last one stands in for a
// while when the index doesn't answer.
const NEWEST_RANGE_FRESH_MS = 5 * 60_000;
const NEWEST_RANGE_KEEP_MS = 60 * 60_000;
type NewestRange = NonNullable<ReturnType<typeof parseNewestRange>> | null;
const newestRanges = new Map<string, { at: number; newest: NewestRange }>();

const newestRangeRefreshes = new Map<string, Promise<NewestRange | undefined>>();

/**
 * The furthest range the wallets have uploaded: null for none, undefined
 * when it can't be said. Only the first call for a wallet waits for the
 * index. Later ones answer from the last result and, once it is no longer
 * fresh, ask again in the background, so a slow index never holds the
 * whole status response.
 */
async function newestRange(origin: string, owners: string[], chainId: string): Promise<NewestRange | undefined> {
  const key = `${origin}|${chainId}|${owners.join(",")}`;
  const had = newestRanges.get(key);
  const age = had ? Date.now() - had.at : Infinity;
  if (had && age < NEWEST_RANGE_FRESH_MS) return had.newest;

  let refresh = newestRangeRefreshes.get(key);
  if (!refresh) {
    const tags = [
      ["App-Name", ARCHIVE_APP_NAME],
      ["Chain-ID", chainId],
      ["Archive-Kind", "blocks"],
      ["Archive-Format", "1"],
    ]
      .map(([name, value]) => `{name:"${name}",values:["${value}"]}`)
      .join(",");
    const query = `{transactions(owners:[${owners.map((o) => `"${o}"`).join(",")}],tags:[${tags}],first:${NEWEST_RANGES},sort:HEIGHT_DESC){edges{node{tags{name value} block{timestamp} data{size}}}}}`;
    refresh = arweaveQuery(origin, query)
      .then((answer) => {
        const newest = answer === undefined ? undefined : parseNewestRange(answer);
        if (newest !== undefined) newestRanges.set(key, { at: Date.now(), newest });
        return newest;
      })
      .finally(() => newestRangeRefreshes.delete(key));
    newestRangeRefreshes.set(key, refresh);
  }
  // An answer that is not too old stands in while the new one is fetched.
  if (had && age < NEWEST_RANGE_KEEP_MS) return had.newest;
  return refresh;
}

/**
 * What Arweave shows of an archiver's worker: the newest range its listed
 * wallets signed, and what those wallets hold against the price of another
 * range that size. The wallets and the chain id go into the query, so both
 * are checked to be plain before they do.
 */
async function archiveWorker(origin: string, wallets: string[], chainId: string): Promise<ArchiveWorker | undefined> {
  const owners = wallets.filter((w) => /^[A-Za-z0-9_-]{43}$/.test(w)).slice(0, 5);
  if (owners.length === 0 || !/^[A-Za-z0-9._-]{1,64}$/.test(chainId)) return undefined;
  const [newest, balances] = await Promise.all([
    newestRange(origin, owners, chainId),
    Promise.all(owners.map((o) => walletBalance(origin, o))),
  ]);
  const balance = balances.every((b) => b !== null)
    ? balances.reduce((sum, b) => sum + BigInt(b as string), BigInt(0)).toString()
    : null;
  let rangePrice: string | null = null;
  if (newest && newest.size > 0) {
    const r = await reach(`${origin}/price/${newest.size}`);
    const text = r.res?.ok ? (await r.res.text().catch(() => "")).trim() : "";
    rangePrice = /^\d+$/.test(text) ? text : null;
  }
  return { newest: newest && { from: newest.from, to: newest.to, minedAt: newest.minedAt }, balance, rangePrice };
}

/**
 * The permanent copy of the block history: the chain-archiver operators and
 * their checkpoints from the chain, and the newest range's transaction from
 * the gateway's index. `lcd` is the node this server reads.
 */
export async function checkArchiver(lcd: string, chainId: string, gatewayTemplate: string): Promise<ServiceReport> {
  const id = "archiver";
  const base = lcd.replace(/\/+$/, "");
  const type = encodeURIComponent(CHAIN_ARCHIVER_SERVICE_TYPE);
  const page = "pagination.limit=200";
  const [cfg, ops, cps, block] = await Promise.all([
    reach(`${base}/sparkdream/service/v1/service_type/${type}`),
    reach(`${base}/sparkdream/service/v1/operators_by_service_type/${type}?${page}`),
    reach(`${base}/sparkdream/service/v1/checkpoints_by_service_type/${type}?${page}`),
    reach(`${base}/cosmos/base/tendermint/v1beta1/blocks/latest`),
  ]);
  const cantRead: ServiceReport = {
    id,
    state: "unreachable",
    issues: ["The chain couldn't be read, so the state of its permanent copy is unknown."],
    latency_ms: null,
    facts: [],
  };
  if (!cfg.res || isGatewayStatus(cfg.res.status)) return cantRead;

  let maxLagBlocks: number | null = null;
  let operators: Operator[] = [];
  let checkpoints: Checkpoint[] = [];
  let latestHeight = 0;
  // 404 is a chain without the type, 501 one without x/service at all.
  if (cfg.res.status !== 404 && cfg.res.status !== 501) {
    if (!cfg.res.ok || !ops.res?.ok || !cps.res?.ok) return cantRead;
    try {
      const config = ((await cfg.res.json()) as { config?: ServiceTypeConfig }).config;
      if (config?.enabled) maxLagBlocks = Number(config.checkpoint_max_lag_blocks || 0) || 0;
      operators = ((await ops.res.json()) as { operators?: Operator[] }).operators ?? [];
      checkpoints = ((await cps.res.json()) as { checkpoints?: Checkpoint[] }).checkpoints ?? [];
      if (block.res?.ok) {
        const header = ((await block.res.json()) as { block?: { header?: { height?: string } } }).block?.header;
        latestHeight = Number(header?.height) || 0;
      }
    } catch {
      return cantRead;
    }
  }

  let tx: ArweaveTx | null | undefined;
  let worker: ArchiveWorker | undefined;
  let keys: SessionNote[] = [];
  const leader = maxLagBlocks !== null ? leadingArchiver(operators, checkpoints) : null;
  const txId = checkpointTxId(leader?.checkpoint?.root ?? "");
  if (leader) {
    let origin = "";
    try {
      origin = new URL(gatewayTemplate).origin;
    } catch {
      // Not a URL: checkArweave reports that.
    }
    const wallets = parseArchiverMetadata(leader.operator.metadata)?.wallets ?? [];
    // Arweave and the chain are asked together: each can take its full timeout.
    [tx, worker, keys] = await Promise.all([
      origin && txId ? arweaveTx(origin, txId) : Promise.resolve(undefined),
      origin ? archiveWorker(origin, wallets, chainId) : Promise.resolve(undefined),
      sessionNotes(lcd, [{ address: leader.operator.address, who: "The archiver's" }], CHECKPOINT_MSG),
    ]);
  }
  const report = assessArchiver({ chainId, maxLagBlocks, operators, checkpoints, latestHeight, tx, worker, now: Date.now() });
  return withSessions(report, keys);
}

// ---- Permanent copies -----------------------------------------------------------

/** The JSON body of an answer that was 2xx, or null. */
async function okJson<T>(r: Reached): Promise<T | null> {
  if (!r.res?.ok) return null;
  try {
    return (await r.res.json()) as T;
  } catch {
    return null;
  }
}

/** The request fields the worker evidence reads: block heights as decimal strings. */
interface StoredRequest {
  created_at?: string;
  opened_at?: string;
  claimed_at?: string;
  completed_at?: string;
}

function height(v: string | undefined): number {
  return v && /^\d+$/.test(v) ? Number(v) : 0;
}

async function walletBalance(node: string, address: string): Promise<string | null> {
  const r = await reach(`${node}/wallet/${address}/balance`);
  if (!r.res?.ok) return null;
  const text = (await r.res.text().catch(() => "")).trim();
  return /^\d+$/.test(text) ? text : null;
}

/**
 * Permanent copies (x/storage): whether an approved, active, funded storage
 * operator and enough approved scanners are in place for the backend, and
 * what is waiting. `lcd` is the node this server reads.
 */
export async function checkStorage(
  lcd: string,
  gatewayTemplate: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ServiceReport> {
  const base = lcd.replace(/\/+$/, "");
  const storage = `${base}/sparkdream/storage/v1`;
  const service = `${base}/sparkdream/service/v1`;
  const page = "pagination.limit=200";
  const cantRead: ServiceReport = {
    id: "storage",
    state: "unreachable",
    issues: ["The chain couldn't be read, so the state of permanent copies is unknown."],
    latency_ms: null,
    facts: [],
  };
  const none = { operators: [], approvedOperators: [], scanners: [], approvedScanners: [], scannerQuorum: 0 };
  const idle = { ...none, pending: null, claimed: null, balances: {}, siteOffers: permanentCopiesOn(env) };

  const [paramsR, backendsR] = await Promise.all([reach(`${storage}/params`), reach(`${storage}/backends`)]);
  if (!paramsR.res || isGatewayStatus(paramsR.res.status)) return cantRead;
  // 501 is a chain without x/storage.
  if (paramsR.res.status === 501 || paramsR.res.status === 404) return assessStorage({ ...idle, enabled: null, backend: null });
  const params = await okJson<{ params?: { enabled?: boolean; claim_window_blocks?: string } }>(paramsR);
  const backends = await okJson<{ backends?: StorageBackend[] }>(backendsR);
  if (!params || !backends) return cantRead;
  const all = backends.backends ?? [];
  const backend = all.find((b) => b.enabled) ?? all[0] ?? null;
  const enabled = params.params?.enabled === true;
  if (!backend || !enabled || !backend.enabled) return assessStorage({ ...idle, enabled, backend });

  const name = encodeURIComponent(backend.name);
  const scannerType = encodeURIComponent(CONTENT_SCANNER_SERVICE_TYPE);
  const count = "pagination.limit=1&pagination.count_total=true";
  const storageType = encodeURIComponent(backend.service_type);
  const [opsR, approvedR, scannersR, approvedScannersR, scannerTypeR, pendingR, claimedR, blockR, checkpointsR, typeR] = await Promise.all([
    reach(`${service}/operators_by_service_type/${encodeURIComponent(backend.service_type)}?${page}`),
    reach(`${storage}/approved_operators/${name}?${page}`),
    reach(`${service}/operators_by_service_type/${scannerType}?${page}`),
    reach(`${storage}/approved_scanners?${page}`),
    reach(`${service}/service_type/${scannerType}`),
    // The whole first page, for how long the oldest has waited.
    reach(`${storage}/requests_by_status/${name}/REQUEST_STATUS_PENDING?${page}&pagination.count_total=true`),
    reach(`${storage}/requests_by_status/${name}/REQUEST_STATUS_CLAIMED?${count}`),
    reach(`${base}/cosmos/base/tendermint/v1beta1/blocks/latest`),
    reach(`${service}/checkpoints_by_service_type/${storageType}?${page}`),
    reach(`${service}/service_type/${storageType}`),
  ]);
  const ops = await okJson<{ operators?: Operator[] }>(opsR);
  const approved = await okJson<{ operators?: ApprovedOperator[] }>(approvedR);
  const scanners = await okJson<{ operators?: Operator[] }>(scannersR);
  const approvedScanners = await okJson<{ scanners?: ApprovedScanner[] }>(approvedScannersR);
  if (!ops || !approved || !scanners || !approvedScanners) return cantRead;
  // A chain without the scanner type has no quorum: the same as a quorum of 0.
  const scannerConfig = (await okJson<{ config?: ServiceTypeConfig }>(scannerTypeR))?.config;
  type Listed = { requests?: StoredRequest[]; pagination?: { total?: string } } | null;
  const total = (body: Listed) => {
    const t = body?.pagination?.total;
    return t && /^\d+$/.test(t) ? Number(t) : null;
  };
  const pendingBody = await okJson<NonNullable<Listed>>(pendingR);
  const claimedBody = await okJson<NonNullable<Listed>>(claimedR);

  const operators = ops.operators ?? [];
  const approvedOperators = approved.operators ?? [];
  const node = arweaveNodeOf(gatewayTemplate);
  const wallets = [
    ...new Set(fundedOperators(operators, approvedOperators).flatMap((o) => operatorWallets(o.metadata, backend.name))),
  ].slice(0, 10);
  const balances: Record<string, string | null> = {};
  // What a file of the largest size the backend takes costs now.
  const largest = largestFileBytes(backend);
  const largestFilePriceP =
    wallets.length > 0 && largest > 0
      ? reach(`${node}/price/${largest}`).then(async (r) => {
          const text = r.res?.ok ? (await r.res.text().catch(() => "")).trim() : "";
          return /^\d+$/.test(text) ? text : null;
        })
      : Promise.resolve(null);
  const ready = readyOperators(operators, approvedOperators).slice(0, 5);
  const [, acts] = await Promise.all([
    Promise.all(
      wallets.map(async (w) => {
        balances[w] = await walletBalance(node, w);
      })
    ),
    // What each ready operator's worker has done: its newest requests and its lapse count.
    Promise.all(
      ready.map(async (o) => {
        const at = encodeURIComponent(o.address);
        const [mineR, standingR] = await Promise.all([
          reach(`${storage}/requests_by_operator/${at}?pagination.limit=50&pagination.reverse=true`),
          reach(`${storage}/operator_standing/${name}/${at}`),
        ]);
        const mine = (await okJson<{ requests?: StoredRequest[] }>(mineR))?.requests ?? [];
        const standing = await okJson<{ lapses?: { count?: string } }>(standingR);
        return {
          lastActedAt: Math.max(0, ...mine.flatMap((r) => [height(r.claimed_at), height(r.completed_at)])),
          lapses: height(standing?.lapses?.count),
        };
      })
    ),
  ]);
  const latestHeight = height((await okJson<{ block?: { header?: { height?: string } } }>(blockR))?.block?.header?.height);
  const waiting = (pendingBody?.requests ?? []).map((r) => height(r.opened_at) || height(r.created_at)).filter((h) => h > 0);
  const lastActedAt = Math.max(0, ...acts.map((a) => a.lastActedAt));
  // The newest checkpoint among the ready operators: one running worker is enough.
  const mine = new Set(ready.map((o) => o.address));
  const checkpoint = ((await okJson<{ checkpoints?: Checkpoint[] }>(checkpointsR))?.checkpoints ?? [])
    .filter((c) => mine.has(c.operator))
    .map((c) => ({ height: height(c.height), wallet: checkpointWallet(c.root) }))
    .sort((a, b) => b.height - a.height)[0];
  const typeConfig = (await okJson<{ config?: ServiceTypeConfig }>(typeR))?.config;
  const worker: WorkerEvidence | undefined =
    latestHeight > 0 && pendingBody
      ? {
          latestHeight,
          lastActedAt: lastActedAt > 0 ? lastActedAt : null,
          lapses: acts.reduce((sum, a) => sum + a.lapses, 0),
          oldestWaitingSince: waiting.length ? Math.min(...waiting) : null,
          stuckAfterBlocks: height(params.params?.claim_window_blocks),
          checkpoint: checkpoint && checkpoint.height > 0 ? checkpoint : null,
          checkpointMaxLag: height(typeConfig?.checkpoint_max_lag_blocks),
        }
      : undefined;

  // The key each worker holds, shown for an operator still waiting for its
  // approval too, so it can see the key was granted. One key has to cover
  // the whole of a request's life; the check-in is the operator's to leave out.
  const keyed = fundedOperators(operators, approvedOperators).slice(0, 5);
  const keys = await sessionNotes(
    lcd,
    keyed.map((o) => ({ address: o.address, who: keyed.length > 1 ? "A storage worker's" : "The storage worker's" })),
    "/sparkdream.storage.v1.MsgClaimRequest",
    {
      required: [
        "/sparkdream.storage.v1.MsgExtendClaim",
        "/sparkdream.storage.v1.MsgCompleteRequest",
        "/sparkdream.storage.v1.MsgDeclineRequest",
      ],
      optional: [CHECKPOINT_MSG],
    }
  );
  return withSessions(assessStorage({
    enabled,
    backend,
    operators,
    approvedOperators,
    scanners: scanners.operators ?? [],
    approvedScanners: approvedScanners.scanners ?? [],
    scannerQuorum: scannerConfig?.enabled ? Number(scannerConfig.attestation_quorum) || 0 : 0,
    pending: total(pendingBody),
    claimed: total(claimedBody),
    balances,
    largestFilePrice: await largestFilePriceP,
    worker,
    siteOffers: permanentCopiesOn(env),
  }), keys);
}

// ---- Validators -----------------------------------------------------------------

interface PubKey {
  key?: string;
}

/** The address CometBFT signs a commit under: the first 20 bytes of the key's sha256. */
function consensusBytes(pubkeyBase64: string): Buffer {
  return createHash("sha256").update(Buffer.from(pubkeyBase64, "base64")).digest().subarray(0, 20);
}

// A moniker is whatever its validator typed: shown as text, and not at any length.
function moniker(text: string | undefined): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean;
}

/**
 * The validator set behind the node this server reads: the active set and
 * its voting power, who signed the last block, the record of missed blocks,
 * and who is jailed. `lcd` is that node.
 */
export async function checkValidators(lcd: string): Promise<ServiceReport> {
  const base = lcd.replace(/\/+$/, "");
  const tm = `${base}/cosmos/base/tendermint/v1beta1`;
  const page = "pagination.limit=500";
  const [blockR, latestSetR, stakingR, stakingParamsR, signingR, slashingParamsR] = await Promise.all([
    reach(`${tm}/blocks/latest`),
    reach(`${tm}/validatorsets/latest?${page}`),
    reach(`${base}/cosmos/staking/v1beta1/validators?${page}`),
    reach(`${base}/cosmos/staking/v1beta1/params`),
    reach(`${base}/cosmos/slashing/v1beta1/signing_infos?${page}`),
    reach(`${base}/cosmos/slashing/v1beta1/params`),
  ]);
  type SetBody = { validators?: { address?: string; pub_key?: PubKey; voting_power?: string }[] };

  // Who signed the last block, by the address CometBFT records. The block
  // carries the commit of the one before it, signed by the set of that
  // height: the signatures are held against that set, not the newest, so a
  // validator that has just joined is not counted as having missed it.
  const commit = (
    await okJson<{
      block?: { last_commit?: { height?: string; signatures?: { block_id_flag?: string; validator_address?: string }[] } };
    }>(blockR)
  )?.block?.last_commit;
  let signers = commit?.signatures
    ? new Set(commit.signatures.filter((sig) => sig.block_id_flag === "BLOCK_ID_FLAG_COMMIT").map((sig) => sig.validator_address ?? ""))
    : null;
  let set = commit?.height && /^\d+$/.test(commit.height)
    ? (await okJson<SetBody>(await reach(`${tm}/validatorsets/${commit.height}?${page}`)))?.validators
    : undefined;
  if (!set) {
    // The set of that height can't be had (a pruned node): the newest stands in, without the signatures.
    set = (await okJson<SetBody>(latestSetR))?.validators;
    signers = null;
  }
  if (!set) return assessValidators({ active: [], jailed: [], maxValidators: 0, window: 0, maxMissed: 0 });

  // Names come from x/staking, matched by consensus key.
  const staking =
    (
      await okJson<{
        validators?: { description?: { moniker?: string }; jailed?: boolean; consensus_pubkey?: PubKey }[];
      }>(stakingR)
    )?.validators ?? [];
  const monikers = new Map(staking.map((v) => [v.consensus_pubkey?.key ?? "", moniker(v.description?.moniker)]));

  // Missed blocks and tombstones, by the validator's consensus address (the set's own).
  const infos =
    (await okJson<{ info?: { address?: string; missed_blocks_counter?: string; tombstoned?: boolean }[] }>(signingR))?.info ?? null;
  const missed = new Map((infos ?? []).map((i) => [i.address ?? "", Number(i.missed_blocks_counter) || 0]));
  const tombstoned = new Set((infos ?? []).filter((i) => i.tombstoned).map((i) => i.address ?? ""));

  const active: ActiveValidator[] = set.map((v) => {
    const key = v.pub_key?.key ?? "";
    return {
      moniker: monikers.get(key) ?? "",
      power: Number(v.voting_power) || 0,
      signed: signers && key ? signers.has(consensusBytes(key).toString("base64")) : null,
      missed: infos ? (missed.get(v.address ?? "") ?? 0) : null,
    };
  });

  const slashing = (await okJson<{ params?: { signed_blocks_window?: string; min_signed_per_window?: string } }>(slashingParamsR))?.params;
  const window = Number(slashing?.signed_blocks_window) || 0;
  const minSigned = Number(slashing?.min_signed_per_window);
  // A jailed validator has left the set, so its consensus address is worked
  // out from its key, under the prefix the chain's own addresses carry.
  const sample = set[0]?.address ?? infos?.[0]?.address ?? "";
  const prefix = sample.slice(0, sample.lastIndexOf("1"));
  const consensusAddress = (key: string): string => {
    try {
      return prefix && key ? toBech32(prefix, consensusBytes(key)) : "";
    } catch {
      return "";
    }
  };
  return assessValidators({
    active,
    jailed: staking
      .filter((v) => v.jailed)
      .map((v) => ({
        moniker: moniker(v.description?.moniker),
        tombstoned: tombstoned.has(consensusAddress(v.consensus_pubkey?.key ?? "")),
      })),
    maxValidators: Number((await okJson<{ params?: { max_validators?: number } }>(stakingParamsR))?.params?.max_validators) || 0,
    window,
    maxMissed: window > 0 && Number.isFinite(minSigned) ? Math.floor(window * (1 - minSigned)) : 0,
  });
}

// ---- Governance -----------------------------------------------------------------

interface RawProposal {
  id?: string;
  status?: string;
  voting_start_time?: string;
  voting_end_time?: string;
}

function proposalOf(p: RawProposal, turnout: number | null = null): GovProposal {
  const at = (t: string | undefined) => {
    const ms = Date.parse(t ?? "");
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  };
  return {
    id: p.id ?? "?",
    status: p.status ?? "",
    votingStart: at(p.voting_start_time),
    votingEnd: at(p.voting_end_time),
    turnout,
  };
}

/**
 * Chain governance: the proposals in voting with how much of the voting
 * power has voted, the last one decided, and a scheduled upgrade. `lcd` is
 * the node this server reads.
 */
export async function checkGovernance(lcd: string): Promise<ServiceReport> {
  const base = lcd.replace(/\/+$/, "");
  const gov = `${base}/cosmos/gov/v1`;
  const [votingR, depositR, recentR, paramsR, poolR, planR, blockR] = await Promise.all([
    reach(`${gov}/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD&pagination.limit=100`),
    reach(`${gov}/proposals?proposal_status=PROPOSAL_STATUS_DEPOSIT_PERIOD&pagination.limit=100`),
    reach(`${gov}/proposals?proposal_status=PROPOSAL_STATUS_FAILED&pagination.reverse=true&pagination.limit=5`),
    reach(`${gov}/params/tallying`),
    reach(`${base}/cosmos/staking/v1beta1/pool`),
    reach(`${base}/cosmos/upgrade/v1beta1/current_plan`),
    reach(`${base}/cosmos/base/tendermint/v1beta1/blocks/latest`),
  ]);
  const none = { inDeposit: null, failed: [], quorum: 0, upgrade: null, latestHeight: null, latestBlockAt: null, now: Date.now() };
  if (!votingR.res || isGatewayStatus(votingR.res.status)) {
    return { id: "governance", state: "unreachable", issues: ["The chain couldn't be read, so its governance is unknown."], latency_ms: null, facts: [] };
  }
  // 501 is a chain without x/gov v1.
  if (votingR.res.status === 501 || votingR.res.status === 404) return assessGov({ ...none, voting: null });
  const voting = (await okJson<{ proposals?: RawProposal[] }>(votingR))?.proposals;
  if (!voting) {
    return { id: "governance", state: "unreachable", issues: ["The chain's proposals couldn't be read."], latency_ms: null, facts: [] };
  }

  // Turnout: the votes cast so far against the bonded voting power.
  const bonded = BigInt((await okJson<{ pool?: { bonded_tokens?: string } }>(poolR))?.pool?.bonded_tokens?.match(/^\d+$/)?.[0] ?? "0");
  const tallied = await Promise.all(
    voting.slice(0, 5).map(async (p) => {
      const r = await reach(`${gov}/proposals/${encodeURIComponent(p.id ?? "")}/tally`);
      const t = (await okJson<{ tally?: Record<string, string> }>(r))?.tally;
      if (!t || bonded <= BigInt(0)) return proposalOf(p);
      const cast = ["yes_count", "abstain_count", "no_count", "no_with_veto_count"].reduce(
        (sum, k) => sum + BigInt(/^\d+$/.test(t[k] ?? "") ? t[k] : "0"),
        BigInt(0)
      );
      return proposalOf(p, Number((cast * BigInt(1_000_000)) / bonded) / 1_000_000);
    })
  );
  // The newest proposals that failed when carried out; the judging keeps those of the past week.
  const failed = ((await okJson<{ proposals?: RawProposal[] }>(recentR))?.proposals ?? [])
    .filter((p) => p.status === "PROPOSAL_STATUS_FAILED")
    .map((p) => proposalOf(p));
  const params = await okJson<{ params?: { quorum?: string }; tally_params?: { quorum?: string } }>(paramsR);
  const plan = (await okJson<{ plan?: { name?: string; height?: string } | null }>(planR))?.plan;
  const header = (await okJson<{ block?: { header?: { height?: string; time?: string } } }>(blockR))?.block?.header;
  const blockAt = Date.parse(header?.time ?? "");
  return assessGov({
    voting: [...tallied, ...voting.slice(5).map((p) => proposalOf(p))],
    inDeposit: (await okJson<{ proposals?: unknown[] }>(depositR))?.proposals?.length ?? null,
    failed,
    quorum: Number(params?.params?.quorum ?? params?.tally_params?.quorum) || 0,
    upgrade: plan?.name && plan.height && /^\d+$/.test(plan.height) ? { name: moniker(plan.name), height: Number(plan.height) } : null,
    latestHeight: header?.height && /^\d+$/.test(header.height) ? Number(header.height) : null,
    latestBlockAt: Number.isFinite(blockAt) ? blockAt : null,
    now: Date.now(),
  });
}

// ---- Anonymous actions ----------------------------------------------------------

// What a prover release holds (the chain repo's prepare-release.sh builds them).
const PROVER_FILES = ["shield.wasm", "wasm_exec.js", "proving_key.raw.bin", "circuit.r1cs"];

/** Whether ZK_DIGESTS pins any file's digest, by the rule /api/config applies before handing them to the browser. */
function pinsDigests(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return Object.values(parsed as Record<string, unknown>).some((v) => typeof v === "string" && /^[0-9a-fA-F]{64}$/.test(v));
  } catch {
    return false;
  }
}

/**
 * Whether the prover files for `version` are where the browser will look
 * for them: under ZK_ASSETS_URL when that is an address, or in this site's
 * own public/zk directory. Returns what is wrong, or null. The files'
 * contents are not hashed here (the browser does that before using them).
 */
export async function proverProblem(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  publicDir: string = path.join(process.cwd(), "public")
): Promise<string | null> {
  // The version becomes part of a path: a plain release name, never "." or "..".
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(version) || version.includes("..")) {
    return "The chain's version can't be read, so the prover files can't be looked up.";
  }
  const base = (env.ZK_ASSETS_URL || env.NEXT_PUBLIC_ZK_ASSETS_URL || "/zk").replace(/\/+$/, "");
  const missing = `The prover files for ${version} aren't published.`;
  const wrong = `The prover manifest for ${version} isn't valid.`;
  // With the files' digests pinned in the site's settings the browser never
  // reads the manifest, so its absence is not a fault: only the files count.
  // Read as /api/config reads them for the browser: valid JSON holding at least one digest.
  const digestsPinned = pinsDigests(env.ZK_DIGESTS || env.NEXT_PUBLIC_ZK_DIGESTS);
  const checkManifest = (raw: string): string | null => {
    try {
      const manifest = JSON.parse(raw) as { version?: string; files?: Record<string, unknown> };
      if (manifest.version !== version || !manifest.files) return wrong;
      return PROVER_FILES.every((f) => typeof manifest.files?.[f] === "string") ? null : wrong;
    } catch {
      return wrong;
    }
  };
  if (/^https?:\/\//.test(base)) {
    if (!digestsPinned) {
      const r = await reach(`${base}/${version}/manifest.json`);
      if (!r.res?.ok) return missing;
      const bad = checkManifest(await r.res.text().catch(() => ""));
      if (bad) return bad;
    }
    const heads = await Promise.all(PROVER_FILES.map((f) => reach(`${base}/${version}/${f}`, "HEAD")));
    if (heads.every((h) => !h.res?.ok)) return missing;
    return heads.every((h) => h.res?.ok) ? null : `Some prover files for ${version} are missing.`;
  }
  // Served by this site from its public directory.
  const dir = path.join(publicDir, base.replace(/^\/+/, ""), version);
  if (!digestsPinned) {
    try {
      const bad = checkManifest(await readFile(path.join(dir, "manifest.json"), "utf8"));
      if (bad) return bad;
    } catch {
      return missing;
    }
  }
  const present = await Promise.all(PROVER_FILES.map((f) => stat(path.join(dir, f)).then((st) => st.size > 0, () => false)));
  if (!present.some(Boolean)) return missing;
  return present.every(Boolean) ? null : `Some prover files for ${version} are missing.`;
}

/**
 * Anonymous actions (x/shield): the reserve that pays for them and whether
 * it can be refilled, the chain's verification key, the prover files for the
 * chain's version, and the validators' key where encrypted batches are on.
 * `lcd` is the node this server reads.
 */
export async function checkShield(
  lcd: string,
  units: ChainUnits = chainUnits(),
  env: NodeJS.ProcessEnv = process.env
): Promise<ServiceReport> {
  const base = lcd.replace(/\/+$/, "");
  const shield = `${base}/sparkdream/shield/v1`;
  const day = Math.floor(Date.now() / 86_400_000);
  const [paramsR, balanceR, fundedR, poolR, keyR, pendingR, keySetR, infoR] = await Promise.all([
    reach(`${shield}/params`),
    reach(`${shield}/module_balance`),
    reach(`${shield}/day_funding/${day}`),
    reach(`${base}/cosmos/distribution/v1beta1/community_pool`),
    reach(`${shield}/verification_key/shield_v1`),
    reach(`${shield}/pending_op_count`),
    reach(`${shield}/tle_key_set`),
    reach(`${base}/cosmos/base/tendermint/v1beta1/node_info`),
  ]);
  const blank = {
    balance: null,
    minReserve: null,
    maxFeePerExec: null,
    fundingLeftToday: null,
    communityPool: null,
    hasVerificationKey: null,
    prover: null,
    batches: null,
  };
  if (!paramsR.res || isGatewayStatus(paramsR.res.status)) {
    return { id: "shield", state: "unreachable", issues: ["The chain couldn't be read, so the state of anonymous actions is unknown."], latency_ms: null, facts: [] };
  }
  if (paramsR.res.status === 501 || paramsR.res.status === 404) return assessShield({ ...blank, enabled: null });
  const params = (
    await okJson<{
      params?: {
        enabled?: boolean;
        min_gas_reserve?: string;
        max_funding_per_day?: string;
        max_fee_per_exec?: string;
        encrypted_batch_enabled?: boolean;
      };
    }>(paramsR)
  )?.params;
  if (!params) {
    return { id: "shield", state: "unreachable", issues: ["The chain's anonymous-action settings couldn't be read."], latency_ms: null, facts: [] };
  }
  if (!params.enabled) return assessShield({ ...blank, enabled: false });

  const micro = (v: string | undefined): bigint | null => (v !== undefined && /^\d+$/.test(v) ? BigInt(v) : null);
  const balance = micro((await okJson<{ balance?: { amount?: string } }>(balanceR))?.balance?.amount);
  const cap = micro(params.max_funding_per_day);
  // The chain answers 0 for a day with no funding yet.
  const funded = micro((await okJson<{ day_funding?: { amount_funded?: string } }>(fundedR))?.day_funding?.amount_funded);
  const pool = (await okJson<{ pool?: { denom?: string; amount?: string }[] }>(poolR))?.pool;
  const held = pool ? (pool.find((c) => c.denom === units.denom)?.amount ?? "0") : null;

  // The key answers 404 when the chain has none.
  const hasVerificationKey = keyR.res?.ok ? true : keyR.res?.status === 404 ? false : null;
  // The browser loads the prover named by ZK_VERSION, or else the chain's own
  // version, and then refuses one that isn't built for the version the chain
  // runs (lib/shieldClient.ts). So a pin that has fallen behind the chain is
  // a prover nobody can use, however well its files are published.
  const chainVersion = (await okJson<{ application_version?: { version?: string } }>(infoR))?.application_version?.version || "";
  const pinned = env.ZK_VERSION || env.NEXT_PUBLIC_ZK_VERSION || "";
  const version = pinned || chainVersion;
  const proverOf = async (): Promise<string | null> => {
    if (pinned && chainVersion && pinned !== chainVersion) {
      return `This site's prover is pinned to ${pinned}, but the chain runs ${chainVersion}.`;
    }
    return proverProblem(version, env);
  };
  const pending = (await okJson<{ count?: string }>(pendingR))?.count;
  const keySet = (await okJson<{ key_set?: { master_public_key?: string | null } }>(keySetR))?.key_set;

  return assessShield({
    enabled: true,
    balance,
    minReserve: micro(params.min_gas_reserve),
    maxFeePerExec: micro(params.max_fee_per_exec),
    fundingLeftToday: cap !== null && funded !== null ? (cap > funded ? cap - funded : BigInt(0)) : null,
    // The pool holds decimal amounts: the whole part is what can be drawn.
    communityPool: held !== null && /^\d+(\.\d+)?$/.test(held) ? BigInt(held.split(".")[0]) : null,
    hasVerificationKey,
    prover: version ? { version, problem: await proverOf() } : null,
    batches: keySet ? { enabled: params.encrypted_batch_enabled === true, hasKey: !!keySet.master_public_key, pending: pending && /^\d+$/.test(pending) ? Number(pending) : null } : null,
    symbol: units.symbol,
  });
}

// ---- Certificates ---------------------------------------------------------------

export type CertProbe = (host: string) => Promise<CertReading>;

/**
 * Ask a host for its certificate. The handshake is completed even when the
 * certificate wouldn't be accepted, so that an expired one can be read and
 * said to be expired; nothing is sent over the connection.
 */
export const readCertificate = (host: string, port = 443, timeoutMs = TIMEOUT_MS): Promise<CertReading> =>
  new Promise((resolve) => {
    const none: CertReading = { host, expiresAt: null, refused: null, unreachable: true };
    let done = false;
    const finish = (reading: CertReading) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(reading);
    };
    const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      const expires = Date.parse(cert?.valid_to ?? "");
      finish({
        host,
        expiresAt: Number.isFinite(expires) ? expires : null,
        refused: socket.authorized ? null : String(socket.authorizationError || "not trusted"),
        unreachable: false,
      });
    });
    socket.setTimeout(timeoutMs, () => finish(none));
    socket.on("error", () => finish(none));
  });

/**
 * The certificates of the https addresses this site is set up with. Only
 * addresses from the site's own settings are asked, never one read from the
 * chain.
 */
export async function checkCertificates(
  urls: (string | undefined)[],
  probe: CertProbe = (host) => readCertificate(host)
): Promise<ServiceReport> {
  const hosts = httpsHosts(urls).slice(0, 8);
  const readings = await Promise.all(
    hosts.map((host) => probe(host).catch((): CertReading => ({ host, expiresAt: null, refused: null, unreachable: true })))
  );
  return assessCerts(readings, Date.now());
}

// ---- Federation bridges ---------------------------------------------------------

// The same bound as the rows the card lists (lib/bridgeStatus.ts).
const MAX_ENDPOINTS = 5;

/** Whether an endpoint answers: null when it isn't an address this server will contact. */
export type EndpointProbe = (endpoint: string) => Promise<boolean | null>;

const probeEndpoint: EndpointProbe = async (endpoint) => {
  const target = await publicHttpsTarget(endpoint);
  if (!target) return null;
  const status = await headPinned(target, TIMEOUT_MS);
  // Any answer of the server's own counts, a redirect or a refusal of HEAD included.
  return status !== null && !isGatewayStatus(status);
};

/** A protobuf Duration in JSON ("43200s") as seconds; 0 if it isn't one. */
function durationSeconds(v: unknown): number {
  const m = typeof v === "string" ? /^(\d+)(?:\.\d+)?s$/.exec(v) : null;
  return m ? Number(m[1]) : 0;
}

const VERIFIER_ROLE = "ROLE_TYPE_FEDERATION_VERIFIER";
const VERIFY_MSG = "/sparkdream.federation.v1.MsgVerifyContent";

/**
 * The verifiers of what the bridges bring in: the holders of the bonded
 * verifier role (x/rep), what they have verified, and the bridged posts
 * still waiting for one. Undefined when the role's holders can't be read.
 */
async function bridgeVerifiers(lcd: string): Promise<{ input: VerifierInput; addresses: string[] } | undefined> {
  const base = lcd.replace(/\/+$/, "");
  const federation = `${base}/sparkdream/federation/v1`;
  const pendingQuery = "status=FEDERATED_CONTENT_STATUS_PENDING_VERIFICATION&pagination.count_total=true";
  const [rolesR, configR, pendingR] = await Promise.all([
    reach(`${base}/sparkdream/rep/v1/bonded_roles_by_type/${VERIFIER_ROLE}?pagination.limit=200`),
    reach(`${base}/sparkdream/rep/v1/bonded_role_config/${VERIFIER_ROLE}`),
    // The list is in id order, so its first entry has waited longest.
    reach(`${federation}/list_federated_content?${pendingQuery}&pagination.limit=1`),
  ]);
  const roles = (await okJson<{ bonded_roles?: (VerifierRole & { address?: string })[] }>(rolesR))?.bonded_roles;
  if (!roles) return undefined;
  const minBond = (await okJson<{ bonded_role_config?: { min_bond?: string } }>(configR))?.bonded_role_config?.min_bond ?? "0";
  // Those the chain lets verify come first: theirs are the keys worth showing.
  const able = roles.filter((r) => canVerify(r, minBond));
  const addresses = [...able, ...roles.filter((r) => !able.includes(r))].map((r) => r.address || "").filter(Boolean);
  // A total over some of the verifiers would read as the whole: with too many to ask, none is given.
  const asked = addresses.length <= MAX_SESSION_OWNERS ? addresses : [];
  const now = Date.now();
  const ableAddresses = able.map((r) => r.address || "").filter(Boolean);
  // Asked together: what each has verified, and each able one's overturn
  // cooldown. The cooldown is on the role's activity record in x/rep, in
  // unix seconds: 0, or a time already past, is a verifier that may verify,
  // and so is one with no activity record yet.
  const [counts, cooldowns] = await Promise.all([
    Promise.all(
      asked.map(async (a) => {
        const r = await reach(`${federation}/verifier_activity/${encodeURIComponent(a)}`);
        const total = (await okJson<{ activity?: { total_verifications?: string } }>(r))?.activity?.total_verifications;
        return total && /^\d+$/.test(total) ? Number(total) : r.res?.status === 404 ? 0 : null;
      })
    ),
    asked.length === addresses.length
      ? Promise.all(
          ableAddresses.map(async (a) => {
            const r = await reach(`${base}/sparkdream/rep/v1/role_activity/${VERIFIER_ROLE}/${encodeURIComponent(a)}`);
            if (r.res?.status === 404) return 0;
            if (!r.res?.ok) return null;
            const until = (await okJson<{ role_activity?: { overturn_cooldown_until?: string } }>(r))?.role_activity
              ?.overturn_cooldown_until;
            // A zero the node left out of its answer is still zero.
            if (until === undefined) return 0;
            return /^\d+$/.test(until) ? Number(until) * 1000 : null;
          })
        )
      : Promise.resolve(null),
  ]);
  const cooldownsRead = cooldowns !== null && cooldowns.every((c) => c !== null);
  const locked = cooldownsRead ? (cooldowns as number[]).filter((c) => c > now) : [];
  const pending = await okJson<{ content?: { received_at?: string }[]; pagination?: { total?: string } }>(pendingR);
  const total = pending?.pagination?.total;
  const oldest = pending?.content?.[0]?.received_at;
  return {
    addresses,
    input: {
      holders: roles.length,
      able: able.length,
      cooling: cooldownsRead ? locked.length : null,
      coolingEndsAt: locked.length ? Math.min(...locked) : null,
      verified:
        asked.length === addresses.length && counts.every((c) => c !== null)
          ? counts.reduce<number>((sum, c) => sum + (c ?? 0), 0)
          : null,
      pending: total && /^\d+$/.test(total) ? Number(total) : null,
      oldestPendingAt: oldest && /^\d+$/.test(oldest) && Number(oldest) > 0 ? Number(oldest) * 1000 : null,
    },
  };
}

/**
 * The federation bridges (x/federation): each binding with its operator's
 * and its peer's status, and how long since it last brought a post in.
 * `lcd` is the node this server reads.
 *
 * Each binding's endpoint (the peer's server) is asked whether it answers.
 * It is an address an operator wrote on chain, so only a public https origin
 * is contacted, at the address that was checked (lib/publicUrl.ts), with a
 * bare HEAD that follows no redirect, and nothing of the answer is reported
 * but that one came. `probe` stands in for that request in tests.
 */
export async function checkBridges(
  lcd: string,
  probe: EndpointProbe = probeEndpoint,
  units: ChainUnits = chainUnits()
): Promise<ServiceReport> {
  const base = lcd.replace(/\/+$/, "");
  const federation = `${base}/sparkdream/federation/v1`;
  const page = "pagination.limit=200";
  const cantRead: ServiceReport = {
    id: "bridges",
    state: "unreachable",
    issues: ["The chain couldn't be read, so the state of the federation bridges is unknown."],
    latency_ms: null,
    facts: [],
  };
  const [bindingsR, peersR, paramsR, opsR] = await Promise.all([
    reach(`${federation}/list_bridge_bindings?${page}`),
    reach(`${federation}/list_peers?${page}`),
    reach(`${federation}/params`),
    reach(`${base}/sparkdream/service/v1/operators?${page}`),
  ]);
  if (!bindingsR.res || isGatewayStatus(bindingsR.res.status)) return cantRead;
  const none = { peers: {}, operators: [], inactivitySeconds: 0, now: Date.now() };
  // 501 is a chain without x/federation.
  if (bindingsR.res.status === 501 || bindingsR.res.status === 404) return assessBridges({ ...none, bindings: null });
  const bindings = await okJson<{ bridge_bindings?: BridgeBinding[] }>(bindingsR);
  const ops = await okJson<{ operators?: Operator[] }>(opsR);
  if (!bindings || !ops) return cantRead;

  const peers: Record<string, string> = {};
  for (const p of (await okJson<{ peers?: { id?: string; status?: string }[] }>(peersR))?.peers ?? []) {
    if (p.id && p.status) peers[p.id] = p.status;
  }
  // The chain warns after more than `threshold` whole rate-limit windows.
  const params = (await okJson<{ params?: { rate_limit_window?: string; bridge_inactivity_threshold?: string } }>(paramsR))?.params;
  const inactivitySeconds =
    durationSeconds(params?.rate_limit_window) * ((Number(params?.bridge_inactivity_threshold) || 0) + 1);

  const all = bindings.bridge_bindings ?? [];
  // The verifiers matter only where there is a bridge whose posts need them.
  // Asked for now, alongside the endpoints, and awaited below.
  const verifiersP = all.length > 0 ? bridgeVerifiers(lcd) : Promise.resolve(undefined);
  const reachable: Record<string, boolean | null> = {};
  await Promise.all(
    [...new Set(all.map((b) => b.endpoint).filter(Boolean))].slice(0, MAX_ENDPOINTS).map(async (endpoint) => {
      reachable[endpoint] = await probe(endpoint).catch(() => false);
    })
  );

  // One key per bridge operator, however many peers it is bound to.
  const owners = [...new Set(all.map((b) => b.address))];
  // Reports nobody has resolved yet, per bridge operator and the type it is registered under.
  const bridgeOperators = (ops.operators ?? []).filter((o) => o.service_type.startsWith(BRIDGE_SERVICE_TYPE_PREFIX));
  const openReports: Record<string, number | null> = {};
  const reportsP = Promise.all(
    owners.slice(0, MAX_SESSION_OWNERS).map(async (address) => {
      const mine = bridgeOperators.filter((o) => o.address === address);
      // The chain filters by status, so a long history of closed reports
      // can't push the open ones off the page.
      const counts = await Promise.all(
        mine.flatMap((o) =>
          ["REPORT_STATUS_PENDING", "REPORT_STATUS_ESCALATED"].map(async (status) => {
            const r = await reach(
              `${base}/sparkdream/service/v1/reports_by_operator/${encodeURIComponent(address)}/${encodeURIComponent(o.service_type)}?status_filter=${status}&pagination.limit=200`
            );
            const reports = (await okJson<{ reports?: { status?: string }[] }>(r))?.reports;
            return reports ? reports.filter((x) => x.status === status).length : null;
          })
        )
      );
      openReports[address] = counts.every((c) => c !== null) ? counts.reduce<number>((sum, c) => sum + (c ?? 0), 0) : null;
    })
  );
  const verifiers = await verifiersP;
  const [keys, verifierKeys] = await Promise.all([
    sessionNotes(
      lcd,
      owners.map((address) => ({ address, who: owners.length > 1 ? "A bridge's" : "The bridge's" })),
      "/sparkdream.federation.v1.MsgSubmitFederatedContent"
    ),
    sessionNotes(
      lcd,
      (verifiers?.addresses ?? []).map((address) => ({
        address,
        who: (verifiers?.addresses.length ?? 0) > 1 ? "A verifier's" : "The verifier's",
      })),
      VERIFY_MSG
    ),
    reportsP,
  ]);
  const report = assessBridges({
    bindings: all,
    reachable,
    peers,
    operators: bridgeOperators,
    inactivitySeconds,
    openReports,
    bondSymbol: units.symbol,
    verifiers: verifiers?.input,
    now: Date.now(),
  });
  return withSessions(withSessions(report, keys, "Bridge session key"), verifierKeys, "Verifier session key");
}

// ---- IBC relayer ----------------------------------------------------------------

interface IbcPeer {
  id?: string;
  display_name?: string;
  status?: string;
  ibc_channel_id?: string;
  ibc_transfer_channel_id?: string;
  /** The peer chain's own denominations, given when it was registered. */
  peer_identity?: { bond_denom?: string; bond_display_symbol?: string } | null;
}

/**
 * PEER_CHAINS: {"<chain id>": "<REST API URL>", ...} for the chains this one
 * relays with, set by the launcher (the same setting /api/config serves).
 * Anything that does not parse as that shape is ignored.
 */
export function peerChainApis(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string" && /^https?:\/\//.test(e[1])
      )
    );
  } catch {
    return {};
  }
}

// The same bound as the peers the card lists (lib/ibcStatus.ts).
const MAX_IBC_PEERS = 3;

// A node whose latest block is older than this is not at its chain's tip,
// and its height is not taken as the chain's. Kept short so that, with the
// reset margin (lib/ibcStatus.ts), a lagging node can't look like a reset
// even on a chain with one-second blocks.
const PEER_TIP_MS = 2 * 60_000;

// Who relays for a client changes rarely and finding out means searching the
// node's transactions, so the answer is kept for a while.
const RELAYER_FRESH_MS = 10 * 60_000;
const relayers = new Map<
  string,
  { at: number; found: { address: string; payer: string; fee: string | null; denom: string } | null }
>();

/**
 * A light client on the peer chain, from the peer's own API: its status, its
 * trusting period and when it last moved. Null when the id isn't one, or
 * nothing of it could be read.
 *
 * `ours` says whether it is a client of this chain. Client ids are only
 * counters, so after a peer is reset the id a connection names can belong
 * to a client of some other chain: that one is reported as not found, and
 * nothing more is read of it.
 */
async function ibcPeerClient(
  peerApi: string,
  clientId: string,
  thisChainId: string
): Promise<{ client: IbcPeerClient; ours: boolean } | null> {
  if (!/^[a-z0-9-]{1,64}$/.test(clientId)) return null;
  const client = `${peerApi}/ibc/core/client/v1`;
  const id = encodeURIComponent(clientId);
  const [statusR, stateR] = await Promise.all([reach(`${client}/client_status/${id}`), reach(`${client}/client_states/${id}`)]);
  const status = (await okJson<{ status?: string }>(statusR))?.status ?? null;
  const state = (
    await okJson<{
      client_state?: {
        chain_id?: string;
        latest_height?: { revision_number?: string; revision_height?: string };
        trusting_period?: string;
      };
    }>(stateR)
  )?.client_state;
  if (status === null && !state) return null;
  const missing = { client: { status: "Unknown", updatedAt: null, trustingSeconds: 0 }, ours: false };
  if (!state || status === "Unknown") return missing;
  if (thisChainId && state.chain_id && state.chain_id !== thisChainId) return missing;
  let updatedAt: number | null = null;
  const latest = state.latest_height;
  if (latest?.revision_height) {
    const r = await reach(
      `${client}/consensus_states/${id}/revision/${encodeURIComponent(latest.revision_number || "0")}/height/${encodeURIComponent(latest.revision_height)}`
    );
    const stamp = Date.parse((await okJson<{ consensus_state?: { timestamp?: string } }>(r))?.consensus_state?.timestamp ?? "");
    updatedAt = Number.isFinite(stamp) ? stamp : null;
  }
  const seen = latest?.revision_height && /^\d+$/.test(latest.revision_height) ? Number(latest.revision_height) : null;
  return { client: { status, updatedAt, trustingSeconds: durationSeconds(state.trusting_period), height: seen }, ours: true };
}

/** Whether a client on the peer chain follows this chain: read before anything is looked up by its id. */
async function followsThisChain(peerApi: string, clientId: string, thisChainId: string): Promise<boolean> {
  if (!/^[a-z0-9-]{1,64}$/.test(clientId)) return false;
  if (!thisChainId) return true;
  const r = await reach(`${peerApi}/ibc/core/client/v1/client_states/${encodeURIComponent(clientId)}`);
  const chain = (await okJson<{ client_state?: { chain_id?: string } }>(r))?.client_state?.chain_id;
  return chain === thisChainId;
}

/**
 * The relayer's account on this chain for one light client: the signer of
 * the last transaction that updated it, with what it holds in the
 * denomination that transaction paid its fee in. Null when the node's
 * transaction index has no such update (or keeps no index).
 */
async function ibcRelayer(base: string, clientId: string): Promise<IbcRelayer | null> {
  // Client ids are "07-tendermint-0": anything else isn't put into a query.
  if (!/^[a-z0-9-]{1,64}$/.test(clientId)) return null;
  const key = `${base}|${clientId}`;
  let known = relayers.get(key);
  if (!known || Date.now() - known.at > RELAYER_FRESH_MS) {
    const query = new URLSearchParams({
      query: `update_client.client_id='${clientId}'`,
      order_by: "ORDER_BY_DESC",
      limit: "1",
      "pagination.limit": "1",
    });
    const r = await reach(`${base}/cosmos/tx/v1beta1/txs?${query}`);
    const tx = (
      await okJson<{
        txs?: {
          body?: { messages?: { "@type"?: string; signer?: string }[] };
          auth_info?: { fee?: { amount?: { denom?: string; amount?: string }[]; payer?: string; granter?: string } };
        }[];
      }>(r)
    )?.txs?.[0];
    const address = tx?.body?.messages?.find((m) => m["@type"] === "/ibc.core.client.v1.MsgUpdateClient")?.signer;
    const paid = tx?.auth_info?.fee;
    const fee = paid?.amount?.[0];
    if (r.res?.ok) {
      known = {
        at: Date.now(),
        found:
          address && fee?.denom
            ? {
                address,
                // A fee can be paid for the signer by another account: that one's funds are what run out.
                payer: paid?.granter || paid?.payer || address,
                fee: fee.amount && /^\d+$/.test(fee.amount) ? fee.amount : null,
                denom: fee.denom,
              }
            : null,
      };
      relayers.set(key, known);
    }
  }
  const found = known?.found;
  if (!found) return null;
  const r = await reach(
    `${base}/cosmos/bank/v1beta1/balances/${encodeURIComponent(found.payer)}/by_denom?denom=${encodeURIComponent(found.denom)}`
  );
  const amount = (await okJson<{ balance?: { amount?: string } }>(r))?.balance?.amount;
  return {
    address: found.address,
    denom: found.denom,
    balance: amount && /^\d+$/.test(amount) ? amount : null,
    lastFee: found.fee,
  };
}

interface IbcTopology {
  /** Chain id each light client follows. */
  clients: Map<string, string>;
  /** Light client behind each open connection. */
  connections: Map<string, string>;
  /** Open channels, with the connection each rides. */
  channels: { port: string; id: string; connection: string }[];
}

async function ibcTopology(ibc: string): Promise<IbcTopology | null> {
  const page = "pagination.limit=500";
  const [clientsR, connectionsR, channelsR] = await Promise.all([
    reach(`${ibc}/client/v1/client_states?${page}`),
    reach(`${ibc}/connection/v1/connections?${page}`),
    reach(`${ibc}/channel/v1/channels?${page}`),
  ]);
  const clients = (await okJson<{ client_states?: { client_id?: string; client_state?: { chain_id?: string } }[] }>(clientsR))?.client_states;
  const connections = (await okJson<{ connections?: { id?: string; client_id?: string; state?: string }[] }>(connectionsR))?.connections;
  const channels = (
    await okJson<{ channels?: { state?: string; port_id?: string; channel_id?: string; connection_hops?: string[] }[] }>(channelsR)
  )?.channels;
  if (!clients || !connections || !channels) return null;
  return {
    clients: new Map(clients.map((c) => [c.client_id ?? "", c.client_state?.chain_id ?? ""])),
    connections: new Map(connections.filter((c) => c.state === "STATE_OPEN").map((c) => [c.id ?? "", c.client_id ?? ""])),
    channels: channels
      .filter((c) => c.state === "STATE_OPEN")
      .map((c) => ({ port: c.port_id ?? "", id: c.channel_id ?? "", connection: c.connection_hops?.[0] ?? "" })),
  };
}

/** A client id's counter ("07-tendermint-12" is 12): later clients have higher ones. -1 if it has none. */
function clientNumber(id: string): number {
  const m = /-(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

/**
 * The channels that most likely replaced a peer record's: open channels to
 * `chainId` on one light client created after `clientId`, covering every
 * port the record names. Exported for its test.
 *
 * Anyone may create a client, a connection and a channel, and a client's
 * chain id is whatever its creator says. So one stray channel proves
 * nothing: a second relayer's own transfer channel is ordinary. What is
 * taken as a replaced link is a later client carrying the same set of ports,
 * the federation port among them, which is what re-making a peer's
 * connection leaves and nothing else ordinarily does.
 */
export function newerChannelsThan(
  t: IbcTopology,
  clientId: string,
  chainId: string,
  ports: string[],
  federationPort: string
): { port: string; id: string }[] {
  const mine = clientNumber(clientId);
  if (mine < 0 || !chainId || !ports.includes(federationPort)) return [];
  const later = [...t.clients]
    .filter(([id, chain]) => chain === chainId && id !== clientId && clientNumber(id) > mine)
    .map(([id]) => id)
    .sort((a, b) => clientNumber(b) - clientNumber(a));
  // The latest such client that carries them all.
  for (const client of later) {
    const onIt = t.channels.filter((c) => t.connections.get(c.connection) === client && ports.includes(c.port));
    if (ports.every((port) => onIt.some((c) => c.port === port))) {
      return ports.flatMap((port) => onIt.filter((c) => c.port === port).map((c) => ({ port: c.port, id: c.id })));
    }
  }
  return [];
}

/**
 * The IBC relayer, judged by this chain's side of each link the federation
 * module names: the channels to every active peer chain, the light client
 * behind them and the packets still waiting. `lcd` is the node this server
 * reads.
 */
export async function checkIbc(
  lcd: string,
  units: ChainUnits = chainUnits(),
  peerApis: Record<string, string> = peerChainApis(process.env.PEER_CHAINS)
): Promise<ServiceReport> {
  const base = lcd.replace(/\/+$/, "");
  const federation = `${base}/sparkdream/federation/v1`;
  const ibc = `${base}/ibc/core`;
  const cantRead: ServiceReport = {
    id: "relayer",
    state: "unreachable",
    issues: ["The chain couldn't be read, so the state of its IBC links is unknown."],
    latency_ms: null,
    facts: [],
  };
  const [peersR, paramsR, blockR] = await Promise.all([
    reach(`${federation}/list_peers?pagination.limit=200`),
    reach(`${federation}/params`),
    reach(`${base}/cosmos/base/tendermint/v1beta1/blocks/latest`),
  ]);
  // This chain's height, for a peer's light client to be held against: only
  // from a node at the tip, as with the peer's own height.
  const header = (await okJson<{ block?: { header?: { height?: string; time?: string } } }>(blockR))?.block?.header;
  const headerAt = Date.parse(header?.time ?? "");
  const thisHeight =
    Number.isFinite(headerAt) && Date.now() - headerAt < PEER_TIP_MS && header?.height && /^\d+$/.test(header.height)
      ? Number(header.height)
      : null;
  if (!peersR.res || isGatewayStatus(peersR.res.status)) return cantRead;
  if (peersR.res.status === 501 || peersR.res.status === 404) return assessIbc({ links: null, now: Date.now() });
  const peers = await okJson<{ peers?: IbcPeer[] }>(peersR);
  if (!peers) return cantRead;
  const federationPort = (await okJson<{ params?: { ibc_port?: string } }>(paramsR))?.params?.ibc_port || "federation";

  const linked = (peers.peers ?? [])
    .filter((p) => p.status === "PEER_STATUS_ACTIVE" && (p.ibc_channel_id || p.ibc_transfer_channel_id))
    .slice(0, MAX_IBC_PEERS);

  // Every client, connection and channel on this chain, to spot a link that
  // was replaced: open channels to the same chain on a later light client.
  // Asked alongside the links' own reads, and awaited by each at its end.
  const topologyP = linked.length > 0 ? ibcTopology(ibc) : Promise.resolve(null);

  const links = await Promise.all(
    linked.map(async (peer): Promise<IbcLink> => {
      const named = [
        { port: federationPort, id: peer.ibc_channel_id || "" },
        { port: "transfer", id: peer.ibc_transfer_channel_id || "" },
      ].filter((c) => c.id);
      let clientId = "";
      // For the relayer's account on the peer chain: which chain the client
      // follows, and the connection that names the peer's client of this one.
      let peerChainId = "";
      let connectionId = "";
      let latest: { revision_number?: string; revision_height?: string } | undefined;
      let trustingSeconds = 0;
      const channels = await Promise.all(
        named.map(async (c): Promise<IbcChannel> => {
          const at = `${ibc}/channel/v1/channels/${encodeURIComponent(c.id)}/ports/${encodeURIComponent(c.port)}`;
          const [channelR, clientR, pendingR] = await Promise.all([
            reach(at),
            reach(`${at}/client_state`),
            reach(`${at}/packet_commitments?pagination.limit=1&pagination.count_total=true`),
          ]);
          const channel = await okJson<{ channel?: { state?: string; connection_hops?: string[] } }>(channelR);
          if (!connectionId) connectionId = channel?.channel?.connection_hops?.[0] ?? "";
          const client = (
            await okJson<{
              identified_client_state?: {
                client_id?: string;
                client_state?: { latest_height?: typeof latest; trusting_period?: string; chain_id?: string };
              };
            }>(clientR)
          )?.identified_client_state;
          // Both channels to a peer normally ride one connection: the first client read stands for the link.
          if (client?.client_id && !clientId) {
            clientId = client.client_id;
            latest = client.client_state?.latest_height;
            trustingSeconds = durationSeconds(client.client_state?.trusting_period);
            peerChainId = client.client_state?.chain_id ?? "";
          }
          const total = (await okJson<{ pagination?: { total?: string } }>(pendingR))?.pagination?.total;
          return {
            port: c.port,
            id: c.id,
            state: channel?.channel?.state ?? null,
            pending: total && /^\d+$/.test(total) ? Number(total) : null,
          };
        })
      );

      let clientStatus: string | null = null;
      let updatedAt: number | null = null;
      let relayer: IbcRelayer | null = null;
      let peerRelayer: IbcRelayer | null = null;
      let peerHeight: number | null = null;
      let peerClient: IbcPeerClient | null = null;
      if (clientId) {
        const client = `${ibc}/client/v1`;
        const relayerP = ibcRelayer(base, clientId);
        const peerApi = (peerApis[peerChainId] || "").replace(/\/+$/, "");
        // The peer's height now: only if it answers as the chain the client
        // follows, and from a node at the tip. One still syncing, or stalled,
        // reports a height the chain has long passed, which would read as a reset.
        const peerHeightP = peerApi
          ? reach(`${peerApi}/cosmos/base/tendermint/v1beta1/blocks/latest`)
              .then((r) => okJson<{ block?: { header?: { height?: string; chain_id?: string; time?: string } } }>(r))
              .then((b) => {
                const header = b?.block?.header;
                const at = Date.parse(header?.time ?? "");
                const atTip = Number.isFinite(at) && Date.now() - at < PEER_TIP_MS;
                return header?.chain_id === peerChainId && atTip && header.height && /^\d+$/.test(header.height)
                  ? Number(header.height)
                  : null;
              })
          : Promise.resolve(null);
        // The connection names the peer's light client of this chain: its
        // state and the account that updates it are read from the peer's API.
        const theirClientP: Promise<string> =
          peerApi && connectionId
            ? reach(`${ibc}/connection/v1/connections/${encodeURIComponent(connectionId)}`)
                .then((r) => okJson<{ connection?: { counterparty?: { client_id?: string } } }>(r))
                .then((c) => c?.connection?.counterparty?.client_id ?? "")
            : Promise.resolve("");
        // The account is looked up by the client's id, so only once that id
        // is known to be a client of this chain and not some other's.
        const peerRelayerP = theirClientP.then(async (theirs) =>
          theirs && (await followsThisChain(peerApi, theirs, units.chainId ?? "")) ? ibcRelayer(peerApi, theirs) : null
        );
        const peerClientP = theirClientP.then(async (theirs) =>
          theirs ? ((await ibcPeerClient(peerApi, theirs, units.chainId ?? ""))?.client ?? null) : null
        );
        const [statusR, consensusR] = await Promise.all([
          reach(`${client}/client_status/${encodeURIComponent(clientId)}`),
          reach(
            `${client}/consensus_states/${encodeURIComponent(clientId)}/revision/${encodeURIComponent(latest?.revision_number || "0")}/height/${encodeURIComponent(latest?.revision_height || "0")}`
          ),
        ]);
        clientStatus = (await okJson<{ status?: string }>(statusR))?.status ?? null;
        const stamp = Date.parse((await okJson<{ consensus_state?: { timestamp?: string } }>(consensusR))?.consensus_state?.timestamp ?? "");
        updatedAt = Number.isFinite(stamp) ? stamp : null;
        [relayer, peerRelayer, peerHeight, peerClient] = await Promise.all([relayerP, peerRelayerP, peerHeightP, peerClientP]);
      }
      const identity = peer.peer_identity;
      const topology = await topologyP;
      return {
        peer: peer.display_name || peer.id || "peer",
        channels,
        clientStatus,
        updatedAt,
        trustingSeconds,
        relayer,
        peerRelayer,
        peerClient,
        newerChannels:
          topology && clientId
            ? newerChannelsThan(topology, clientId, peerChainId, named.map((c) => c.port), federationPort)
            : [],
        clientHeight: latest?.revision_height && /^\d+$/.test(latest.revision_height) ? Number(latest.revision_height) : null,
        peerHeight,
        peerFee:
          identity?.bond_denom && identity.bond_display_symbol
            ? { denom: identity.bond_denom, symbol: identity.bond_display_symbol }
            : undefined,
      };
    })
  );
  return assessIbc({ links, fee: units, thisHeight, now: Date.now() });
}

// ---- Archive mirror -------------------------------------------------------------

/**
 * The off-fleet archive mirror, from the two status documents its operator
 * publishes. `statusUrl` is the address of status.json; rebuild-status.json
 * is read from beside it. The mirror runs outside the deployment and has no
 * other way to be seen from here.
 */
export async function checkMirror(statusUrl: string, chainId: string): Promise<ServiceReport> {
  const id = "mirror";
  let rebuildUrl: string;
  try {
    rebuildUrl = new URL("rebuild-status.json", statusUrl).toString();
  } catch {
    return { id, state: "degraded", issues: ["The mirror's status address isn't a valid URL."], latency_ms: null, facts: [] };
  }
  const [syncR, rebuildR] = await Promise.all([reach(statusUrl), reach(rebuildUrl)]);
  const cantRead = (issue: string): ServiceReport => ({ id, state: "unreachable", issues: [issue], latency_ms: null, facts: [] });
  if (!syncR.res) return cantRead(syncR.reason);
  if (!syncR.res.ok) return cantRead(`The mirror's published status answered with HTTP ${syncR.res.status}.`);
  const sync = await okJson<MirrorSync>(syncR);
  if (!sync || typeof sync !== "object") return cantRead("The mirror's published status can't be read.");
  // No rebuild document yet is a mirror in its first week, not a failure.
  const rebuild = await okJson<MirrorRebuild>(rebuildR);
  return assessMirror({ chainId, sync, rebuild: rebuild && typeof rebuild === "object" ? rebuild : null, now: Date.now() });
}

// ---- Archive snapshots ----------------------------------------------------------

/** The remote snapshot list, when the site uses one. */
export async function checkArchive(url: string): Promise<ServiceReport> {
  const id = "archive";
  const r = await reach(url);
  if (!r.res) return { id, state: "unreachable", issues: [r.reason], latency_ms: null, facts: [] };
  if (!r.res.ok) {
    return {
      id,
      state: isGatewayStatus(r.res.status) ? "unreachable" : "degraded",
      issues: [`The snapshot list answered with HTTP ${r.res.status}.`],
      latency_ms: null,
      facts: [],
    };
  }
  try {
    const body = (await r.res.json()) as { snapshots?: unknown };
    if (!Array.isArray(body.snapshots)) throw new Error("no list");
    return {
      id,
      state: "ok",
      issues: [],
      latency_ms: r.ms,
      facts: [{ label: "Snapshots", value: n(body.snapshots.length) }],
    };
  } catch {
    return { id, state: "degraded", issues: ["The snapshot list can't be read."], latency_ms: null, facts: [] };
  }
}

// ---- All of them ----------------------------------------------------------------

async function runAll(env: NodeJS.ProcessEnv): Promise<ServiceReport[]> {
  const explorer = env.EXPLORER_URL || env.NEXT_PUBLIC_EXPLORER_URL || "";
  const manifest = env.REMOTE_MANIFEST_URL || env.NEXT_PUBLIC_REMOTE_MANIFEST_URL || "";
  const checks: Promise<ServiceReport>[] = [];
  if (explorer) checks.push(checkPage("explorer", explorer));
  // The same node and chain the rest of this server reads (lib/api.ts).
  const lcd = env.LCD_ENDPOINT || defaults.lcdEndpoint;
  checks.push(checkScanners(lcd), checkImages(env), checkArweave(arweaveGateway(env)));
  const units = chainUnits(env);
  checks.push(checkValidators(lcd));
  checks.push(checkGovernance(lcd));
  checks.push(checkShield(lcd, units, env));
  // The addresses a browser reaches the app's services at. SITE_URL, where set, is this site's own.
  checks.push(
    checkCertificates([
      env.SITE_URL,
      lcd,
      env.RPC_ENDPOINT || defaults.rpcEndpoint,
      explorer,
      uploadConfig(env)?.publicBase,
      arweaveGateway(env),
    ])
  );
  checks.push(checkIbc(lcd, units, peerChainApis(env.PEER_CHAINS)));
  checks.push(checkBridges(lcd, undefined, units));
  checks.push(checkStorage(lcd, arweaveGateway(env), env));
  const chainId = env.CHAIN_ID || defaults.chainId;
  // The mirror is seen only through what its operator publishes: no address, no card.
  if (env.ARCHIVE_MIRROR_STATUS_URL) checks.push(checkMirror(env.ARCHIVE_MIRROR_STATUS_URL, chainId));
  checks.push(checkArchiver(lcd, chainId, arweaveGateway(env)));
  // Without a remote list, snapshots are files on this server: nothing to reach.
  if (manifest) checks.push(checkArchive(manifest));
  return Promise.all(checks);
}

let cached: { at: number; services: ServiceReport[] } | null = null;
let running: Promise<ServiceReport[]> | null = null;

/** The current reports, at most CACHE_MS old. Concurrent callers share one round. */
export async function getSiteStatus(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ generatedAt: number; services: ServiceReport[] }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return { generatedAt: cached.at, services: cached.services };
  if (!running) {
    running = runAll(env)
      .then((services) => {
        cached = { at: Date.now(), services };
        return services;
      })
      .finally(() => {
        running = null;
      });
  }
  const services = await running;
  return { generatedAt: cached?.at ?? Date.now(), services };
}
