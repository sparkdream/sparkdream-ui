// How the Status page judges chain governance (x/gov and x/upgrade). The
// Governance page lists the proposals, their tallies and their outcomes, and
// this card does not repeat it: it carries a count and a scheduled upgrade
// for context, and otherwise speaks only when something needs someone to
// act. Three things do:
//
//   - a proposal late in its voting period that hasn't reached quorum: it
//     fails unless more voting power votes;
//   - a proposal that passed its vote and then failed when the chain carried
//     it out, which leaves the decision unapplied;
//   - a chain standing at its upgrade height: it makes no blocks until the
//     validators run the new version.
//
// This file only judges; lib/siteStatus.ts does the reading.

import { formatAge, type ServiceFact, type ServiceReport } from "./serviceStatus";

export interface GovProposal {
  id: string;
  /** PROPOSAL_STATUS_*. */
  status: string;
  votingStart: number | null;
  votingEnd: number | null;
  /** Share of the bonded voting power that has voted so far, 0 to 1. Null when unread. */
  turnout: number | null;
}

export interface GovInput {
  /** Null when the chain has no x/gov. */
  voting: GovProposal[] | null;
  /** Proposals still collecting their deposit. Null when unread. */
  inDeposit: number | null;
  /**
   * Recent proposals that passed their vote and failed when carried out,
   * with the time each was decided in `votingEnd`.
   */
  failed: GovProposal[];
  /** The share of voting power that must vote for a result to count, 0 to 1. 0 when unread. */
  quorum: number;
  /** A scheduled upgrade (x/upgrade's current plan). */
  upgrade: { name: string; height: number } | null;
  /** The chain's latest block and its time, epoch ms. Null when unread. */
  latestHeight: number | null;
  latestBlockAt: number | null;
  now: number;
}

// A proposal with this little of its voting period left and no quorum yet
// is reported while there is still time to vote.
export const LATE_SHARE = 0.25;
// A failed execution stays on the card as a problem for this long.
export const FAILED_RECENT_MS = 7 * 86_400_000;
// No block for this long at the upgrade height is a chain waiting to be upgraded.
export const HALT_MS = 2 * 60_000;

const n = (v: number) => v.toLocaleString("en-US");
const pct = (share: number) => `${(Math.round(share * 1000) / 10).toLocaleString("en-US")}%`;

export function assessGov(input: GovInput): ServiceReport {
  const id = "governance";
  const report = (state: ServiceReport["state"], issues: string[], facts: ServiceFact[] = []): ServiceReport => ({
    id,
    state,
    issues,
    latency_ms: null,
    facts,
  });
  if (input.voting === null) return report("off", ["This chain has no onchain governance."]);

  const issues: string[] = [];
  const facts: ServiceFact[] = [{ label: "In voting", value: n(input.voting.length) }];

  for (const p of input.voting) {
    const left = p.votingEnd !== null ? p.votingEnd - input.now : null;
    const whole = p.votingStart !== null && p.votingEnd !== null ? p.votingEnd - p.votingStart : null;
    const late = left !== null && left > 0 && whole !== null && whole > 0 && left < whole * LATE_SHARE;
    if (late && p.turnout !== null && input.quorum > 0 && p.turnout < input.quorum) {
      issues.push(
        `Proposal #${p.id} ends in ${formatAge(left)} with ${pct(p.turnout)} of the voting power voted. It needs ${pct(input.quorum)}, or it fails.`
      );
    }
  }

  if (input.inDeposit) facts.push({ label: "Collecting a deposit", value: n(input.inDeposit) });

  // Each one within the week is said: a later proposal passing does not
  // apply what an earlier one failed to.
  for (const p of input.failed) {
    const ago = p.votingEnd !== null ? Math.max(0, input.now - p.votingEnd) : null;
    if (ago === null || ago < FAILED_RECENT_MS) {
      issues.push(`Proposal #${p.id} passed its vote but failed when the chain carried it out, so what it decided was not applied.`);
    }
  }

  const up = input.upgrade;
  if (up) {
    const togo = input.latestHeight !== null ? up.height - input.latestHeight : null;
    facts.push({
      label: "Scheduled upgrade",
      value: `${up.name} at block ${n(up.height)}${togo !== null && togo > 0 ? `, in ${n(togo)} ${togo === 1 ? "block" : "blocks"}` : ""}`,
    });
    // The chain stops before making the upgrade block: its last block is the one before.
    const stale = input.latestBlockAt !== null && input.now - input.latestBlockAt > HALT_MS;
    if (togo !== null && togo <= 1 && stale) {
      issues.push(
        `The chain has stopped at block ${n(up.height)} for the upgrade "${up.name}". It makes no blocks until the validators run the new version.`
      );
    }
  }

  return report(issues.length ? "degraded" : "ok", issues, facts);
}
