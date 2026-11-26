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
// Storage operators don't checkpoint, so nothing here proves a worker is
// running: the report says an operator is in place and funded, and shows what
// is waiting.

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

  if (!input.siteOffers) issues.push("New permanent copies are switched off by the site operator.");
  return report(issues.length ? "degraded" : "ok", issues, facts);
}
