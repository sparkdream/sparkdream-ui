// Trusted content scanners, read from the chain (docs/content-scanning.md §6
// step 1): ACTIVE operators of the "content-scanner" service type, each with
// the ed25519 verdict key and feed URL it published in its operator metadata
// (§8.1), plus the quorum the service type sets. Trust follows operator
// status, so a slashed, unbonding or retired worker simply drops out.

import {
  getServiceType,
  listCheckpointsByServiceType,
  listServiceOperatorsByServiceType,
} from "@/lib/api";
import { isMissingEndpoint } from "@/lib/errors";
import { CONTENT_SCANNER_SERVICE_TYPE, OperatorStatus } from "@/types/service";
import { base64ToBytes } from "./protocol";

/** Operator metadata of a content-scanner worker (contentscan.OperatorMetadata). */
export interface OperatorMetadata {
  v: number;
  /** base64 ed25519 public key. */
  verdict_key: string;
  /** Base URL of the feed; manifest.json lives under it. */
  feed_url: string;
  ruleset_version?: string;
  models?: Record<string, string>;
}

export interface ScannerWorker {
  address: string;
  verdictKey: string;
  feedUrl: string;
}

export interface ScannerSetup {
  workers: ScannerWorker[];
  /** ServiceTypeConfig.attestation_quorum; 0 = the type does not attest. */
  quorum: number;
  /** ServiceTypeConfig.elevated_attestation_quorum, already defaulted to `quorum`. */
  elevatedQuorum: number;
  /** Latest checkpoint height per worker address (MsgSubmitCheckpoint). */
  checkpoints: Record<string, number>;
}

/** Decode operator metadata bytes (base64 in LCD JSON). Null if it isn't scanner metadata. */
export function parseOperatorMetadata(b64: string): OperatorMetadata | null {
  const bytes = base64ToBytes(b64 || "");
  if (!bytes) return null;
  try {
    const m = JSON.parse(new TextDecoder().decode(bytes)) as Partial<OperatorMetadata>;
    const key = base64ToBytes(typeof m.verdict_key === "string" ? m.verdict_key : "");
    if (!key || key.length !== 32) return null;
    if (typeof m.feed_url !== "string" || !/^https?:\/\//i.test(m.feed_url)) return null;
    return m as OperatorMetadata;
  } catch {
    return null;
  }
}

const PAGE = "200";

async function activeWorkers(): Promise<ScannerWorker[]> {
  const out: ScannerWorker[] = [];
  let key: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await listServiceOperatorsByServiceType(CONTENT_SCANNER_SERVICE_TYPE, { limit: PAGE, key });
    for (const op of res.operators || []) {
      if (op.status !== OperatorStatus.ACTIVE) continue;
      const meta = parseOperatorMetadata(op.metadata);
      if (meta) out.push({ address: op.address, verdictKey: meta.verdict_key, feedUrl: meta.feed_url });
    }
    key = res.pagination?.next_key || undefined;
    if (!key) break;
  }
  return out;
}

async function checkpointHeights(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    let key: string | undefined;
    for (let i = 0; i < 20; i++) {
      const res = await listCheckpointsByServiceType(CONTENT_SCANNER_SERVICE_TYPE, { limit: PAGE, key });
      for (const cp of res.checkpoints || []) {
        const h = parseInt(cp.height, 10);
        if (Number.isFinite(h)) out[cp.operator] = h;
      }
      key = res.pagination?.next_key || undefined;
      if (!key) break;
    }
  } catch (err) {
    // A node predating checkpoints: heights then come from the feeds alone.
    if (!isMissingEndpoint(err)) throw err;
  }
  return out;
}

/**
 * Read the scanner setup from the chain. A chain without the content-scanner
 * type, or with no ACTIVE workers, yields an empty worker list: everything
 * flagged stays unchecked and plain text keeps working.
 */
export async function loadScannerSetup(): Promise<ScannerSetup> {
  let quorum = 0;
  let elevated = 0;
  try {
    const { config } = await getServiceType(CONTENT_SCANNER_SERVICE_TYPE);
    quorum = Number(config?.attestation_quorum ?? 0) || 0;
    elevated = Number(config?.elevated_attestation_quorum ?? 0) || 0;
  } catch (err) {
    if (isMissingEndpoint(err)) return { workers: [], quorum: 0, elevatedQuorum: 0, checkpoints: {} };
    throw err;
  }
  if (quorum < 1) return { workers: [], quorum: 0, elevatedQuorum: 0, checkpoints: {} };
  const [workers, checkpoints] = await Promise.all([activeWorkers(), checkpointHeights()]);
  return { workers, quorum, elevatedQuorum: Math.max(quorum, elevated), checkpoints };
}
