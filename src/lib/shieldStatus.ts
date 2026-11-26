// How the Status page judges anonymous actions (x/shield): posting, replying
// and reacting without revealing who did it. Each part below can fail on its
// own, and from a member's side they all look the same: the action doesn't
// go through.
//
//   - The module pays the fee of every anonymous action from a reserve of
//     its own, refilled from the community pool up to a daily limit. An
//     empty reserve stops them all.
//   - The chain checks a proof with a verification key. Without one it
//     refuses every action.
//   - The browser makes that proof with prover files published for the
//     chain's version. Files that are missing, or for another version, fail
//     in the browser with nothing wrong on the chain.
//   - Encrypted batches, where the chain uses them, need a key the
//     validators generate together.
//
// This file only judges; lib/siteStatus.ts does the reading.

import type { ServiceFact, ServiceReport } from "./serviceStatus";

export interface ShieldInput {
  /** x/shield's own switch. Null when the chain has no x/shield. */
  enabled: boolean | null;
  /** The reserve, its minimum and the most one action may cost, in micro-units. Null where unread. */
  balance: bigint | null;
  minReserve: bigint | null;
  maxFeePerExec: bigint | null;
  /** What the reserve may still be refilled by today, and what the community pool holds. Null where unread. */
  fundingLeftToday: bigint | null;
  communityPool: bigint | null;
  /** Whether the chain holds its verification key. Null when unread. */
  hasVerificationKey: boolean | null;
  /** The prover files this site serves for the chain's version. Null when not checked. */
  prover: { version: string; problem: string | null } | null;
  /** Encrypted batches: off, or on with or without the validators' shared key. Null when unread. */
  batches: { enabled: boolean; hasKey: boolean; pending: number | null } | null;
  /** Display name of the fee denomination ("SPARK"). */
  symbol?: string;
}

// A reserve that pays for fewer actions than this is nearly empty.
export const LOW_RESERVE_EXECS = 50;

/** A micro-denominated amount in whole units, rounded down ("100"). */
function whole(micro: bigint): string {
  return (micro / BigInt(1_000_000)).toLocaleString("en-US");
}

export function assessShield(input: ShieldInput): ServiceReport {
  const id = "shield";
  const report = (state: ServiceReport["state"], issues: string[], facts: ServiceFact[] = []): ServiceReport => ({
    id,
    state,
    issues,
    latency_ms: null,
    facts,
  });
  if (input.enabled === null) return report("off", ["This chain has no anonymous actions."]);
  if (!input.enabled) return report("off", ["Anonymous actions are switched off on this chain."]);

  const issues: string[] = [];
  const facts: ServiceFact[] = [];
  const unit = input.symbol ? ` ${input.symbol}` : "";
  const zero = BigInt(0);

  if (input.hasVerificationKey === false) {
    issues.push("The chain holds no verification key, so it refuses every anonymous action.");
  }

  const { balance, minReserve, maxFeePerExec } = input;
  if (balance !== null) {
    facts.push({
      label: "Gas reserve",
      value: `${whole(balance)}${unit}${minReserve !== null ? `, kept at ${whole(minReserve)}` : ""}`,
    });
    const execs = maxFeePerExec !== null && maxFeePerExec > zero ? balance / maxFeePerExec : null;
    // Below its minimum the chain refills it each block, unless today's limit is used up or the pool can't cover the gap.
    const gap = minReserve !== null && balance < minReserve ? minReserve - balance : zero;
    let stuck = "";
    if (gap > zero) {
      if (input.fundingLeftToday !== null && input.fundingLeftToday <= zero) {
        stuck = "today's refill limit is used up";
      } else if (input.communityPool !== null) {
        const want = input.fundingLeftToday !== null && input.fundingLeftToday < gap ? input.fundingLeftToday : gap;
        if (input.communityPool < want) stuck = "the community pool it is refilled from can't cover it";
      }
    }
    if (balance === zero || execs === zero) {
      issues.push(`The gas reserve is empty, so anonymous actions are refused${stuck ? `, and ${stuck}` : ""}.`);
    } else if (stuck && execs !== null && execs < BigInt(LOW_RESERVE_EXECS)) {
      issues.push(`The gas reserve pays for about ${execs.toLocaleString("en-US")} more anonymous actions, and ${stuck}.`);
    } else if (stuck) {
      issues.push(`The gas reserve is below its minimum and isn't being refilled: ${stuck}.`);
    }
  }

  const prover = input.prover;
  if (prover) {
    facts.push({ label: "Prover files", value: prover.problem ? `${prover.version}, not usable` : `${prover.version}, published` });
    if (prover.problem) issues.push(`${prover.problem} Anonymous actions fail in the browser until they are published.`);
  }

  const batches = input.batches;
  if (batches?.enabled) {
    if (batches.pending !== null) facts.push({ label: "Waiting in an encrypted batch", value: batches.pending.toLocaleString("en-US") });
    if (!batches.hasKey) {
      issues.push("Encrypted batches are switched on, but the validators have no shared key yet, so nothing sent that way can be opened.");
    }
  }

  return report(issues.length ? "degraded" : "ok", issues, facts);
}
