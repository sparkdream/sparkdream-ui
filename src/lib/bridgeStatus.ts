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
// What a bridge brings in is not trusted until a verifier has fetched the
// post itself and found the same content (cmd/sdapverify in the chain repo).
// Verifiers are members who hold the bonded federation-verifier role in
// x/rep, apart from the bridge operators by design. Their part is judged
// here too: whether one is bonded and in good standing, and whether posts
// are left waiting. A verifier's daemon polls every minute or so, so a post
// still waiting after VERIFY_WAIT_MS has no verifier attending to it.
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
  /**
   * Reports against each bridge operator that nobody has resolved yet
   * (pending, or escalated to a jury), by operator address. Missing or null:
   * not read.
   */
  openReports?: Record<string, number | null>;
  /** Display name of the bond's denomination, for the operator's row ("SPARK"). */
  bondSymbol?: string;
  /** The verifiers' side. Absent when it couldn't be read. */
  verifiers?: VerifierInput;
  now: number;
}

export interface VerifierInput {
  /** How many members hold the verifier role. */
  holders: number;
  /** How many of them the chain lets verify now by their bond (canVerify). */
  able: number;
  /**
   * How many of those are locked out by the overturn cooldown: a verifier
   * whose verifications were overturned on challenge may not verify until it
   * ends. Null or absent when unread.
   */
  cooling?: number | null;
  /** When the first of those locked out may verify again, epoch ms. */
  coolingEndsAt?: number | null;
  /** Posts verified by them so far. Null when unread. */
  verified: number | null;
  /** Bridged posts waiting for a verifier. Null when unread. */
  pending: number | null;
  /** When the longest-waiting of those was brought in, epoch ms. Null when none or unread. */
  oldestPendingAt: number | null;
}

/** A holder of the verifier role, as x/rep's bonded role record gives it. */
export interface VerifierRole {
  bond_status?: string;
  current_bond?: string;
  pending_unbond_amount?: string;
}

/**
 * Whether the chain lets this verifier verify, by x/rep's EligibleForRole:
 * normal and recovery outright; unbonding only while the bond that stays
 * (current less what is being withdrawn) still covers the role's minimum, so
 * a partial withdrawal keeps the verifier working; demoted never.
 */
export function canVerify(role: VerifierRole, minBond: string): boolean {
  const big = (v: string | undefined) => (v && /^\d+$/.test(v) ? BigInt(v) : BigInt(0));
  switch (role.bond_status) {
    case "BONDED_ROLE_STATUS_NORMAL":
    case "BONDED_ROLE_STATUS_RECOVERY":
      return true;
    case "BONDED_ROLE_STATUS_UNBONDING":
      return big(role.current_bond) - big(role.pending_unbond_amount) >= big(minBond);
    default:
      return false;
  }
}

// A verifier's daemon polls about every minute. A post that has waited this
// long has nobody verifying it.
export const VERIFY_WAIT_MS = 60 * 60_000;

const n = (v: number) => v.toLocaleString("en-US");
const PEER_ACTIVE = "PEER_STATUS_ACTIVE";
// More bridges than this are summarised by the counts alone.
const MAX_LISTED = 5;

function seconds(v: string | undefined): number {
  return v && /^\d+$/.test(v) ? Number(v) : 0;
}

/** A micro-denominated amount in whole units, rounded down ("1,000"). */
function wholeUnits(micro: string | undefined): string {
  return micro && /^\d+$/.test(micro) ? (BigInt(micro) / BigInt(1_000_000)).toLocaleString("en-US") : "0";
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

    // The operator behind the bridge: its standing in x/service, what the
    // verifiers made of its posts, and anything reported against it.
    const open = input.openReports?.[b.address] ?? null;
    const standing = operator ? (OPERATOR_STATUS_LABELS[operator.status] ?? "Unknown") : "Not registered";
    const bond = operator ? `, ${wholeUnits(operator.bond_amount)}${input.bondSymbol ? ` ${input.bondSymbol}` : ""} bonded` : "";
    const reports = open ? `, ${n(open)} open ${open === 1 ? "report" : "reports"}` : "";
    listed.push({ label: `${b.peer_id} operator`, value: `${standing}${bond}${reports}` });
    listed.push({
      label: `${b.peer_id} posts`,
      value: `${n(seconds(b.content_verified))} verified, ${n(seconds(b.content_rejected))} rejected, ${n(seconds(b.content_unverified))} unverified`,
    });
    // A rejection is a verifier finding that a post was not what the bridge said it was.
    const rejected = seconds(b.epoch_rejected);
    if (rejected > 0) {
      issues.push(
        `${rejected === 1 ? "A post" : `${n(rejected)} posts`} from the bridge to ${b.peer_id} ${rejected === 1 ? "was" : "were"} rejected on verification in the current reward period.`
      );
      if (!problem) working--;
    }
  }

  const facts: ServiceFact[] = [{ label: "Bridges", value: `${n(working)} of ${n(input.bindings.length)} working` }];
  if (input.bindings.length <= MAX_LISTED) facts.push(...listed);
  facts.push({ label: "Posts brought in", value: n(submitted) });

  // With many bridges only the first few problems are spelled out. What
  // follows is about the verifiers and is never cut for them.
  issues.splice(MAX_LISTED);
  const v = input.verifiers;
  if (v) {
    const able = v.able;
    facts.push({
      label: "Verifiers",
      value: v.holders === able ? `${n(able)} in good standing` : `${n(able)} of ${n(v.holders)} in good standing`,
    });
    if (v.verified !== null) facts.push({ label: "Posts verified", value: n(v.verified) });
    const waited = v.oldestPendingAt !== null ? Math.max(0, input.now - v.oldestPendingAt) : null;
    if (v.pending !== null) {
      facts.push({
        label: "Waiting for verification",
        value: v.pending > 0 && waited !== null ? `${n(v.pending)}, the oldest for ${formatAge(waited)}` : n(v.pending),
      });
    }
    const cooling = Math.min(able, Math.max(0, v.cooling ?? 0));
    const freeIn = v.coolingEndsAt != null ? Math.max(0, v.coolingEndsAt - input.now) : null;
    if (cooling > 0) {
      facts.push({
        label: "Overturn cooldown",
        value: `${n(cooling)} ${cooling === 1 ? "verifier" : "verifiers"} locked out${freeIn !== null ? `, the first free in ${formatAge(freeIn)}` : ""}`,
      });
    }
    if (able === 0) {
      issues.push("No federation verifier is bonded and in good standing, so what the bridges bring in stays unverified.");
    } else if (cooling === able) {
      issues.push(
        `${able === 1 ? "The verifier is" : "Every verifier is"} locked out after overturned verifications${freeIn !== null ? ` for another ${formatAge(freeIn)}` : ""}, so what the bridges bring in waits unverified.`
      );
    } else if (v.pending !== null && v.pending > 0 && waited !== null && waited > VERIFY_WAIT_MS) {
      issues.push(
        `${v.pending === 1 ? "A bridged post has" : `${n(v.pending)} bridged posts have`} waited up to ${formatAge(waited)} for verification, so the verifier has probably stopped.`
      );
    }
  }
  return report(issues.length ? "degraded" : "ok", issues, facts);
}
