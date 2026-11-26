// How the Status page judges permanent copies (x/storage; chain repo:
// docs/x-storage-spec.md): whether a member's request to copy a scanned image
// to Arweave can be taken right now.
//
// A request is taken by a storage operator that is ACTIVE in x/service and
// approved for the backend by its controller, and for a scanned type the
// chain refuses the request unless enough approved, active content scanners
// exist to clear the file. This file turns those lists into one report; it
// only judges, lib/siteStatus.ts does the reading.
//
// A worker says it is running with a checkpoint (cmd/storageworker in the
// chain repo: every 600 blocks by default, the height its last clean pass
// read and, as the root, the Arweave wallet it uploads from). A worker that
// has checkpointed and then stops doing so has stopped. One that never has
// may predate checkpoints or hold a session key without the message, so for
// it the chain holds only what the worker did: the height of its last claim
// or completion, the claims it let lapse, and how long the oldest request
// has waited. A request that has waited past one claim window with no
// operator acting since it opened is then the nearest thing to "the worker
// has stopped", and is reported as that possibility, not as a fact: a worker
// also leaves alone a file it can't fetch or that isn't cleared.

import { formatAr, operatorWallets } from "./storageFunds";
import type { ServiceFact, ServiceReport } from "./serviceStatus";
import { OperatorStatus, OPERATOR_STATUS_LABELS, type Operator } from "@/types/service";
import type { ApprovedOperator, ApprovedScanner, StorageBackend } from "@/types/storage";

export interface StorageInput {
  /** x/storage's own switch. Null when the chain has no x/storage. */
  enabled: boolean | null;
  /** The backend judged, or null when the chain has none. */
  backend: StorageBackend | null;
  /** x/service operators of the backend's service type. */
  operators: Operator[];
  approvedOperators: ApprovedOperator[];
  /** x/service operators of the content-scanner type. */
  scanners: Operator[];
  approvedScanners: ApprovedScanner[];
  /** The content-scanner type's attestation_quorum. */
  scannerQuorum: number;
  /** Requests waiting for an operator, and claimed by one. Null when unread. */
  pending: number | null;
  claimed: number | null;
  /** Winston per Arweave wallet of the ready operators; null where the node didn't answer. */
  balances: Record<string, string | null>;
  /** The site's own switch (ARWEAVE_UPLOADS_DISABLED). */
  siteOffers: boolean;
  /** What the chain holds of the ready operators' workers. Absent when unread. */
  worker?: WorkerEvidence;
}

export interface WorkerEvidence {
  latestHeight: number;
  /** Height of the newest claim or completion by a ready operator. Null: none on record. */
  lastActedAt: number | null;
  /** Claims the ready operators let lapse in the current counting window. */
  lapses: number;
  /** Height the longest-waiting pending request was opened at. Null: nothing waits. */
  oldestWaitingSince: number | null;
  /** claim_window_blocks: a wait past this with no operator acting is reported. */
  stuckAfterBlocks: number;
  /** The newest checkpoint among the ready operators. Null: none has checkpointed. */
  checkpoint: { height: number; wallet: string } | null;
  /** The service type's checkpoint_max_lag_blocks. 0: the chain sets no limit. */
  checkpointMaxLag: number;
}

// Workers checkpoint every 600 blocks unless told otherwise. Without a limit
// from the chain, three missed checkpoints is a worker that has stopped.
export const CHECKPOINT_STALE_BLOCKS = 1_800;

/** A checkpoint root (32 bytes, base64) as the Arweave address it encodes. "" if it isn't one. */
export function checkpointWallet(root: string): string {
  const address = (root || "").trim().replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return /^[A-Za-z0-9_-]{43}$/.test(address) ? address : "";
}

const n = (v: number) => v.toLocaleString("en-US");

/** Operators that can take a request now: ACTIVE, with an approval that still counts. */
export function readyOperators(operators: Operator[], approved: ApprovedOperator[]): Operator[] {
  const counting = new Set(approved.filter((a) => !a.stale).map((a) => a.operator));
  return operators.filter((o) => o.status === OperatorStatus.ACTIVE && counting.has(o.address));
}

