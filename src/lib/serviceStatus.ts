// Live health checks behind the /status page.
//
// The checks run in the browser against the same two endpoints the rest of the
// app uses: the LCD through our /api/lcd proxy (every read) and the CometBFT
// RPC directly (broadcasts, the ticker's websocket). So the page reports what
// this visitor can actually reach, not what a monitor elsewhere sees.
//
// Both endpoints normally front a sentry, not a validator. A healthy result
// says the sentry is up, on the right chain and keeping pace; it says nothing
// about the validators behind it.

import { reportChainReachable, reportChainUnreachable } from "./chainStatus";
import { isGatewayStatus } from "./errors";

// "off" is a service this site or chain doesn't have set up: not a failure.
export type ServiceState = "ok" | "degraded" | "unreachable" | "off";

export interface ServiceFact {
  label: string;
  value: string;
}

/** One service as /api/status reports it (lib/siteStatus.ts). */
export interface ServiceReport {
  id: string;
  state: ServiceState;
  /** One sentence per problem found. */
  issues: string[];
  latency_ms: number | null;
  facts: ServiceFact[];
}

export interface SiteStatusResponse {
  v: 1;
  generated_at: string;
  services: ServiceReport[];
}

export interface NodeFacts {
  chainId: string;
  moniker: string;
  /** The sparkdreamd build. Only the LCD reports it; "" from the RPC. */
  appVersion: string;
  cometVersion: string;
  height: string;
  /** Header time of the latest block in epoch ms, or NaN if unreadable. */
  blockTime: number;
  syncing: boolean;
}

export interface ProbeResult {
  state: ServiceState;
  /** One sentence per problem found. Empty when state is "ok". */
  issues: string[];
  latencyMs: number | null;
  facts: NodeFacts | null;
  /** Age of the latest block when checked, or null if unknown. */
  blockAgeMs: number | null;
}

export interface ChainStatus {
  lcd: ProbeResult;
  rpc: ProbeResult;
  /** Local epoch ms when the check finished. */
  checkedAt: number;
}

// Shorter than the 15s ceiling on ordinary reads: a status check that takes
// this long has its answer already.
const PROBE_TIMEOUT_MS = 8_000;
// Blocks arrive every ~6s. A minute without one means the node has stalled or
// lost its peers, while leaving room for a slow round.
export const STALE_BLOCK_MS = 60_000;
// The two endpoints are sampled a moment apart, so a block or two of
// difference is normal. This many means they are different nodes and one of
// them is behind.
export const HEIGHT_DRIFT_BLOCKS = 20;

type Fetch = typeof fetch;

type Fetched =
  | { ok: true; body: unknown; ms: number; date: number | null }
  | { ok: false; reason: string; answered: boolean; date: number | null };

