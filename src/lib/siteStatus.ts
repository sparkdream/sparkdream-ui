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
import { assessStorage, readyOperators } from "@/lib/storageStatus";
import { CONTENT_SCANNER_SERVICE_TYPE } from "@/types/service";
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

  const unread = Object.keys(meta.errors).length;
  if (unread > 0) {
    issues.push(unread === 1 ? "One scanner feed could not be read." : `${unread} scanner feeds could not be read.`);
  }
  if (meta.imagesDisabled) {
    issues.push("Images are switched off by the site operator.");
  }
  return { id, state: issues.length ? "degraded" : "ok", issues, latency_ms: null, facts };
}

async function checkScanners(): Promise<ServiceReport> {
  try {
    const snap = await withTimeout(getVerdictIndex(), TIMEOUT_MS);
    return assessScanners({
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
  const params = await okJson<{ params?: { enabled?: boolean } }>(paramsR);
  const backends = await okJson<{ backends?: StorageBackend[] }>(backendsR);
  if (!params || !backends) return cantRead;
  const all = backends.backends ?? [];
  const backend = all.find((b) => b.enabled) ?? all[0] ?? null;
  const enabled = params.params?.enabled === true;
  if (!backend || !enabled || !backend.enabled) return assessStorage({ ...idle, enabled, backend });

  const name = encodeURIComponent(backend.name);
  const scannerType = encodeURIComponent(CONTENT_SCANNER_SERVICE_TYPE);
  const count = "pagination.limit=1&pagination.count_total=true";
  const [opsR, approvedR, scannersR, approvedScannersR, scannerTypeR, pendingR, claimedR] = await Promise.all([
    reach(`${service}/operators_by_service_type/${encodeURIComponent(backend.service_type)}?${page}`),
    reach(`${storage}/approved_operators/${name}?${page}`),
    reach(`${service}/operators_by_service_type/${scannerType}?${page}`),
    reach(`${storage}/approved_scanners?${page}`),
    reach(`${service}/service_type/${scannerType}`),
    reach(`${storage}/requests_by_status/${name}/REQUEST_STATUS_PENDING?${count}`),
    reach(`${storage}/requests_by_status/${name}/REQUEST_STATUS_CLAIMED?${count}`),
  ]);
  const ops = await okJson<{ operators?: Operator[] }>(opsR);
  const approved = await okJson<{ operators?: ApprovedOperator[] }>(approvedR);
  const scanners = await okJson<{ operators?: Operator[] }>(scannersR);
  const approvedScanners = await okJson<{ scanners?: ApprovedScanner[] }>(approvedScannersR);
  if (!ops || !approved || !scanners || !approvedScanners) return cantRead;
  // A chain without the scanner type has no quorum: the same as a quorum of 0.
  const scannerConfig = (await okJson<{ config?: ServiceTypeConfig }>(scannerTypeR))?.config;
  const total = async (r: Reached) => {
    const t = (await okJson<{ pagination?: { total?: string } }>(r))?.pagination?.total;
    return t && /^\d+$/.test(t) ? Number(t) : null;
  };

  const operators = ops.operators ?? [];
  const approvedOperators = approved.operators ?? [];
  const node = arweaveNodeOf(gatewayTemplate);
  const wallets = [
    ...new Set(readyOperators(operators, approvedOperators).flatMap((o) => operatorWallets(o.metadata, backend.name))),
  ].slice(0, 10);
  const balances: Record<string, string | null> = {};
  await Promise.all(
    wallets.map(async (w) => {
      balances[w] = await walletBalance(node, w);
    })
  );

  return assessStorage({
    enabled,
    backend,
    operators,
    approvedOperators,
    scanners: scanners.operators ?? [],
    approvedScanners: approvedScanners.scanners ?? [],
    scannerQuorum: scannerConfig?.enabled ? Number(scannerConfig.attestation_quorum) || 0 : 0,
    pending: await total(pendingR),
    claimed: await total(claimedR),
    balances,
    siteOffers: permanentCopiesOn(env),
  });
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
  checks.push(checkScanners(), checkImages(env), checkArweave(arweaveGateway(env)));
  // The same node and chain the rest of this server reads (lib/api.ts).
  const lcd = env.LCD_ENDPOINT || defaults.lcdEndpoint;
  checks.push(checkStorage(lcd, arweaveGateway(env), env));
  checks.push(checkArchiver(lcd, env.CHAIN_ID || defaults.chainId, arweaveGateway(env)));
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
