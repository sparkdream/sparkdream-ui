// How the Status page judges the chain's permanent copy on Arweave (chain
// repo: deploy/docs/archival-strategy.md, "Chain Archiver").
//
// The chain holds one claim per archiver: a checkpoint whose `height` is the
// last block archived and whose `root` is the id of the Arweave transaction
// holding the newest range. This file turns that claim, the chain's height and
// what a gateway says about the transaction into one report. It only judges;
// lib/siteStatus.ts does the reading.
//
// Archiving is voluntary and best effort, so the chain may set no limit on
// how far a checkpoint trails (checkpoint_max_lag_blocks of 0) and then files
// no report against an archiver that falls behind. The page still says when
// the copy trails, against a limit of its own.
//
// The checkpoint is the worker's claim; what the worker (cmd/archiveworker in
// the chain repo) is doing shows on Arweave, under the wallets the operator
// lists: the newest range it has uploaded, which can be ahead of the
// checkpoint (a range is checkpointed once it has confirmations), and what
// is left in the wallet it pays from, since it stops when that can't pay for
// the next range. Uploads that run well ahead of the checkpoint mean the
// worker is running and its checkpoints aren't getting through.
//
// It does not download or replay anything. `archiveworker verify` is the real
// check of the copy; this is whether the copy is keeping up and whether its
// newest range is where the chain says it is.

import { parseArchiverMetadata } from "./chainArchiver";
import { formatAge, type ServiceFact, type ServiceReport } from "./serviceStatus";
import { copiesAfforded, formatAr } from "./storageFunds";
import { OperatorStatus, OPERATOR_STATUS_LABELS, type Checkpoint, type Operator } from "@/types/service";

/** `App-Name` tag on every transaction the archiver posts. */
export const ARCHIVE_APP_NAME = "sparkdream-block-archive";

/** What a gateway's index says about one transaction. */
export interface ArweaveTx {
  /** Address of the wallet that signed it. */
  owner: string;
  tags: Record<string, string>;
  /** When it was mined, epoch ms. Null while it is still pending. */
  minedAt: number | null;
}

// Where the chain sets no limit: about two days of blocks. A range is 10,000
// blocks, so this is a late range with a full range of slack and the time
// Arweave takes to confirm. It was the chain's own limit while it had one.
export const ARCHIVE_STALE_BLOCKS = 34_560;

/** What Arweave shows of the leading archiver's worker. */
export interface ArchiveWorker {
  /**
   * The newest range signed by a listed wallet: null when the index knows
   * none, undefined when it couldn't be asked.
   */
  newest?: { from: number; to: number; minedAt: number | null } | null;
  /** Winston across the listed wallets. Null when a balance couldn't be read. */
  balance: string | null;
  /** What the network charges now for a range the size of the newest, in winston. Null when unknown. */
  rangePrice: string | null;
}

// A range is this many blocks (x/service ChainArchiverRangeBlocks). Uploads
// this far ahead of the checkpoint are two ranges nobody checkpointed.
export const RANGE_BLOCKS = 10_000;

export interface ArchiverInput {
  chainId: string;
  /**
   * The type's checkpoint_max_lag_blocks: 0 when the chain sets no limit,
   * null when it has no enabled chain-archiver service type.
   */
  maxLagBlocks: number | null;
  operators: Operator[];
  checkpoints: Checkpoint[];
  latestHeight: number;
  /**
   * The leading checkpoint's transaction as the gateway knows it: null when
   * the gateway answered and has no such transaction, undefined when it could
   * not be asked (down, no index, no checkpoint to ask about).
   */
  tx?: ArweaveTx | null;
  /** Absent when the operator lists no wallet or Arweave wasn't asked. */
  worker?: ArchiveWorker;
  now: number;
}

const n = (v: number) => v.toLocaleString("en-US");
const blocks = (v: number) => `${n(v)} ${v === 1 ? "block" : "blocks"}`;

function height(v: string | undefined): number {
  return v && /^\d+$/.test(v) ? Number(v) : 0;
}

/**
 * A checkpoint root as an Arweave transaction id: the same 32 bytes, base64
 * on the chain and unpadded base64url on Arweave. "" if it isn't 32 bytes.
 */
export function checkpointTxId(root: string): string {
  const id = (root || "").trim().replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : "";
}

export interface Leader {
  operator: Operator;
  checkpoint: Checkpoint | null;
}

/** The active archiver whose checkpoint reaches furthest: the copy a reader would use. */
export function leadingArchiver(operators: Operator[], checkpoints: Checkpoint[]): Leader | null {
  const byOperator = new Map(checkpoints.map((c) => [c.operator, c]));
  let best: Leader | null = null;
  for (const operator of operators) {
    if (operator.status !== OperatorStatus.ACTIVE) continue;
    const checkpoint = byOperator.get(operator.address) ?? null;
    if (!best || height(checkpoint?.height) > height(best.checkpoint?.height)) best = { operator, checkpoint };
  }
  return best;
}

