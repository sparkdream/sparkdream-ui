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
import { assessArchiver, checkpointTxId, leadingArchiver, parseArweaveTx, type ArweaveTx } from "@/lib/archiverStatus";
import { CHAIN_ARCHIVER_SERVICE_TYPE } from "@/lib/chainArchiver";
import { defaults } from "@/lib/chain";
import { arweaveNodeOf, operatorWallets } from "@/lib/storageFunds";
import { assessStorage, checkpointWallet, readyOperators, type WorkerEvidence } from "@/lib/storageStatus";
import { assessBridges, BRIDGE_SERVICE_TYPE_PREFIX } from "@/lib/bridgeStatus";
import type { BridgeBinding } from "@/types/federation";
import { headPinned, publicHttpsTarget } from "@/lib/publicUrl";
import { assessIbc, type IbcChannel, type IbcLink } from "@/lib/ibcStatus";
import { assessMirror, type MirrorRebuild, type MirrorSync } from "@/lib/mirrorStatus";
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

async function checkScanners(lcd: string): Promise<ServiceReport> {
  try {
    const snap = await withTimeout(getVerdictIndex(), TIMEOUT_MS);
    const trusted = new Set(snap.setup.workers.map((w) => w.address));
    return assessScanners({
      feedHosts: [...new Set(snap.setup.workers.map((w) => hostOf(w.feedUrl)).filter(Boolean))],
      checkpoints: snap.setup.checkpoints,
      ...(snap.setup.quorum > 0 ? await scannerRegistrations(lcd, trusted) : {}),
      workers: snap.setup.workers.map((w) => w.address),
      quorum: snap.setup.quorum,
      heights: snap.heights,
      latestHeight: snap.latestHeight,
      maxLagBlocks: snap.maxLagBlocks,
      errors: snap.errors,
      imagesDisabled: imagesDisabled(),
    });
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
  const txId = checkpointTxId(leadingArchiver(operators, checkpoints)?.checkpoint?.root ?? "");
  if (maxLagBlocks !== null && txId) {
    try {
      tx = await arweaveTx(new URL(gatewayTemplate).origin, txId);
    } catch {
      // Not a URL: checkArweave reports that.
    }
  }
  return assessArchiver({ chainId, maxLagBlocks, operators, checkpoints, latestHeight, tx, now: Date.now() });
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
    ...new Set(readyOperators(operators, approvedOperators).flatMap((o) => operatorWallets(o.metadata, backend.name))),
  ].slice(0, 10);
  const balances: Record<string, string | null> = {};
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

  return assessStorage({
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
    worker,
    siteOffers: permanentCopiesOn(env),
  });
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
export async function checkBridges(lcd: string, probe: EndpointProbe = probeEndpoint): Promise<ServiceReport> {
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
  const reachable: Record<string, boolean | null> = {};
  await Promise.all(
    [...new Set(all.map((b) => b.endpoint).filter(Boolean))].slice(0, MAX_ENDPOINTS).map(async (endpoint) => {
      reachable[endpoint] = await probe(endpoint).catch(() => false);
    })
  );

  return assessBridges({
    bindings: all,
    reachable,
    peers,
    operators: (ops.operators ?? []).filter((o) => o.service_type.startsWith(BRIDGE_SERVICE_TYPE_PREFIX)),
    inactivitySeconds,
    now: Date.now(),
  });
}

// ---- IBC relayer ----------------------------------------------------------------

interface IbcPeer {
  id?: string;
  display_name?: string;
  status?: string;
  ibc_channel_id?: string;
  ibc_transfer_channel_id?: string;
}

// The same bound as the peers the card lists (lib/ibcStatus.ts).
const MAX_IBC_PEERS = 3;

/**
 * The IBC relayer, judged by this chain's side of each link the federation
 * module names: the channels to every active peer chain, the light client
 * behind them and the packets still waiting. `lcd` is the node this server
 * reads.
 */
export async function checkIbc(lcd: string): Promise<ServiceReport> {
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
  const [peersR, paramsR] = await Promise.all([
    reach(`${federation}/list_peers?pagination.limit=200`),
    reach(`${federation}/params`),
  ]);
  if (!peersR.res || isGatewayStatus(peersR.res.status)) return cantRead;
  if (peersR.res.status === 501 || peersR.res.status === 404) return assessIbc({ links: null, now: Date.now() });
  const peers = await okJson<{ peers?: IbcPeer[] }>(peersR);
  if (!peers) return cantRead;
  const federationPort = (await okJson<{ params?: { ibc_port?: string } }>(paramsR))?.params?.ibc_port || "federation";

  const linked = (peers.peers ?? [])
    .filter((p) => p.status === "PEER_STATUS_ACTIVE" && (p.ibc_channel_id || p.ibc_transfer_channel_id))
    .slice(0, MAX_IBC_PEERS);

  const links = await Promise.all(
    linked.map(async (peer): Promise<IbcLink> => {
      const named = [
        { port: federationPort, id: peer.ibc_channel_id || "" },
        { port: "transfer", id: peer.ibc_transfer_channel_id || "" },
      ].filter((c) => c.id);
      let clientId = "";
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
          const channel = await okJson<{ channel?: { state?: string } }>(channelR);
          const client = (
            await okJson<{
              identified_client_state?: {
                client_id?: string;
                client_state?: { latest_height?: typeof latest; trusting_period?: string };
              };
            }>(clientR)
          )?.identified_client_state;
          // Both channels to a peer normally ride one connection: the first client read stands for the link.
          if (client?.client_id && !clientId) {
            clientId = client.client_id;
            latest = client.client_state?.latest_height;
            trustingSeconds = durationSeconds(client.client_state?.trusting_period);
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
      if (clientId) {
        const client = `${ibc}/client/v1`;
        const [statusR, consensusR] = await Promise.all([
          reach(`${client}/client_status/${encodeURIComponent(clientId)}`),
          reach(
            `${client}/consensus_states/${encodeURIComponent(clientId)}/revision/${encodeURIComponent(latest?.revision_number || "0")}/height/${encodeURIComponent(latest?.revision_height || "0")}`
          ),
        ]);
        clientStatus = (await okJson<{ status?: string }>(statusR))?.status ?? null;
        const stamp = Date.parse((await okJson<{ consensus_state?: { timestamp?: string } }>(consensusR))?.consensus_state?.timestamp ?? "");
        updatedAt = Number.isFinite(stamp) ? stamp : null;
      }
      return { peer: peer.display_name || peer.id || "peer", channels, clientStatus, updatedAt, trustingSeconds };
    })
  );
  return assessIbc({ links, now: Date.now() });
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
  checks.push(checkIbc(lcd));
  checks.push(checkBridges(lcd));
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
