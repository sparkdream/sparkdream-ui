// How the Status page judges the validator set: the nodes that make the
// chain's blocks. The Chain section checks the public node this app reads,
// which is a sentry; this is what stands behind it.
//
// Read from the chain itself: the active set with each validator's voting
// power, who signed the last block, and each one's record of missed blocks
// (x/slashing). A block needs the signatures of more than two thirds of the
// voting power, so the share that signed the last one is how much room the
// chain has, and a validator piling up missed blocks is one about to be
// jailed and drop out of the set. This file only judges; lib/siteStatus.ts
// does the reading.
//
// How the power is spread (one validator holding a third can stop the chain
// alone) is shown, not judged: it is how the network is set up, not a fault
// that comes and goes.

import type { ServiceFact, ServiceReport } from "./serviceStatus";

/** A validator in the active set. */
export interface ActiveValidator {
  moniker: string;
  /** Voting power in the set. */
  power: number;
  /** Whether it signed the last block. Null when the last commit couldn't be read. */
  signed: boolean | null;
  /** Blocks it missed in the current slashing window. Null when unread. */
  missed: number | null;
}

export interface ValidatorInput {
  active: ActiveValidator[];
  /** Validators that are jailed, by moniker; `tombstoned` ones can never return. */
  jailed: { moniker: string; tombstoned: boolean }[];
  /** staking max_validators. 0 when unread. */
  maxValidators: number;
  /** slashing signed_blocks_window, and the most blocks a validator may miss in it before it is jailed. 0 when unread. */
  window: number;
  maxMissed: number;
}

// A block needs more than two thirds of the voting power. Below this share
// signing, the loss of one more sizeable validator stops the chain.
export const THIN_SIGNING_SHARE = 0.75;
// A validator that has used this much of the misses it is allowed is on its
// way to being jailed.
export const NEAR_JAIL_SHARE = 0.5;

const n = (v: number) => v.toLocaleString("en-US");
const pct = (share: number) => `${Math.round(share * 100)}%`;
const count = (v: number) => `${n(v)} ${v === 1 ? "validator" : "validators"}`;

export function assessValidators(input: ValidatorInput): ServiceReport {
  const id = "validators";
  const report = (state: ServiceReport["state"], issues: string[], facts: ServiceFact[] = []): ServiceReport => ({
    id,
    state,
    issues,
    latency_ms: null,
    facts,
  });
  const total = input.active.reduce((sum, v) => sum + v.power, 0);
  if (input.active.length === 0 || total <= 0) {
    return report("unreachable", ["The chain's validator set couldn't be read."]);
  }

  const issues: string[] = [];
  const facts: ServiceFact[] = [
    {
      label: "Active validators",
      value: input.maxValidators > 0 ? `${n(input.active.length)}, of at most ${n(input.maxValidators)}` : n(input.active.length),
    },
  ];

  if (input.active.every((v) => v.signed !== null)) {
    const signers = input.active.filter((v) => v.signed);
    const share = signers.reduce((sum, v) => sum + v.power, 0) / total;
    facts.push({
      label: "Signed the last block",
      value: `${n(signers.length)} of ${n(input.active.length)}, ${pct(share)} of the voting power`,
    });
    if (share < THIN_SIGNING_SHARE) {
      issues.push(
        `Only ${pct(share)} of the voting power signed the last block. A block needs more than two thirds, so the chain is close to stopping.`
      );
    }
  }

  // How the power is spread: the largest holder, and how few together hold
  // more than a third, which is enough to stop the chain.
  const byPower = [...input.active].sort((a, b) => b.power - a.power);
  facts.push({ label: "Largest validator", value: `${byPower[0].moniker || "Unnamed"}, ${pct(byPower[0].power / total)} of the voting power` });
  let held = 0;
  let enough = 0;
  for (const v of byPower) {
    held += v.power;
    enough++;
    if (held * 3 > total) break;
  }
  facts.push({ label: "Enough to stop the chain", value: `${count(enough)} (over a third of the voting power)` });

  if (input.window > 0 && input.maxMissed > 0) {
    const missing = byPower.filter((v) => v.missed !== null && v.missed >= input.maxMissed * NEAR_JAIL_SHARE);
    for (const v of missing.slice(0, 3)) {
      issues.push(
        `${v.moniker || "A validator"} has missed ${n(v.missed!)} of the last ${n(input.window)} blocks and is jailed past ${n(input.maxMissed)}.`
      );
    }
    if (missing.length > 3) issues.push(`${count(missing.length - 3)} more ${missing.length - 3 === 1 ? "is" : "are"} missing blocks at that rate.`);
  }

  if (input.jailed.length > 0) {
    const barred = input.jailed.filter((j) => j.tombstoned).length;
    facts.push({
      label: "Jailed",
      value: `${n(input.jailed.length)}${barred > 0 ? `, ${n(barred)} for good after signing twice` : ""}`,
    });
  }
  return report(issues.length ? "degraded" : "ok", issues, facts);
}
