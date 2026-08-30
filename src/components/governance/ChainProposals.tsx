"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  GovParams,
  GovProposal,
  GovTallyResult,
  GovVote,
} from "@/types/gov";
import type { DelegationResponse, Validator } from "@/types/staking";
import {
  GovProposalStatus,
  GovVoteOptionNum,
  GOV_VOTE_OPTION_LABELS,
} from "@/types/gov";
import {
  listGovProposals,
  getGovProposalVotes,
  getGovProposalTally,
  getGovDepositParams,
  getGovParams,
  getStakingPool,
  listStakingValidators,
  listDelegationsByDelegator,
} from "@/lib/api";
import { computeVotePower, evaluateTally, pct } from "@/lib/govTally";
import { GovMsgTypeUrls } from "@/lib/tx";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  truncateAddress,
  timeRemaining,
  describeProposalMessages,
} from "@/lib/utils";
import CopyableAddress from "@/components/CopyableAddress";
import { useDisplayName } from "@/hooks/useDisplayName";
import NewChainProposal from "./NewChainProposal";
import ParamChangeDiff from "./ParamChangeDiff";
import NumberInput from "@/components/NumberInput";
import ErrorState from "@/components/ErrorState";

export default function ChainProposals() {
  const { address, connected, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const [proposals, setProposals] = useState<GovProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showNewProposal, setShowNewProposal] = useState(false);
  // Chain's gov `min_deposit` for the bond denom, in micro-units. Used per
  // DEPOSIT_PERIOD card to prefill the top-up input with the exact missing
  // amount and surface a "Needs X more to start voting" hint. `null` while
  // loading or if the LCD lookup fails — in either case the cards fall back
  // to the prior "type any amount" behavior.
  const [minDepositMicro, setMinDepositMicro] = useState<bigint | null>(null);
  // Chain-wide inputs to the tally math, fetched once and shared by every
  // card: the tallying params (quorum / threshold / veto_threshold) and the
  // bonded set they are measured against. `null` means the lookup is still in
  // flight or failed, and the cards degrade to a bar with no markers rather
  // than showing a quorum we can't back up.
  const [tallyParams, setTallyParams] = useState<GovParams | null>(null);
  const [bondedTokens, setBondedTokens] = useState<bigint | null>(null);
  const [bondedValidators, setBondedValidators] = useState<Validator[] | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getGovParams().catch(() => null),
      getStakingPool().catch(() => null),
      listStakingValidators("BOND_STATUS_BONDED", { limit: "300" }).catch(
        () => null
      ),
    ]).then(([paramsRes, poolRes, validatorsRes]) => {
      if (cancelled) return;
      if (paramsRes?.params) setTallyParams(paramsRes.params);
      if (poolRes?.pool) setBondedTokens(BigInt(poolRes.pool.bonded_tokens));
      if (validatorsRes) setBondedValidators(validatorsRes.validators || []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getGovDepositParams()
      .then((res) => {
        if (cancelled) return;
        const min = res.params?.min_deposit ?? [];
        const match = min.find((c) => c.denom === config.denom) ?? min[0];
        if (match) setMinDepositMicro(BigInt(match.amount));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config.denom]);

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listGovProposals(undefined, {
        reverse: true,
        limit: "50",
      });
      setProposals(res.proposals || []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load proposals"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const handleVote = async (proposalId: string, option: number) => {
    setActionLoading(`vote-${proposalId}`);
    try {
      await signAndBroadcast([
        {
          typeUrl: GovMsgTypeUrls.Vote,
          value: {
            proposalId: BigInt(proposalId),
            voter: address,
            option,
          },
        },
      ]);
      await fetchProposals();
    } catch (err) {
      console.error("Vote failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeposit = async (proposalId: string, amount: string) => {
    setActionLoading(`deposit-${proposalId}`);
    try {
      await signAndBroadcast([
        {
          typeUrl: GovMsgTypeUrls.Deposit,
          value: {
            proposalId: BigInt(proposalId),
            depositor: address,
            amount: [{ denom: config.denom, amount }],
          },
        },
      ]);
      await fetchProposals();
    } catch (err) {
      console.error("Deposit failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Chain proposals</h2>
        {!showNewProposal && (
          <button
            type="button"
            onClick={() => setShowNewProposal(true)}
            disabled={!connected}
            title={connected ? "MsgSubmitProposal" : "Connect a wallet to submit a chain proposal"}
            className="sd-btn sd-btn-primary"
          >
            New proposal
          </button>
        )}
      </div>

      {showNewProposal && (
        <div className="mb-6">
          <NewChainProposal
            onClose={() => setShowNewProposal(false)}
            onSuccess={() => {
              setShowNewProposal(false);
              fetchProposals();
            }}
          />
        </div>
      )}

      {error ? (
        <ErrorState error={error} onRetry={fetchProposals} className="mb-6" />
      ) : null}

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl sd-hull-tile p-5"
            >
              <div className="mb-2 h-5 w-2/3 rounded bg-zinc-800" />
              <div className="mb-2 h-4 w-1/2 rounded bg-zinc-800/60" />
              <div className="flex gap-4">
                <div className="h-3 w-24 rounded bg-zinc-800" />
                <div className="h-3 w-20 rounded bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No chain proposals yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <GovProposalCard
              key={proposal.id}
              proposal={proposal}
              connected={connected}
              actionLoading={actionLoading}
              displayDenom={config.displayDenom}
              denom={config.denom}
              minDepositMicro={minDepositMicro}
              tallyParams={tallyParams}
              bondedTokens={bondedTokens}
              bondedValidators={bondedValidators}
              accPrefix={config.bech32Prefix}
              onVote={handleVote}
              onDeposit={handleDeposit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Status badge ────────────────────────────────────────────────────

function govStatusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    [GovProposalStatus.DEPOSIT_PERIOD]: {
      bg: "bg-yellow-900/30",
      text: "text-yellow-400",
      label: "Deposit",
    },
    [GovProposalStatus.VOTING_PERIOD]: {
      bg: "bg-blue-900/30",
      text: "text-blue-400",
      label: "Voting",
    },
    [GovProposalStatus.PASSED]: {
      bg: "bg-emerald-900/30",
      text: "text-emerald-400",
      label: "Passed",
    },
    [GovProposalStatus.REJECTED]: {
      bg: "bg-red-900/30",
      text: "text-red-400",
      label: "Rejected",
    },
    [GovProposalStatus.FAILED]: {
      bg: "bg-red-900/30",
      text: "text-red-400",
      label: "Failed",
    },
  };
  const s = map[status] || {
    bg: "bg-zinc-800",
    text: "text-zinc-500",
    label: status.replace("PROPOSAL_STATUS_", ""),
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatCoins(
  coins: { denom: string; amount: string }[],
  displayDenom: string
): string {
  if (!coins?.length) return "0";
  return coins
    .map((c) => {
      const amt = parseInt(c.amount, 10);
      if (c.denom.startsWith("u")) {
        return `${(amt / 1_000_000).toLocaleString()} ${displayDenom}`;
      }
      return `${amt.toLocaleString()} ${c.denom}`;
    })
    .join(", ");
}

function formatISOTime(iso: string): string {
  if (!iso || iso === "0001-01-01T00:00:00Z") return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type GovMsg = { "@type": string; [key: string]: unknown };

/** Decode chain proposal inner messages into human-readable lines, keeping
 * each line paired with the message it came from so richer per-message views
 * (the params diff) can render alongside it. */
function decodeGovMessages(
  msgs: GovMsg[],
  displayDenom: string
): { line: string; msg: GovMsg }[] {
  if (!msgs?.length) return [];
  return msgs
    .map((msg) => ({ line: describeGovMessage(msg, displayDenom), msg }))
    .filter((entry) => entry.line);
}

function describeGovMessage(m: GovMsg, displayDenom: string): string {
  const t = m["@type"] || "";

  if (t.includes("MsgSoftwareUpgrade")) {
    const plan = m.plan as Record<string, unknown> | undefined;
    if (plan) return `Upgrade "${plan.name}" at height ${plan.height}`;
    return "Software upgrade";
  }

  if (t.includes("MsgCancelUpgrade")) {
    return "Cancel pending software upgrade";
  }

  if (t.includes("MsgRenewGroup")) {
    const name = m.group_name as string;
    const members = m.new_members as string[];
    return `Renew council "${name}" with ${members?.length || "?"} members`;
  }

  if (t.includes("MsgRegisterGroup")) {
    const name = m.name as string;
    const members = m.members as string[];
    return `Register council "${name}" with ${members?.length || "?"} members`;
  }

  if (t.includes("MsgUpdateParams")) {
    // Extract module name from type URL
    const parts = t.split(".");
    const mod = parts.length >= 3 ? parts[parts.length - 3] : "unknown";
    return `Update ${mod} module parameters`;
  }

  if (t.includes("MsgCommunityPoolSpend") || t.includes("MsgSpendFromCommons")) {
    const recipient = m.recipient as string;
    const amount = m.amount as { denom: string; amount: string }[];
    return `Send ${formatCoins(amount || [], displayDenom)} to ${recipient ? truncateAddress(recipient) : "?"}`;
  }

  if (t.includes("MsgUpdateGroupMembers")) {
    const add = m.members_to_add as string[];
    const remove = m.members_to_remove as string[];
    const parts: string[] = [];
    if (add?.length) parts.push(`add ${add.length} member${add.length > 1 ? "s" : ""}`);
    if (remove?.length) parts.push(`remove ${remove.length} member${remove.length > 1 ? "s" : ""}`);
    return parts.join(", ") || "Update group members";
  }

  return "";
}

// ── Tally progress bar ──────────────────────────────────────────────

/**
 * One bar carrying both tests the chain applies, because both are edges on the
 * same axis once the bar is scaled to total bonded stake:
 *
 *   - Quorum is the filled region (every option, abstain included) reaching
 *     the quorum tick.
 *   - The pass threshold is the yes segment's right edge reaching the
 *     threshold tick. Threshold is a share of the abstain-free total, so its
 *     tick sits at threshold x decisive / bonded, which is exactly where yes
 *     has to reach in bonded coordinates. It slides right as abstain grows.
 *
 * Yes is drawn first for that reason: its right edge has to start from zero
 * for the comparison to hold.
 *
 * A concluded proposal keeps both marks, but its quorum reading is against
 * stake bonded *now* rather than the set the chain measured at voting end,
 * which the legend line says outright. Where that present-day set is smaller
 * than the votes cast the reading would be nonsense, so the bar falls back to
 * scaling by votes cast and drops the quorum tick.
 */
function GovTallyBar({
  tally,
  tallyParams,
  bondedTokens,
  displayDenom,
  denom,
  isVoting,
}: {
  tally: GovTallyResult;
  tallyParams: GovParams | null;
  bondedTokens: bigint | null;
  displayDenom: string;
  denom: string;
  isVoting: boolean;
}) {
  const o = evaluateTally(tally, tallyParams, bondedTokens);

  const fmt = (amt: bigint) =>
    denom.startsWith("u")
      ? `${(Number(amt) / 1_000_000).toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })} ${displayDenom}`
      : `${Number(amt).toLocaleString()}`;

  // Scale to bonded stake, which is what quorum is a share of. Falling below
  // the votes already cast means the bonded set has shrunk since the vote, so
  // there is nothing coherent left to measure quorum against.
  const againstBonded = o.bonded >= o.cast && o.bonded > BigInt(0);
  const scale = againstBonded ? o.bonded : o.cast;

  if (o.cast === BigInt(0)) {
    return (
      <div className="mb-1">
        <div className="h-2.5 w-full rounded-full bg-zinc-800" />
        <div className="mt-1 text-center text-[10px] text-zinc-600">
          {isVoting && againstBonded
            ? `No votes yet. ${fmt(o.quorumShortfall)} needs to vote for quorum.`
            : "No votes yet"}
        </div>
      </div>
    );
  }

  const pYes = pct(o.yes, scale);
  const pNo = pct(o.no, scale);
  const pVeto = pct(o.veto, scale);
  const pAbstain = pct(o.abstain, scale);
  const turnout = pct(o.cast, scale);
  const thresholdPos = Math.min(
    (o.thresholdFrac * Number(o.decisive) * 100) / Number(scale),
    100
  );
  const quorumPos = o.quorumFrac * 100;

  // Share of votes cast, which is what the option legend below reports —
  // distinct from the bar's own scale whenever turnout is short of bonded.
  const ofCast = (amt: bigint) => pct(amt, o.cast).toFixed(0);

  return (
    <div className="mb-1">
      <div className="relative mt-2">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
          {pYes > 0 && <div className="bg-green-500 transition-all" style={{ width: `${pYes}%` }} />}
          {pNo > 0 && <div className="bg-red-500 transition-all" style={{ width: `${pNo}%` }} />}
          {pVeto > 0 && <div className="bg-orange-500 transition-all" style={{ width: `${pVeto}%` }} />}
          {pAbstain > 0 && <div className="bg-zinc-600 transition-all" style={{ width: `${pAbstain}%` }} />}
        </div>

        {/* Pass threshold: the mark the yes segment has to clear. */}
        {o.decisive > BigInt(0) && (
          <div
            className="sd-tick-threshold sd-tick-cap pointer-events-none absolute inset-y-0 w-[3px]"
            style={{ left: `${thresholdPos}%`, marginLeft: "-1.5px" }}
            title={`Pass threshold: yes must exceed ${(o.thresholdFrac * 100).toFixed(1)}% of yes, no and veto`}
          />
        )}

        {/* Quorum: the mark the whole filled region has to clear. */}
        {againstBonded && (
          <div
            className="sd-tick-quorum sd-tick-cap pointer-events-none absolute inset-y-0 w-[3px]"
            style={{ left: `${quorumPos}%`, marginLeft: "-1.5px" }}
            title={`Quorum: ${quorumPos.toFixed(1)}% of bonded stake must vote`}
          />
        )}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-green-400">Yes {ofCast(o.yes)}%<span className="ml-0.5 text-zinc-600">({fmt(o.yes)})</span></span>
        <span className="text-red-400">No {ofCast(o.no)}%<span className="ml-0.5 text-zinc-600">({fmt(o.no)})</span></span>
        {o.veto > BigInt(0) && <span className="text-orange-400">Veto {ofCast(o.veto)}%<span className="ml-0.5 text-zinc-600">({fmt(o.veto)})</span></span>}
        {o.abstain > BigInt(0) && <span className="text-zinc-500">Abstain {ofCast(o.abstain)}%<span className="ml-0.5 text-zinc-600">({fmt(o.abstain)})</span></span>}
        <span className="text-zinc-600">of votes cast</span>
      </div>

      {/* What each tick means. While the vote is live these say what it would
          take to pass; once it has concluded they only say where the vote
          landed, because the status badge already carries the outcome the
          chain reached. */}
      <div className="mt-1.5 space-y-0.5 text-[10px]">
        {againstBonded && (
          <div
            className={
              !isVoting
                ? "text-zinc-500"
                : o.quorumReached
                  ? "text-zinc-400"
                  : "text-yellow-400"
            }
            title={
              isVoting
                ? undefined
                : "Measured against stake bonded now. The chain measured it against the set bonded when voting ended, which it does not keep."
            }
          >
            <span className="sd-tick-quorum mr-1.5 inline-block h-3.5 w-[3px] rounded-full align-middle" />
            {isVoting ? (
              <>
                Quorum {quorumPos.toFixed(1)}% of {fmt(o.bonded)} bonded.
                {o.quorumReached
                  ? ` Reached, turnout is ${turnout.toFixed(0)}%.`
                  : ` ${fmt(o.quorumShortfall)} more must vote.`}
              </>
            ) : (
              <>
                Quorum {quorumPos.toFixed(1)}%. Turnout was{" "}
                {turnout.toFixed(0)}% of the stake bonded today.
              </>
            )}
          </div>
        )}
        <div
          className={
            !isVoting
              ? "text-zinc-500"
              : o.vetoed
                ? "text-orange-400"
                : o.passing
                  ? "text-green-400"
                  : "text-zinc-400"
          }
        >
          <span className="sd-tick-threshold mr-1.5 inline-block h-3.5 w-[3px] rounded-full align-middle" />
          {!isVoting ? (
            <>
              Threshold {(o.thresholdFrac * 100).toFixed(0)}% of yes, no and
              veto. Yes was {pct(o.yes, o.decisive).toFixed(0)}%.
            </>
          ) : o.vetoed ? (
            <>
              Veto is above {(o.vetoFrac * 100).toFixed(1)}% of votes cast, so
              this is rejected as it stands.
            </>
          ) : o.passing ? (
            <>
              Passing as it stands. Yes is {pct(o.yes, o.decisive).toFixed(0)}%
              of yes, no and veto, above the{" "}
              {(o.thresholdFrac * 100).toFixed(0)}% threshold.
            </>
          ) : (
            <>
              Threshold {(o.thresholdFrac * 100).toFixed(0)}% of yes, no and
              veto, currently {pct(o.yes, o.decisive).toFixed(0)}%. Needs{" "}
              <span className="text-green-400">{fmt(o.yesShortfall)}</span>{" "}
              more yes to pass.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One voter line in a proposal's vote list. Shows the voter's registered name
 * when they have one (the address is still the tooltip and the copied value),
 * falling back to the truncated bech32.
 *
 * The chain tallies stake, not voters, so the row also carries the stake this
 * voter actually swings. `power` is null when the delegation lookup did not
 * run or failed, in which case the row stays name-and-option only rather than
 * implying every voter counts equally.
 */
function GovVoteRow({
  vote,
  power,
  bondedTokens,
  displayDenom,
  denom,
}: {
  vote: GovVote;
  power: bigint | null;
  bondedTokens: bigint | null;
  displayDenom: string;
  denom: string;
}) {
  const { name } = useDisplayName(vote.voter);
  const share =
    power !== null && bondedTokens && bondedTokens > BigInt(0)
      ? pct(power, bondedTokens)
      : null;
  const powerLabel =
    power === null
      ? null
      : power === BigInt(0)
        ? "no voting power"
        : denom.startsWith("u")
          ? `${(Number(power) / 1_000_000).toLocaleString()} ${displayDenom}`
          : Number(power).toLocaleString();

  return (
    <div className="flex items-center gap-2 text-xs">
      <CopyableAddress
        className={name ? "text-zinc-300" : "font-mono text-zinc-400"}
        address={vote.voter}
        resolveName
      />
      <span className="text-zinc-500">
        {vote.options
          ?.map(
            (o) =>
              GOV_VOTE_OPTION_LABELS[o.option] ||
              o.option.replace("VOTE_OPTION_", "")
          )
          .join(", ") || "?"}
      </span>
      {powerLabel && (
        <span
          className={`ml-auto text-[10px] ${power === BigInt(0) ? "text-zinc-600" : "text-zinc-500"}`}
          title="Stake delegated to bonded validators, which is what the chain tallies"
        >
          {powerLabel}
          {share !== null && power !== null && power > BigInt(0) && (
            <span className="ml-1 text-zinc-600">{share.toFixed(1)}%</span>
          )}
        </span>
      )}
    </div>
  );
}

// ── Proposal card ───────────────────────────────────────────────────

// Voters above which the per-voter power lookup is skipped: it costs one
// delegation query per voter and has to cover all of them to stay correct.
const MAX_POWER_VOTERS = 100;

function GovProposalCard({
  proposal,
  connected,
  actionLoading,
  displayDenom,
  denom,
  minDepositMicro,
  tallyParams,
  bondedTokens,
  bondedValidators,
  accPrefix,
  onVote,
  onDeposit,
}: {
  proposal: GovProposal;
  connected: boolean;
  actionLoading: string | null;
  displayDenom: string;
  denom: string;
  minDepositMicro: bigint | null;
  tallyParams: GovParams | null;
  bondedTokens: bigint | null;
  bondedValidators: Validator[] | null;
  accPrefix: string;
  onVote: (id: string, option: number) => void;
  onDeposit: (id: string, amount: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tally, setTally] = useState<GovTallyResult | null>(null);
  const [votes, setVotes] = useState<GovVote[] | null>(null);
  // Per-voter stake weight, keyed by voter address. `null` until the
  // delegation lookups land (or if they fail, or if there are more voters
  // than MAX_POWER_VOTERS), in which case the rows omit power entirely.
  const [powerByVoter, setPowerByVoter] = useState<Map<string, bigint> | null>(
    null
  );

  // Compute the missing deposit (in micro-units) needed to push this proposal
  // out of DEPOSIT_PERIOD into VOTING_PERIOD. The chain transitions as soon
  // as total_deposit >= min_deposit, so in DEPOSIT_PERIOD the difference is
  // always positive — but defensively clamp to zero. Returns null when we
  // don't have the chain's min_deposit yet (the LCD query is still in
  // flight or failed), in which case the card falls back to the prior
  // "type any amount" UX.
  const missingMicro: bigint | null = (() => {
    if (minDepositMicro === null) return null;
    const current = (proposal.total_deposit ?? []).find(
      (c) => c.denom === denom
    );
    const currentMicro = current ? BigInt(current.amount) : BigInt(0);
    const diff = minDepositMicro - currentMicro;
    return diff > BigInt(0) ? diff : BigInt(0);
  })();

  // Display form of the missing amount in the bond denom (e.g. "4.75").
  // Reused for both the prefill seed and the hint label, so we format
  // once. Trailing zeros stripped to keep the prefill tidy.
  const missingDisplay: string | null = (() => {
    if (missingMicro === null || missingMicro === BigInt(0)) return null;
    const MICRO = BigInt(1_000_000);
    const whole = missingMicro / MICRO;
    const frac = missingMicro % MICRO;
    if (frac === BigInt(0)) return whole.toString();
    return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
  })();

  // Prefill the deposit input with the missing amount the first time we
  // know it. useState's lazy init runs only once per component instance and
  // the card uses `key={proposal.id}` in the list, so the user's typed
  // override survives proposal-list refreshes — but the initializer here
  // fires before `missingDisplay` is computed on first render (the LCD
  // query hasn't returned yet), so seed via a follow-up effect that only
  // touches an untouched field. Same pattern as NewChainProposal's prefill.
  const [depositAmount, setDepositAmount] = useState("");
  useEffect(() => {
    if (!missingDisplay) return;
    setDepositAmount((cur) => (cur === "" ? missingDisplay : cur));
  }, [missingDisplay]);

  const loadDetail = async () => {
    if (tally) {
      setExpanded(!expanded);
      return;
    }
    try {
      const [tallyRes, votesRes] = await Promise.all([
        getGovProposalTally(proposal.id),
        getGovProposalVotes(proposal.id),
      ]);
      const voteList = votesRes.votes || [];
      setTally(tallyRes.tally);
      setVotes(voteList);
      setExpanded(true);
      loadVotePower(voteList);
    } catch {
      setExpanded(!expanded);
    }
  };

  /**
   * Resolve each voter's stake weight. One delegation query per voter, so it
   * runs after the card is already expanded and populates the rows when it
   * lands. Every voter has to be covered, not just the displayed ones: a
   * validator's own weight is its bonded tokens less the delegations of all
   * self-voting delegators, so a voter left out would inflate their
   * validator's row. Past MAX_POWER_VOTERS we skip the whole thing rather
   * than show numbers we know are wrong.
   */
  const loadVotePower = async (voteList: GovVote[]) => {
    if (!bondedValidators || voteList.length === 0) return;
    if (voteList.length > MAX_POWER_VOTERS) return;
    try {
      const delegations = await Promise.all(
        voteList.map((v) =>
          listDelegationsByDelegator(v.voter, { limit: "200" })
            .then((res) => res.delegation_responses || [])
            .catch(() => [] as DelegationResponse[])
        )
      );
      const byVoter = new Map<string, DelegationResponse[]>();
      voteList.forEach((v, i) => byVoter.set(v.voter, delegations[i]));
      setPowerByVoter(
        computeVotePower({
          votes: voteList,
          delegationsByVoter: byVoter,
          bondedValidators,
          accPrefix,
        })
      );
    } catch {
      // Leave the rows without power rather than guessing.
    }
  };

  const isDeposit = proposal.status === GovProposalStatus.DEPOSIT_PERIOD;
  const isVoting = proposal.status === GovProposalStatus.VOTING_PERIOD;

  const typeLabel = describeProposalMessages(proposal.messages);
  const decodedMsgs = decodeGovMessages(proposal.messages, displayDenom);

  // Time remaining
  let remaining: string | null = null;
  if (isVoting && proposal.voting_end_time) {
    remaining = timeRemaining(proposal.voting_end_time);
  } else if (isDeposit && proposal.deposit_end_time) {
    remaining = timeRemaining(proposal.deposit_end_time);
  }

  return (
    <article className="rounded-xl sd-hull-tile p-5">
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">#{proposal.id}</span>
          {govStatusBadge(proposal.status)}
          {typeLabel !== "General Vote" && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              {typeLabel}
            </span>
          )}
          {remaining && (
            <span className={`text-xs font-medium ${remaining === "expired" ? "text-red-400" : "text-blue-400"}`}>
              {remaining}
            </span>
          )}
        </div>
        <button
          onClick={loadDetail}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? "Hide" : "Details"}
        </button>
      </div>

      {/* Title + summary */}
      {proposal.title && (
        <h3 className="mb-1 text-sm font-medium text-white">
          {proposal.title}
        </h3>
      )}
      {proposal.summary && (
        <p className="mb-2 line-clamp-2 text-sm text-zinc-400">
          {proposal.summary}
        </p>
      )}

      {/* Decoded message details. A params message gets its before/after diff
          rendered under its description — the message itself carries the whole
          params object, so "Update rep module parameters" alone never says
          which parameter the proposal actually moves. */}
      {decodedMsgs.length > 0 && (
        <div className="mb-2 space-y-1">
          {decodedMsgs.map(({ line, msg }, i) => (
            <div key={i}>
              <div className="flex items-start gap-1.5 text-xs text-zinc-400">
                <span className="mt-0.5 text-indigo-400/60">&#9656;</span>
                {line}
              </div>
              <ParamChangeDiff
                msg={msg}
                applied={proposal.status === GovProposalStatus.PASSED}
              />
            </div>
          ))}
        </div>
      )}

      {/* Info row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>by <CopyableAddress address={proposal.proposer} /></span>
        <span>{formatISOTime(proposal.submit_time)}</span>
        {isDeposit && (
          <span>
            Deposit: {formatCoins(proposal.total_deposit, displayDenom)}
          </span>
        )}
        {isDeposit && missingDisplay && (
          <span className="text-yellow-400">
            Needs {missingDisplay} {displayDenom} more to start voting
          </span>
        )}
        {isVoting && proposal.voting_end_time && (
          <span>Ends: {formatISOTime(proposal.voting_end_time)}</span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          {/* Progress bar tally */}
          {tally && (
            <GovTallyBar
              tally={tally}
              tallyParams={tallyParams}
              bondedTokens={bondedTokens}
              displayDenom={displayDenom}
              denom={denom}
              isVoting={isVoting}
            />
          )}

          {/* Individual votes */}
          {votes && votes.length > 0 && (
            <div className="mt-3 space-y-1">
              {votes.slice(0, 20).map((v) => (
                <GovVoteRow
                  key={v.voter}
                  vote={v}
                  power={powerByVoter?.get(v.voter) ?? null}
                  bondedTokens={bondedTokens}
                  displayDenom={displayDenom}
                  denom={denom}
                />
              ))}
              {votes.length > 20 && (
                <div className="text-xs text-zinc-600">
                  ... and {votes.length - 20} more
                </div>
              )}
            </div>
          )}

          {/* Full summary when long */}
          {proposal.summary && proposal.summary.length > 200 && (
            <div className="mt-3 rounded bg-zinc-800/50 p-3 text-xs text-zinc-400">
              {proposal.summary}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {connected && (isVoting || isDeposit) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
          {isVoting && (
            <>
              {[
                { opt: GovVoteOptionNum.YES, label: "Yes", style: "border-green-700/50 text-green-400 hover:border-green-500 hover:bg-green-900/20" },
                { opt: GovVoteOptionNum.NO, label: "No", style: "border-red-700/50 text-red-400 hover:border-red-500 hover:bg-red-900/20" },
                { opt: GovVoteOptionNum.ABSTAIN, label: "Abstain", style: "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300" },
                { opt: GovVoteOptionNum.NO_WITH_VETO, label: "No with veto", style: "border-orange-700/50 text-orange-400 hover:border-orange-500 hover:bg-orange-900/20" },
              ].map(({ opt, label, style }) => (
                <button
                  key={opt}
                  onClick={() => onVote(proposal.id, opt)}
                  disabled={actionLoading === `vote-${proposal.id}`}
                  className={`rounded-lg border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${style}`}
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {isDeposit && (
            <div className="flex items-center gap-2">
              <NumberInput
                placeholder={`Amount (${displayDenom})`}
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                wrapperClassName="w-36"
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={() => {
                  if (!depositAmount) return;
                  const microAmount = (
                    parseFloat(depositAmount) * 1_000_000
                  ).toFixed(0);
                  onDeposit(proposal.id, microAmount);
                  setDepositAmount("");
                }}
                disabled={
                  actionLoading === `deposit-${proposal.id}` || !depositAmount
                }
                className="rounded-lg border border-yellow-500/30 bg-yellow-600/20 px-3 py-1 text-xs text-yellow-400 transition-colors hover:bg-yellow-600/30 disabled:opacity-50"
              >
                {actionLoading === `deposit-${proposal.id}`
                  ? "Depositing..."
                  : "Deposit"}
              </button>
              {/* Re-snap to the missing amount if the user has wandered off
                  of it (e.g. typed a different number and now wants the
                  exact-to-voting value back). Hidden when the typed value
                  already matches the missing amount so the chrome stays
                  quiet in the common case. */}
              {missingDisplay && depositAmount !== missingDisplay && (
                <button
                  type="button"
                  onClick={() => setDepositAmount(missingDisplay)}
                  className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                  title="Set to the exact amount needed to start voting"
                >
                  set to {missingDisplay}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