export function assessStorage(input: StorageInput): ServiceReport {
  const id = "storage";
  const report = (state: ServiceReport["state"], issues: string[], facts: ServiceFact[] = []): ServiceReport => ({
    id,
    state,
    issues,
    latency_ms: null,
    facts,
  });

  const { backend } = input;
  if (input.enabled === null || !backend) {
    return report("off", ["This chain doesn't make permanent copies."]);
  }
  if (!input.enabled || !backend.enabled) {
    return report("off", ["Permanent copies are switched off on this chain."]);
  }
  const live = input.operators.filter((o) => o.status !== OperatorStatus.RETIRED);
  if (live.length === 0) {
    return report("off", ["No storage operator is registered on this chain yet, so permanent copies can't be made."]);
  }

  const issues: string[] = [];
  const ready = readyOperators(input.operators, input.approvedOperators);
  const facts: ServiceFact[] = [{ label: "Storage operators", value: `${n(ready.length)} ready` }];

  if (ready.length === 0) {
    const active = live.filter((o) => o.status === OperatorStatus.ACTIVE);
    if (active.length > 0) {
      issues.push(
        `No storage operator is approved for the ${backend.name} backend, so requests wait until one is. The operator's controller approves it.`
      );
    } else {
      const why = [...new Set(live.map((o) => (OPERATOR_STATUS_LABELS[o.status] ?? "Unknown").toLowerCase()))];
      issues.push(`No storage operator is active (${why.join(", ")}), so requests wait until one is.`);
    }
  }

  // A scanned type needs a quorum of approved, active scanners, or the chain
  // refuses the request outright (spec §3.5).
  if ((backend.types || []).some((t) => t.scanned)) {
    const counting = new Set(input.approvedScanners.filter((a) => !a.stale).map((a) => a.scanner));
    const scanners = input.scanners.filter((s) => s.status === OperatorStatus.ACTIVE && counting.has(s.address)).length;
    facts.push({ label: "Approved scanners", value: `${n(scanners)}, ${n(input.scannerQuorum)} must agree` });
    if (input.scannerQuorum < 1) {
      issues.push("Content scanning isn't set up on this chain, so it refuses new requests for images.");
    } else if (scanners < input.scannerQuorum) {
      issues.push(
        `Only ${n(scanners)} of the ${n(input.scannerQuorum)} content scanners needed ${scanners === 1 ? "is" : "are"} approved for permanent copies, so the chain refuses new requests for images.`
      );
    }
  }

  if (input.pending !== null) facts.push({ label: "Waiting for an operator", value: n(input.pending) });
  if (input.claimed !== null) facts.push({ label: "Being copied", value: n(input.claimed) });

  // What the ready operators have to pay Arweave with. Their wallets are
  // their own statement (lib/storageFunds.ts); the balances are public.
  if (ready.length > 0) {
    const wallets = [...new Set(ready.flatMap((o) => operatorWallets(o.metadata, backend.name)))];
    const known = wallets.map((w) => input.balances[w]).filter((b): b is string => typeof b === "string" && /^\d+$/.test(b));
    if (wallets.length === 0) {
      issues.push("No ready operator lists an Arweave wallet, so its funds and its copies can't be told apart from anyone's.");
    } else if (known.length === wallets.length) {
      const total = known.reduce((sum, b) => sum + BigInt(b), BigInt(0));
      facts.push({ label: "Operator funds", value: `${formatAr(total.toString())} AR` });
      if (total === BigInt(0)) issues.push("The operators' Arweave wallets are empty, so no copy can be paid for.");
    } else {
      facts.push({ label: "Operator funds", value: "Not checked, the gateway didn't answer" });
    }
  }

  const w = input.worker;
  if (w && ready.length > 0 && w.latestHeight > 0) {
    const ago = (h: number) => `${n(Math.max(0, w.latestHeight - h))} blocks ago`;
    let running = false;
    if (w.checkpoint) {
      const limit = w.checkpointMaxLag > 0 ? w.checkpointMaxLag : CHECKPOINT_STALE_BLOCKS;
      const behind = Math.max(0, w.latestHeight - w.checkpoint.height);
      running = behind <= limit;
      facts.push({ label: "Worker last checked in", value: `${ago(w.checkpoint.height)}, limit ${n(limit)}` });
      if (!running) {
        issues.push(`The worker last checked in ${n(behind)} blocks ago, so it has probably stopped. Requests wait until it runs again.`);
      }
      const listed = ready.flatMap((o) => operatorWallets(o.metadata, backend.name));
      if (w.checkpoint.wallet && listed.length > 0 && !listed.includes(w.checkpoint.wallet)) {
        issues.push("The worker uploads from an Arweave wallet its operator doesn't list.");
      }
    } else {
      facts.push({ label: "Worker last checked in", value: "Never" });
    }
    facts.push({ label: "Worker last acted", value: w.lastActedAt === null ? "No claim or copy on record" : ago(w.lastActedAt) });
    if (w.oldestWaitingSince !== null) {
      const waited = Math.max(0, w.latestHeight - w.oldestWaitingSince);
      facts.push({ label: "Longest wait", value: `${n(waited)} blocks` });
      const actedSince = w.lastActedAt !== null && w.lastActedAt >= w.oldestWaitingSince;
      // A worker that checks in is running: a long wait is then its choice.
      if (w.stuckAfterBlocks > 0 && waited > w.stuckAfterBlocks && !actedSince && !w.checkpoint) {
        issues.push(
          `A request has waited ${n(waited)} blocks and no operator has acted since it was opened. The worker may be stopped, or it can't fetch the file or the scanners haven't cleared it.`
        );
      }
    }
    if (w.lapses > 0) {
      facts.push({ label: "Lapsed claims", value: n(w.lapses) });
      issues.push(
        `${w.lapses === 1 ? "A claim was" : `${n(w.lapses)} claims were`} left to lapse recently: the worker took ${w.lapses === 1 ? "a request" : "requests"} and didn't finish.`
      );
    }
  }

  if (!input.siteOffers) issues.push("New permanent copies are switched off by the site operator.");
  return report(issues.length ? "degraded" : "ok", issues, facts);
}