/** The worker's rows and problems. `archived` is the checkpoint's height, 0 before the first. */
function assessWorker(w: ArchiveWorker, archived: number, now: number): { facts: ServiceFact[]; issues: string[] } {
  const facts: ServiceFact[] = [];
  const issues: string[] = [];
  if (w.newest === null) {
    facts.push({ label: "Newest upload", value: "None found on Arweave" });
  } else if (w.newest) {
    const when = w.newest.minedAt === null ? "waiting for confirmation" : `${formatAge(Math.max(0, now - w.newest.minedAt))} ago`;
    facts.push({ label: "Newest upload", value: `Blocks ${n(w.newest.from)} to ${n(w.newest.to)}, ${when}` });
    const ahead = w.newest.to - archived;
    if (archived > 0 && ahead >= 2 * RANGE_BLOCKS) {
      issues.push(
        `The worker has uploaded through block ${n(w.newest.to)} but checkpointed only through ${n(archived)}, so it is running and its checkpoints aren't getting through.`
      );
    }
  }
  if (w.balance !== null) {
    const more = copiesAfforded(w.balance, w.rangePrice);
    facts.push({
      label: "Worker funds",
      value: `${formatAr(w.balance)} AR${more === null ? "" : more >= 1000 ? ", over 1,000 more ranges" : `, about ${n(more)} more ${more === 1 ? "range" : "ranges"}`}`,
    });
    if (more === 0 || /^0+$/.test(w.balance)) {
      issues.push("The archiver's Arweave wallet can't pay for the next range, so uploads wait until it is funded.");
    }
  }
  return { facts, issues };
}

export function assessArchiver(input: ArchiverInput): ServiceReport {
  const id = "archiver";
  const report = (state: ServiceReport["state"], issues: string[], facts: ServiceFact[] = []): ServiceReport => ({
    id,
    state,
    issues,
    latency_ms: null,
    facts,
  });

  if (input.maxLagBlocks === null) {
    return report("off", ["This chain doesn't track a permanent copy of its block history."]);
  }
  const leader = leadingArchiver(input.operators, input.checkpoints);
  if (!leader) {
    const idle = input.operators.filter((o) => o.status !== OperatorStatus.RETIRED);
    if (idle.length === 0) {
      return report("off", ["No archiver is registered on this chain yet, so it tracks no permanent copy."]);
    }
    const why = [...new Set(idle.map((o) => (OPERATOR_STATUS_LABELS[o.status] ?? "Unknown").toLowerCase()))];
    return report("degraded", [`No archiver is active (${why.join(", ")}), so new blocks aren't being archived.`]);
  }

  const active = input.operators.filter((o) => o.status === OperatorStatus.ACTIVE).length;
  const facts: ServiceFact[] = [{ label: "Archivers", value: `${n(active)} active` }];
  const issues: string[] = [];
  const { operator, checkpoint } = leader;
  // The chain's limit, which it enforces with a report, or the page's own.
  const enforced = input.maxLagBlocks > 0;
  const maxLag = enforced ? input.maxLagBlocks : ARCHIVE_STALE_BLOCKS;

  if (!checkpoint) {
    facts.push({ label: "Archived through block", value: "None yet" });
    // Measured from registration, as the chain measures a new archiver.
    const waited = input.latestHeight - height(operator.registered_at);
    const overdue = waited - maxLag;
    if (input.latestHeight > 0 && overdue > 0) {
      issues.push(
        enforced
          ? `The archiver hasn't made its first checkpoint, due ${blocks(overdue)} ago.`
          : `The archiver registered ${blocks(waited)} ago and hasn't made its first checkpoint.`
      );
    } else if (enforced && input.latestHeight > 0) {
      facts.push({ label: "First checkpoint", value: `Due within ${blocks(-overdue)}` });
    }
    if (input.worker) {
      const w = assessWorker(input.worker, 0, input.now);
      facts.push(...w.facts);
      issues.push(...w.issues);
    }
    return report(issues.length ? "degraded" : "ok", issues, facts);
  }

  const archived = height(checkpoint.height);
  facts.push({ label: "Archived through block", value: n(archived) });
  if (input.latestHeight > 0) {
    const lag = Math.max(0, input.latestHeight - archived);
    facts.push({
      label: "Behind the chain",
      value: enforced ? `${blocks(lag)}, limit ${n(maxLag)}` : `${blocks(lag)}, normally within ${n(maxLag)}`,
    });
    if (lag > maxLag) {
      issues.push(
        enforced
          ? `The permanent copy is ${blocks(lag)} behind the chain, past the ${n(maxLag)} the chain allows.`
          : `The permanent copy is ${blocks(lag)} behind the chain. The archiver normally keeps it within ${n(maxLag)}.`
      );
    }
  }

  const txId = checkpointTxId(checkpoint.root);
  if (!txId) {
    issues.push("The checkpoint doesn't name an Arweave transaction.");
    return report("degraded", issues, facts);
  }
  facts.push({ label: "Arweave transaction", value: txId });

  const tx = input.tx;
  if (tx === undefined) {
    // A gateway being down says nothing about the copy.
    facts.push({ label: "On Arweave", value: "Not checked, the gateway's index didn't answer" });
  } else if (tx === null) {
    issues.push("The gateway has no record of the Arweave transaction the checkpoint names.");
  } else {
    const from = height(tx.tags["Block-Range-From"]);
    const to = height(tx.tags["Block-Range-To"]);
    const isRange =
      tx.tags["App-Name"] === ARCHIVE_APP_NAME &&
      tx.tags["Archive-Kind"] === "blocks" &&
      tx.tags["Archive-Format"] === "1" &&
      tx.tags["Chain-ID"] === input.chainId &&
      to === archived;
    if (!isRange) {
      issues.push("The Arweave transaction the checkpoint names isn't the block range ending at that height.");
    } else if (from > 0) {
      facts.push({ label: "Checkpointed range", value: `Blocks ${n(from)} to ${n(to)}` });
    }
    const wallets = parseArchiverMetadata(operator.metadata)?.wallets;
    if (!wallets) {
      issues.push("The archiver's registration doesn't list its Arweave wallets, so its uploads can't be attributed.");
    } else if (!wallets.includes(tx.owner)) {
      issues.push("The newest range is signed by a wallet the archiver doesn't list.");
    }
    facts.push({ label: "Signed by wallet", value: tx.owner });
    facts.push({
      label: "Stored on Arweave",
      value: tx.minedAt === null ? "Pending" : `${formatAge(Math.max(0, input.now - tx.minedAt))} ago`,
    });
    if (tx.minedAt === null) issues.push("The newest range isn't confirmed on Arweave yet.");
  }

  if (input.worker) {
    const w = assessWorker(input.worker, archived, input.now);
    facts.push(...w.facts);
    issues.push(...w.issues);
  }
  return report(issues.length ? "degraded" : "ok", issues, facts);
}