function serverDate(res: Response): number | null {
  const raw = res.headers.get("date");
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

async function timedJson(url: string, fetchImpl: Fetch): Promise<Fetched> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetchImpl(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      answered: false,
      date: null,
      reason: timedOut
        ? `Did not respond within ${PROBE_TIMEOUT_MS / 1000} seconds.`
        : "Could not be reached from this browser.",
    };
  }
  const date = serverDate(res);
  if (!res.ok) {
    // A gateway status is the thing in front of the node answering for it.
    const answered = !isGatewayStatus(res.status);
    return { ok: false, answered, date, reason: `Answered with HTTP ${res.status}.` };
  }
  try {
    const body: unknown = await res.json();
    return { ok: true, body, ms: Math.round(performance.now() - started), date };
  } catch {
    return { ok: false, answered: false, date, reason: "Returned an unreadable response." };
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function field(obj: unknown, ...path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function parseTime(v: unknown): number {
  const s = str(v);
  return s ? Date.parse(s) : NaN;
}

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Judge one node's answers. `now` is epoch ms on a clock we trust. */
export function assessNode(
  facts: NodeFacts,
  expectedChainId: string,
  now: number
): { state: ServiceState; issues: string[]; blockAgeMs: number | null } {
  const issues: string[] = [];
  if (facts.chainId && expectedChainId && facts.chainId !== expectedChainId) {
    issues.push(`Serves ${facts.chainId}, but this app is set up for ${expectedChainId}.`);
  }
  if (facts.syncing) {
    issues.push("Still syncing, so what it serves is behind the chain.");
  }
  const blockAgeMs = Number.isFinite(facts.blockTime) ? Math.max(0, now - facts.blockTime) : null;
  if (blockAgeMs !== null && blockAgeMs > STALE_BLOCK_MS) {
    issues.push(`Its latest block is ${formatAge(blockAgeMs)} old. Blocks normally arrive every few seconds.`);
  }
  return { state: issues.length ? "degraded" : "ok", issues, blockAgeMs };
}

function failed(f: Extract<Fetched, { ok: false }>): ProbeResult {
  return {
    state: f.answered ? "degraded" : "unreachable",
    issues: [f.reason],
    latencyMs: null,
    facts: null,
    blockAgeMs: null,
  };
}

const TM = "/cosmos/base/tendermint/v1beta1";

type Raw = { facts: NodeFacts; ms: number } | { failure: Extract<Fetched, { ok: false }> };

async function fetchLcd(base: string, fetchImpl: Fetch): Promise<Raw & { date: number | null }> {
  const [info, block, sync] = await Promise.all([
    timedJson(`${base}${TM}/node_info`, fetchImpl),
    timedJson(`${base}${TM}/blocks/latest`, fetchImpl),
    timedJson(`${base}${TM}/syncing`, fetchImpl),
  ]);
  const date = info.date ?? block.date ?? sync.date;
  const bad = [info, block, sync].find((f) => !f.ok);
  if (bad && !bad.ok) return { failure: bad, date };
  if (!info.ok || !block.ok || !sync.ok) throw new Error("unreachable");
  const facts: NodeFacts = {
    chainId: str(field(info.body, "default_node_info", "network")),
    moniker: str(field(info.body, "default_node_info", "moniker")),
    appVersion: str(field(info.body, "application_version", "version")),
    cometVersion: str(field(info.body, "default_node_info", "version")),
    height: str(field(block.body, "block", "header", "height")),
    blockTime: parseTime(field(block.body, "block", "header", "time")),
    syncing: field(sync.body, "syncing") === true,
  };
  return { facts, ms: info.ms, date };
}

async function fetchRpc(endpoint: string, fetchImpl: Fetch): Promise<Raw> {
  const res = await timedJson(`${endpoint.replace(/\/+$/, "")}/status`, fetchImpl);
  if (!res.ok) return { failure: res };
  const result = field(res.body, "result");
  const facts: NodeFacts = {
    chainId: str(field(result, "node_info", "network")),
    moniker: str(field(result, "node_info", "moniker")),
    appVersion: "",
    cometVersion: str(field(result, "node_info", "version")),
    height: str(field(result, "sync_info", "latest_block_height")),
    blockTime: parseTime(field(result, "sync_info", "latest_block_time")),
    syncing: field(result, "sync_info", "catching_up") === true,
  };
  return { facts, ms: res.ms };
}

function toHeight(facts: NodeFacts | null): number | null {
  if (!facts || !/^\d+$/.test(facts.height)) return null;
  return Number(facts.height);
}

export interface ChainStatusInput {
  /** Where LCD reads go: "/api/lcd" in the browser. */
  lcdBase: string;
  rpcEndpoint: string;
  chainId: string;
  fetchImpl?: Fetch;
  /** The local clock, for tests. */
  clock?: () => number;
}

/** Check the LCD and the RPC once, and feed the result to the app-wide banner. */
export async function checkChain(input: ChainStatusInput): Promise<ChainStatus> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const [lcdRaw, rpcRaw] = await Promise.all([
    fetchLcd(input.lcdBase, fetchImpl),
    fetchRpc(input.rpcEndpoint, fetchImpl),
  ]);
  const checkedAt = (input.clock ?? Date.now)();
  // Block age is measured against our own server's clock when its Date header
  // is readable (the LCD proxy is same-origin), so a visitor whose clock is
  // wrong does not see a healthy chain reported as stalled.
  const now = lcdRaw.date ?? checkedAt;

  const build = (raw: Raw): ProbeResult => {
    if ("failure" in raw) return failed(raw.failure);
    return { ...assessNode(raw.facts, input.chainId, now), latencyMs: raw.ms, facts: raw.facts };
  };
  const lcd = build(lcdRaw);
  const rpc = build(rpcRaw);

  const lcdHeight = toHeight(lcd.facts);
  const rpcHeight = toHeight(rpc.facts);
  if (lcdHeight !== null && rpcHeight !== null) {
    const gap = lcdHeight - rpcHeight;
    if (Math.abs(gap) > HEIGHT_DRIFT_BLOCKS) {
      const [behind, other] = gap < 0 ? [lcd, "RPC"] : [rpc, "REST API"];
      behind.issues.push(`${Math.abs(gap).toLocaleString("en-US")} blocks behind the ${other}.`);
      behind.state = "degraded";
    }
  }

  if (lcd.state === "unreachable") reportChainUnreachable();
  else reportChainReachable();

  return { lcd, rpc, checkedAt };
}

/** The worst state among the given results. */
export function worstState(...results: { state: ServiceState }[]): ServiceState {
  if (results.some((r) => r.state === "unreachable")) return "unreachable";
  if (results.some((r) => r.state === "degraded")) return "degraded";
  return "ok";
}

export { isGatewayStatus };
