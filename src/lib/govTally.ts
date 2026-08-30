// Vote-weight math for x/gov proposals.
//
// Mirrors the chain's own tally rules (cosmos-sdk v0.53 `x/gov/keeper.Tally`)
// so the UI shows the numbers the chain will actually act on:
//
//   - A voter's weight is the stake they have *delegated to bonded
//     validators*, not one-address-one-vote. An address with no delegations
//     carries zero weight no matter how it votes.
//   - A validator votes with its total bonded tokens minus every delegation
//     whose delegator voted for themselves ("delegator deductions"), so an
//     operator's own vote never double-counts its self-delegation.
//   - Quorum is measured against total bonded stake and counts every option
//     including abstain; the pass threshold excludes abstain.

import { fromBech32, toBech32 } from "@cosmjs/encoding";
import type { GovTallyResult, GovVote, GovParams } from "@/types/gov";
import type { DelegationResponse, Validator } from "@/types/staking";

// Legacy Dec strings ("0.334000000000000000") are fixed-point with 18 decimals.
const DEC = BigInt("1000000000000000000");

/** Parse a legacy Dec string to its 1e18-scaled integer. */
export function decToScaled(dec: string | undefined): bigint {
  if (!dec) return BigInt(0);
  const [whole, frac = ""] = dec.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * DEC + BigInt(fracPadded || "0");
}

/** Percentage of `whole` that `part` represents, as a float (0-100). */
export function pct(part: bigint, whole: bigint): number {
  if (whole <= BigInt(0)) return 0;
  return Number((part * BigInt(1_000_000)) / whole) / 10_000;
}

/**
 * The account address behind a validator operator address — same key bytes,
 * account prefix instead of `valoper`. Voters address the chain as accounts,
 * so this is how a vote is matched to the validator it also speaks for.
 */
export function validatorAccountAddress(
  operatorAddress: string,
  accPrefix: string
): string | null {
  try {
    return toBech32(accPrefix, fromBech32(operatorAddress).data);
  } catch {
    return null;
  }
}

/**
 * Per-voter voting power, keyed by voter address, in micro-denom.
 *
 * `delegationsByVoter` must cover *every* voter on the proposal, not just the
 * ones being displayed: a validator's remaining power is its bonded tokens
 * less the delegations of all self-voting delegators, so a missing voter
 * would inflate their validator's row.
 */
export function computeVotePower({
  votes,
  delegationsByVoter,
  bondedValidators,
  accPrefix,
}: {
  votes: GovVote[];
  delegationsByVoter: Map<string, DelegationResponse[]>;
  bondedValidators: Validator[];
  accPrefix: string;
}): Map<string, bigint> {
  const byOperator = new Map(bondedValidators.map((v) => [v.operator_address, v]));
  const operatorByAccount = new Map<string, string>();
  for (const v of bondedValidators) {
    const acc = validatorAccountAddress(v.operator_address, accPrefix);
    if (acc) operatorByAccount.set(acc, v.operator_address);
  }

  const power = new Map<string, bigint>();
  const deductions = new Map<string, bigint>();

  // Pass 1: each voter's own delegated stake, accumulating the amount each
  // validator loses to delegators who spoke for themselves.
  for (const vote of votes) {
    let voterPower = BigInt(0);
    for (const d of delegationsByVoter.get(vote.voter) ?? []) {
      const operator = d.delegation.validator_address;
      // Delegations to unbonded/unbonding validators carry no tally weight.
      if (!byOperator.has(operator)) continue;
      const amount = BigInt(d.balance.amount || "0");
      voterPower += amount;
      deductions.set(operator, (deductions.get(operator) ?? BigInt(0)) + amount);
    }
    power.set(vote.voter, voterPower);
  }

  // Pass 2: a voter who is also a validator operator additionally carries the
  // delegated stake that did not vote on its own. Runs after pass 1 so every
  // deduction is already counted.
  for (const vote of votes) {
    const operator = operatorByAccount.get(vote.voter);
    if (!operator) continue;
    const validator = byOperator.get(operator);
    if (!validator) continue;
    const remaining =
      BigInt(validator.tokens || "0") - (deductions.get(operator) ?? BigInt(0));
    if (remaining > BigInt(0)) {
      power.set(vote.voter, (power.get(vote.voter) ?? BigInt(0)) + remaining);
    }
  }

  return power;
}