/**
 * Read a gateway's GraphQL answer for the latest ranges of some wallets
 * (`transactions(owners, tags, sort: HEIGHT_DESC)`) and return the one that
 * reaches furthest, with its size in bytes. The index orders by the Arweave
 * block a transaction was mined in, and several ranges can share one, so
 * the first listed is not always the furthest: the worker's own reader takes
 * the highest `Block-Range-To` too. Null when the index knows none,
 * undefined if it isn't an answer.
 */
export function parseNewestRange(
  body: unknown
): { from: number; to: number; minedAt: number | null; size: number } | null | undefined {
  const edges = (body as { data?: { transactions?: { edges?: unknown } } } | null)?.data?.transactions?.edges;
  if (!Array.isArray(edges)) return undefined;
  if (edges.length === 0) return null;
  type Node = { tags?: unknown; block?: { timestamp?: unknown } | null; data?: { size?: unknown } };
  let best: { from: number; to: number; minedAt: number | null; size: number } | undefined;
  for (const edge of edges as { node?: Node }[]) {
    const node = edge?.node;
    if (!node || !Array.isArray(node.tags)) continue;
    const tag = (name: string) => {
      const value = (node.tags as { name?: unknown; value?: unknown }[]).find((t) => t?.name === name)?.value;
      return typeof value === "string" ? value : undefined;
    };
    const from = height(tag("Block-Range-From"));
    const to = height(tag("Block-Range-To"));
    if (from < 1 || to < from || (best && to <= best.to)) continue;
    const ts = node.block?.timestamp;
    const size = typeof node.data?.size === "string" && /^\d+$/.test(node.data.size) ? Number(node.data.size) : 0;
    best = { from, to, minedAt: typeof ts === "number" ? ts * 1000 : null, size };
  }
  return best;
}

/** Read a gateway's GraphQL answer for `transaction(id)`. Undefined if it isn't one. */
export function parseArweaveTx(body: unknown): ArweaveTx | null | undefined {
  const data = (body as { data?: { transaction?: unknown } } | null)?.data;
  if (!data || typeof data !== "object" || !("transaction" in data)) return undefined;
  if (data.transaction === null) return null;
  const t = data.transaction as {
    owner?: { address?: unknown };
    tags?: unknown;
    block?: { timestamp?: unknown } | null;
  };
  if (typeof t.owner?.address !== "string" || !Array.isArray(t.tags)) return undefined;
  const tags: Record<string, string> = {};
  for (const tag of t.tags as { name?: unknown; value?: unknown }[]) {
    // The first of a repeated name wins.
    if (typeof tag?.name === "string" && typeof tag.value === "string" && !(tag.name in tags)) {
      tags[tag.name] = tag.value;
    }
  }
  const ts = t.block?.timestamp;
  return { owner: t.owner.address, tags, minedAt: typeof ts === "number" ? ts * 1000 : null };
}
