// How the Status page judges the federation bridges (x/federation): the
// off-chain operators that bring posts in from other networks, such as a
// Mastodon server, each bound to one peer.
//
// A bridge can submit when its binding isn't suspended, its x/service
// operator is ACTIVE and its peer is ACTIVE. The chain also keeps the time of
// each binding's last submission and warns (an event, nothing more) once that
// is older than bridge_inactivity_threshold rate-limit windows; the same rule
// is applied here. This file only judges; lib/siteStatus.ts does the reading.
//
// Bridges don't checkpoint and a quiet peer gives them nothing to submit, so
// short of that limit nothing here proves a bridge's daemon is running. The
// endpoint a binding names is the peer's own server (a Mastodon instance),
// not the daemon: whether it answers says whether there is anything to bridge.

import { formatAge, type ServiceFact, type ServiceReport } from "./serviceStatus";
import { OperatorStatus, OPERATOR_STATUS_LABELS, type Operator } from "@/types/service";
import type { BridgeBinding } from "@/types/federation";

/** x/service types of the bridge operators all start with this. */
export const BRIDGE_SERVICE_TYPE_PREFIX = "federation-bridge-";

export interface BridgeInput {
  /** Null when the chain has no x/federation. */
  bindings: BridgeBinding[] | null;
  /** Status of each peer by id (PEER_STATUS_*). */
  peers: Record<string, string>;
  /** x/service operators of the bridge types. */
  operators: Operator[];
  /**
   * Whether each binding's endpoint (the peer's server) answered, by the
   * endpoint as written on chain. Missing or null: not checked, because the
   * address isn't one this server will contact.
   */
  reachable?: Record<string, boolean | null>;
  /** Seconds without a submission after which the chain warns. 0 = no limit. */
  inactivitySeconds: number;
  now: number;
}

const n = (v: number) => v.toLocaleString("en-US");
const PEER_ACTIVE = "PEER_STATUS_ACTIVE";
// More bridges than this are summarised by the counts alone.
const MAX_LISTED = 5;

function seconds(v: string | undefined): number {
  return v && /^\d+$/.test(v) ? Number(v) : 0;
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export function assessBridges(input: BridgeInput): ServiceReport {
  const id = "bridges";
  const report = (state: ServiceReport["state"], issues: string[], facts: ServiceFact[] = []): ServiceReport => ({
    id,
    state,
    issues,
    latency_ms: null,
    facts,
  });
  if (input.bindings === null) return report("off", ["This chain doesn't federate with other networks."]);
  if (input.bindings.length === 0) return report("off", ["No federation bridge is registered on this chain."]);

  // One address may bridge under several types: an ACTIVE record wins.
  const operators = new Map<string, Operator>();
  for (const o of input.operators) {
    if (operators.get(o.address)?.status !== OperatorStatus.ACTIVE) operators.set(o.address, o);
  }
  const issues: string[] = [];
  const listed: ServiceFact[] = [];
  let working = 0;
  let submitted = 0;

  for (const b of input.bindings) {
    submitted += seconds(b.content_submitted);
    const operator = operators.get(b.address);
    const last = seconds(b.last_submission_at) * 1000;
    const quiet = last > 0 ? Math.max(0, input.now - last) : null;
    let problem = "";
    if (b.suspended) {
      problem = `The bridge to ${b.peer_id} is suspended because its operator's bond is underfunded.`;
    } else if (operator?.status !== OperatorStatus.ACTIVE) {
      const why = operator ? (OPERATOR_STATUS_LABELS[operator.status] ?? "unknown").toLowerCase() : "not registered";
      problem = `The bridge to ${b.peer_id} has no active operator (${why}).`;
    } else if ((input.peers[b.peer_id] ?? PEER_ACTIVE) !== PEER_ACTIVE) {
      problem = `The peer ${b.peer_id} is not active, so nothing is exchanged with it.`;
    } else if (quiet !== null && input.inactivitySeconds > 0 && quiet > input.inactivitySeconds * 1000) {
      problem = `The bridge to ${b.peer_id} has brought nothing in for ${formatAge(quiet)}, past the chain's inactivity limit.`;
    }
    const answers = input.reachable?.[b.endpoint] ?? null;
    if (!problem && answers === false) {
      problem = `${endpointHost(b.endpoint)} isn't answering, so the bridge to ${b.peer_id} has nothing to bring in.`;
    }
    if (problem) issues.push(problem);
    else working++;
    listed.push({
      label: b.peer_id,
      value: `${b.protocol || "bridge"}, ${quiet === null ? "nothing brought in yet" : `last post ${formatAge(quiet)} ago`}`,
    });
    if (b.endpoint) {
      listed.push({
        label: `${endpointHost(b.endpoint)} endpoint`,
        value: answers === null ? "Not checked" : answers ? "Answering" : "Not answering",
      });
    }
  }

  const facts: ServiceFact[] = [{ label: "Bridges", value: `${n(working)} of ${n(input.bindings.length)} working` }];
  if (input.bindings.length <= MAX_LISTED) facts.push(...listed);
  facts.push({ label: "Posts brought in", value: n(submitted) });
  return report(issues.length ? "degraded" : "ok", issues.slice(0, MAX_LISTED), facts);
}