export interface TallyOutcome {
  yes: bigint;
  no: bigint;
  abstain: bigint;
  veto: bigint;
  /** Every vote cast — the quorum denominator, abstain included. */
  cast: bigint;
  /** Yes + no + veto — the threshold denominator, abstain excluded. */
  decisive: bigint;
  bonded: bigint;
  /** Fractions as floats (0-1), straight from the chain's tally params. */
  quorumFrac: number;
  thresholdFrac: number;
  vetoFrac: number;
  quorumReached: boolean;
  /** Stake that still has to vote (any option) to reach quorum. */
  quorumShortfall: bigint;
  /** Extra yes stake needed to clear both quorum and threshold right now. */
  yesShortfall: bigint;
  overThreshold: boolean;
  vetoed: boolean;
  /** True when the proposal would pass if the vote ended at this instant. */
  passing: boolean;
}

/**
 * Evaluate a tally against the chain's tallying params. The comparisons match
 * the SDK's: quorum and veto are `>=`/`>` on the full cast total, the pass
 * threshold is a strict `>` on the abstain-free total.
 */
export function evaluateTally(
  tally: GovTallyResult,
  params: Pick<GovParams, "quorum" | "threshold" | "veto_threshold"> | null,
  bondedTokens: bigint | null
): TallyOutcome {
  const yes = BigInt(tally.yes_count || "0");
  const no = BigInt(tally.no_count || "0");
  const abstain = BigInt(tally.abstain_count || "0");
  const veto = BigInt(tally.no_with_veto_count || "0");
  const cast = yes + no + abstain + veto;
  const decisive = yes + no + veto;
  const bonded = bondedTokens ?? BigInt(0);

  const quorumDec = decToScaled(params?.quorum);
  const thresholdDec = decToScaled(params?.threshold);
  const vetoDec = decToScaled(params?.veto_threshold);

  // cast / bonded >= quorum
  const quorumTarget =
    bonded > BigInt(0) ? ceilDiv(quorumDec * bonded, DEC) : BigInt(0);
  const quorumReached = bonded > BigInt(0) && cast >= quorumTarget;
  const quorumShortfall =
    quorumTarget > cast ? quorumTarget - cast : BigInt(0);

  // yes / decisive > threshold
  const overThreshold = decisive > BigInt(0) && yes * DEC > thresholdDec * decisive;

  // veto / cast > veto_threshold
  const vetoed = cast > BigInt(0) && veto * DEC > vetoDec * cast;

  // Smallest extra yes stake y with (yes+y)/(decisive+y) > threshold. Extra yes
  // also counts toward quorum, so the binding constraint is whichever is larger.
  let thresholdShortfall = BigInt(0);
  if (!overThreshold) {
    const numerator = thresholdDec * decisive - yes * DEC;
    const denominator = DEC - thresholdDec;
    thresholdShortfall =
      denominator > BigInt(0) && numerator >= BigInt(0)
        ? numerator / denominator + BigInt(1)
        : BigInt(0);
  }
  const yesShortfall =
    thresholdShortfall > quorumShortfall ? thresholdShortfall : quorumShortfall;

  return {
    yes,
    no,
    abstain,
    veto,
    cast,
    decisive,
    bonded,
    quorumFrac: Number(quorumDec) / Number(DEC),
    thresholdFrac: Number(thresholdDec) / Number(DEC),
    vetoFrac: Number(vetoDec) / Number(DEC),
    quorumReached,
    quorumShortfall,
    yesShortfall,
    overThreshold,
    vetoed,
    passing: quorumReached && overThreshold && !vetoed,
  };
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - BigInt(1)) / b;
}
