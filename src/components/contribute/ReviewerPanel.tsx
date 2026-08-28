"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  escalatedReviews,
  getBondedRole,
  getBondedRoleConfig,
  getRepMember,
  getRepParams,
  listRepInitiatives,
  roleActivity,
  roleRewardPools,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { RepMsgTypeUrls } from "@/lib/tx";
import { formatSpark } from "@/lib/utils";
import NumberInput from "@/components/NumberInput";
import BlockTime from "@/components/BlockTime";
import ErrorState from "@/components/ErrorState";
import JuryDutyPanel from "@/components/contribute/JuryDutyPanel";
import { isMissingEndpoint } from "@/lib/errors";
import {
  BONDED_ROLE_STATUS_LABELS,
  BondedRoleStatus,
  InitiativeStatus,
  RoleType,
  TRUST_LEVEL_LABELS,
  TrustLevel,
} from "@/types/rep";
import type {
  BondedRole,
  BondedRoleConfig,
  EscalatedReview,
  Initiative,
  RepMember,
  RoleActivity,
  RoleRewardPoolStatus,
} from "@/types/rep";

const REVIEWER_ROLE = RoleType.INITIATIVE_REVIEWER;
// The pool key x/rep reports for this role in RoleRewardPools.
const REVIEWER_POOL = "initiative_reviewer";

function toMicro(amount: string): string {
  return BigInt(Math.floor(parseFloat(amount) * 1_000_000)).toString();
}

// Bonding is gated on the chain by BondRole against the role's config, and a
// failed gate only surfaces as "tier 3 required, have 0" after the wallet has
// signed and the tx has been broadcast. The two checks below reproduce that
// gate so the requirement can be stated before anyone signs.

// Reputation floors per tier, mirroring GetReputationTier in
// x/rep/keeper/moderation.go. That ladder is hardcoded on the chain rather than
// carried in params, so there is nothing to query: it has to be duplicated
// here, and it moves only when the chain moves.
const REP_TIER_FLOORS = [0, 10, 50, 200, 500, 1000];

function repTierFor(totalRep: number): number {
  let tier = 0;
  for (let i = REP_TIER_FLOORS.length - 1; i >= 0; i--) {
    if (totalRep >= REP_TIER_FLOORS[i]) {
      tier = i;
      break;
    }
  }
  return tier;
}

// Trust levels compare by proto enum order, which is the order they are
// declared in. BondRole tests `int32(actual) < required`.
const TRUST_ORDER = [
  TrustLevel.NEW,
  TrustLevel.PROVISIONAL,
  TrustLevel.ESTABLISHED,
  TrustLevel.TRUSTED,
  TrustLevel.CORE,
] as const;

function trustRank(level: string): number {
  const i = TRUST_ORDER.indexOf(level as (typeof TRUST_ORDER)[number]);
  return i < 0 ? 0 : i;
}

// Total reputation is the sum across tags, the same aggregate the tier ladder
// reads. Per-tag scores are not comparable to the tier floors on their own.
function totalReputation(member: RepMember | null): number {
  const scores = member?.reputation_scores ?? {};
  return Object.values(scores).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
}

// Sums the accuracy ring the reward distribution scores. Reported as a
// percentage against min_reviewer_accuracy, which is the bar for earning a
// share of the SPARK pool at all.
function windowedAccuracy(activity: RoleActivity | null): { pct: number; resolved: number } | null {
  const buckets = activity?.accuracy_window ?? [];
  let upheld = 0;
  let overturned = 0;
  for (const b of buckets) {
    upheld += Number(b.upheld || "0");
    overturned += Number(b.overturned || "0");
  }
  const resolved = upheld + overturned;
  if (resolved === 0) return null;
  return { pct: (upheld / resolved) * 100, resolved };
}

/**
 * The initiative-reviewer role: bond, accuracy record, reward pool, and the
 * work waiting on a verdict.
 *
 * Reviewing is a bonded role of its own (chain commit 70dce72) rather than a
 * duty of stakers or a lot-drawn jury: stakers are paid on completion, so they
 * are paid to pass the work, and conscripting a jury per submission would cost
 * more than most initiatives are worth. Reviewers are paid per verdict filed
 * and never per approval, and their bond is slashed when a jury overturns them.
 */
export default function ReviewerPanel() {
  const { address, connected, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const cannotBond = address ? isMember === false : false;

  const [bond, setBond] = useState<BondedRole | null>(null);
  const [config, setConfig] = useState<BondedRoleConfig | null>(null);
  const [activity, setActivity] = useState<RoleActivity | null>(null);
  const [pool, setPool] = useState<RoleRewardPoolStatus | null>(null);
  const [dailyCap, setDailyCap] = useState<string>("0");
  const [queue, setQueue] = useState<Initiative[]>([]);
  const [escalations, setEscalations] = useState<EscalatedReview[]>([]);
  const [minAccuracy, setMinAccuracy] = useState<number | null>(null);
  // The signer's own member record, read for the two eligibility gates the
  // chain enforces on BondRole. Absent for a non-member, which cannotBond
  // already covers.
  const [member, setMember] = useState<RepMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [unsupported, setUnsupported] = useState(false);

  const [showBondForm, setShowBondForm] = useState(false);
  const [bondAmount, setBondAmount] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [bondRes, configRes, poolsRes, queueRes, escalationsRes, paramsRes, memberRes] =
        await Promise.all([
          address ? getBondedRole(REVIEWER_ROLE, address).catch(() => null) : Promise.resolve(null),
          getBondedRoleConfig(REVIEWER_ROLE).catch(() => null),
          roleRewardPools().catch(() => null),
          // No by-status query exists for initiatives, so the queue is a page of
          // the newest ones filtered client-side. Newest-first is the right
          // order anyway: the review deadline runs from submission.
          listRepInitiatives({ limit: "100", reverse: true }).catch(() => null),
          escalatedReviews().catch(() => null),
          getRepParams().catch(() => null),
          address ? getRepMember(address).catch(() => null) : Promise.resolve(null),
        ]);

      // The role config is served for every RoleType, so its absence means the
      // node predates the reviewer role rather than that this account has none.
      if (!configRes) setUnsupported(true);

      setBond(bondRes?.bonded_role ?? null);
      setConfig(configRes?.bonded_role_config ?? null);
      setPool((poolsRes?.pools ?? []).find((p) => p.role === REVIEWER_POOL) ?? null);
      setDailyCap(poolsRes?.daily_funding_cap ?? "0");
      setQueue(
        (queueRes?.initiative ?? []).filter(
          (i) =>
            i.status === InitiativeStatus.SUBMITTED || i.status === InitiativeStatus.IN_REVIEW,
        ),
      );
      setEscalations(escalationsRes?.escalations ?? []);
      setMember(memberRes?.member ?? null);
      const accuracy = Number((paramsRes?.params as Record<string, unknown>)?.min_reviewer_accuracy);
      setMinAccuracy(Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null);

      if (address && bondRes) {
        const actRes = await roleActivity(REVIEWER_ROLE, address).catch(() => null);
        setActivity(actRes?.role_activity ?? null);
      } else {
        setActivity(null);
      }
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setUnsupported(true);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const bondTx = async (typeUrl: string, amountMicro: string, key: string) => {
    if (!address) return;
    try {
      setActionLoading(key);
      setActionError(null);
      await signAndBroadcast([
        { typeUrl, value: { creator: address, roleType: REVIEWER_ROLE, amount: amountMicro } },
      ]);
      setShowBondForm(false);
      setBondAmount("");
      await fetchData();
    } catch (err) {
      console.error("Reviewer bond action failed:", err);
      setActionError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setActionLoading(null);
    }
  };

  if (!connected) return null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="h-32 animate-pulse rounded-xl sd-hull-tile" />
      </div>
    );
  }

  if (error) return <ErrorState error={error} onRetry={fetchData} />;

  if (unsupported) {
    return (
      <div className="sd-hull-tile rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white">Review</h2>
        <p className="mt-2 text-sm text-zinc-400">
          This chain has no initiative-reviewer role yet. Completion turns on conviction
          alone here.
        </p>
      </div>
    );
  }

  const isReviewer = !!bond;
  const bondStatus = bond?.bond_status ?? "";
  const currentBond = bond?.current_bond ?? "0";
  const committed = bond?.total_committed_bond ?? "0";
  const available = bond ? (BigInt(currentBond) - BigInt(committed)).toString() : "0";
  const accuracy = windowedAccuracy(activity);
  const totalReviews = Number(activity?.total_actions?.review ?? "0");

  // Eligibility, evaluated against the live role config rather than assumed:
  // the gates differ per chain, and a chain that drops one should stop showing
  // it. Each requirement carries the signer's own standing so an unmet one says
  // how far off they are, not just that they failed.
  const requiredTier = Number(config?.min_rep_tier ?? "0");
  const requiredTrust = config?.min_trust_level ?? "";
  const myRep = totalReputation(member);
  const myTier = repTierFor(myRep);
  const tierMet = requiredTier === 0 || myTier >= requiredTier;
  const trustMet = !requiredTrust || trustRank(member?.trust_level ?? "") >= trustRank(requiredTrust);
  const requirements = [
    ...(requiredTrust
      ? [
          {
            key: "trust",
            met: trustMet,
            need: `${TRUST_LEVEL_LABELS[requiredTrust] ?? requiredTrust} trust or higher`,
            have: member
              ? `You are ${TRUST_LEVEL_LABELS[member.trust_level] ?? member.trust_level}`
              : "No member record",
          },
        ]
      : []),
    ...(requiredTier > 0
      ? [
          {
            key: "tier",
            met: tierMet,
            need: `Reputation tier ${requiredTier} (${REP_TIER_FLOORS[requiredTier]?.toLocaleString() ?? "?"} reputation)`,
            have: `You are tier ${myTier} with ${myRep.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })} reputation across all tags`,
          },
        ]
      : []),
  ];
  // Membership is checked separately and has its own copy below, so it is not
  // folded into the list: an outsider needs an invitation, not a checklist.
  const ineligible = !cannotBond && requirements.some((r) => !r.met);
  const blockBond = cannotBond || ineligible;
  // The chain requires the aggregate bond to clear min_bond on a first bond.
  const minBondMicro = BigInt(config?.min_bond ?? "0");
  const enteredMicro =
    bondAmount.trim() && Number.isFinite(parseFloat(bondAmount)) && parseFloat(bondAmount) > 0
      ? BigInt(toMicro(bondAmount))
      : BigInt(0);
  const belowMinBond = enteredMicro > BigInt(0) && enteredMicro < minBondMicro;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Review</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Bonded reviewers judge whether submitted work was actually done. Conviction says
          the community wanted it; only a verdict says it is finished.
        </p>
      </div>

      {actionError && <p className="text-xs text-red-400">{actionError}</p>}

      {/* Jury summons first: a seat is time-bound and, once accepted, costs
          reputation if it lapses, so it is the thing to answer before anything
          else on this page. Renders nothing when you have none. */}
      <JuryDutyPanel />

      {!isReviewer && (
        <div className="sd-hull-tile rounded-xl p-6">
          <p className="mb-2 text-sm text-zinc-400">
            You do not hold the reviewer role. Bond DREAM to review submitted initiative work
            against its acceptance criteria.
          </p>
          <div className="mb-4 space-y-0.5 text-xs text-zinc-500">
            {config && <p>Minimum bond: {formatSpark(config.min_bond)} DREAM</p>}
            {config?.min_age_blocks && config.min_age_blocks !== "0" && (
              <p>
                Must stay bonded {Number(config.min_age_blocks).toLocaleString()} blocks before
                your first verdict counts.
              </p>
            )}
            <p>
              Each verdict reserves bond scaled to the initiative&apos;s budget, so your free
              bond limits how much work you can take on at once.
            </p>
            <p>Pay is per verdict filed, whether you approve or reject.</p>
          </div>
          {/* What the chain will check, shown before the wallet is asked to
              sign. Rendered for every requirement, met or not: a reviewer who
              qualifies should be able to see why, and a list that only appears
              on failure reads as an error rather than as the entry rules. */}
          {!cannotBond && requirements.length > 0 && (
            <div className="mb-4 space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              {requirements.map((r) => (
                <div key={r.key} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 shrink-0 font-semibold ${
                      r.met ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {r.met ? "\u2713" : "\u2717"}
                  </span>
                  <span className="min-w-0">
                    <span className={r.met ? "text-zinc-300" : "text-amber-300"}>{r.need}</span>
                    <span className="text-zinc-500"> &middot; {r.have}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {ineligible && (
            <p className="mb-3 text-xs leading-relaxed text-zinc-500">
              Reputation comes from completing initiatives, and trust rises with reputation and
              completed interims. Take on{" "}
              <Link
                href="/contribute?view=initiatives"
                className="text-indigo-400 underline hover:text-indigo-300"
              >
                initiative work
              </Link>{" "}
              first, then come back to bond.
            </p>
          )}
          {cannotBond && (
            <p className="mb-3 text-xs text-zinc-500">
              Reviewing is open to members. Ask any existing{" "}
              <Link
                href="/contribute?view=members"
                className="text-indigo-400 underline hover:text-indigo-300"
              >
                member
              </Link>{" "}
              to invite you in.
            </p>
          )}
          {!showBondForm ? (
            <button
              type="button"
              onClick={() => setShowBondForm(true)}
              disabled={blockBond}
              title={
                cannotBond
                  ? "Only existing members can become a reviewer"
                  : ineligible
                  ? "You do not yet meet this chain's requirements for the reviewer role"
                  : undefined
              }
              className="sd-btn sd-btn-primary"
            >
              Become a reviewer
            </button>
          ) : (
            <div className="space-y-3">
              <NumberInput
                value={bondAmount}
                onChange={(e) => setBondAmount(e.target.value)}
                placeholder="Amount (DREAM)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              {belowMinBond && (
                <p className="text-xs text-amber-400">
                  A first bond has to reach the {formatSpark(config?.min_bond ?? "0")} DREAM minimum.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => bondAmount.trim() && bondTx(RepMsgTypeUrls.BondRole, toMicro(bondAmount), "bond")}
                  disabled={!bondAmount.trim() || actionLoading === "bond" || blockBond || belowMinBond}
                  className="sd-btn sd-btn-primary"
                >
                  {actionLoading === "bond" ? "Bonding..." : "Bond"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowBondForm(false)}
                  className="sd-btn sd-btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isReviewer && (
        <div className="sd-hull-tile rounded-xl p-5">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-zinc-500">Status</p>
              <p
                className={`font-medium ${
                  bondStatus === BondedRoleStatus.NORMAL
                    ? "text-emerald-400"
                    : bondStatus === BondedRoleStatus.DEMOTED
                      ? "text-red-400"
                      : "text-amber-400"
                }`}
              >
                {BONDED_ROLE_STATUS_LABELS[bondStatus] || bondStatus}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Current bond</p>
              <p className="font-medium text-zinc-200">{formatSpark(currentBond)} DREAM</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Free for new verdicts</p>
              <p className="font-medium text-zinc-200">{formatSpark(available)} DREAM</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Rewards</p>
              <p className="font-medium" style={{ color: "var(--amber)" }}>
                {formatSpark(bond?.cumulative_rewards || "0")} DREAM
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800/60 pt-3 text-xs sm:grid-cols-4">
            <div>
              <span className="text-zinc-600">Verdicts filed: </span>
              <span className="text-zinc-400">{totalReviews.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-zinc-600">Accuracy: </span>
              <span className="text-zinc-400">
                {accuracy
                  ? `${accuracy.pct.toFixed(0)}% of ${accuracy.resolved} appealed`
                  : "no appeals yet"}
              </span>
            </div>
            <div>
              <span className="text-zinc-600">Streak: </span>
              <span className="text-zinc-400">
                {Number(activity?.consecutive_overturns ?? "0") > 0
                  ? `${activity?.consecutive_overturns} overturned`
                  : `${activity?.consecutive_upheld ?? 0} upheld`}
              </span>
            </div>
            {minAccuracy !== null && (
              <div>
                <span className="text-zinc-600">Pay bar: </span>
                <span className="text-zinc-400">{Math.round(minAccuracy * 100)}% accuracy</span>
              </div>
            )}
          </div>

          {/* An overturn cooldown blocks new actions across every surface the
              role acts on, so it is worth saying plainly. */}
          {activity?.overturn_cooldown_until &&
            activity.overturn_cooldown_until !== "0" &&
            Number(activity.overturn_cooldown_until) * 1000 > Date.now() && (
            <p className="mt-3 rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-xs text-amber-300">
              A lost appeal has you on cooldown until{" "}
              {new Date(Number(activity.overturn_cooldown_until) * 1000).toLocaleString()}. New
              verdicts are refused until it lapses.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-800/60 pt-3">
            <NumberInput
              value={bondAmount}
              onChange={(e) => setBondAmount(e.target.value)}
              placeholder="Amount (DREAM)"
              className="w-40 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => bondAmount.trim() && bondTx(RepMsgTypeUrls.BondRole, toMicro(bondAmount), "bond")}
              disabled={!bondAmount.trim() || !!actionLoading}
              className="sd-btn sd-btn-secondary"
            >
              {actionLoading === "bond" ? "Bonding..." : "Add bond"}
            </button>
            <button
              type="button"
              onClick={() => bondAmount.trim() && bondTx(RepMsgTypeUrls.UnbondRole, toMicro(bondAmount), "unbond")}
              disabled={!bondAmount.trim() || !!actionLoading}
              title="Unbonded DREAM stays slashable through the cooldown"
              className="sd-btn sd-btn-secondary"
            >
              {actionLoading === "unbond" ? "Unbonding..." : "Unbond"}
            </button>
            {bond?.pending_unbond_amount && bond.pending_unbond_amount !== "0" && (
              <button
                type="button"
                onClick={() =>
                  bondTx(RepMsgTypeUrls.CancelUnbondRole, bond.pending_unbond_amount, "cancel-unbond")
                }
                disabled={!!actionLoading}
                className="sd-btn sd-btn-secondary"
              >
                {actionLoading === "cancel-unbond"
                  ? "Cancelling..."
                  : `Cancel unbond of ${formatSpark(bond.pending_unbond_amount)}`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* The SPARK pool that pays for reviewing well, on top of the per-verdict
          DREAM fee. It tops itself up from the community pool each block as a
          share of inflation, so a thin pool means thin inflation rather than a
          forgotten transfer. */}
      {pool && (
        <div className="sd-hull-tile rounded-xl p-5">
          <h3 className="text-sm font-semibold text-zinc-200">Reviewer reward pool</h3>
          <div className="mt-2 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-zinc-500">Balance</p>
              <p className="font-medium text-zinc-200">{formatSpark(pool.balance)} SPARK</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Cap</p>
              <p className="font-medium text-zinc-200">{formatSpark(pool.cap)} SPARK</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Chain allowance today</p>
              <p className="font-medium text-zinc-200">{formatSpark(dailyCap)} SPARK</p>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Shared across every bonded role by headroom, and drawn as a share of inflation
            rather than a fixed daily amount, so it shrinks when the community pool is thin
            instead of draining it.
          </p>
        </div>
      )}

      {escalations.length > 0 && (
        <div className="sd-hull-tile rounded-xl p-5">
          <h3 className="text-sm font-semibold text-zinc-200">
            With the Operations Committee
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            These rounds hit their deadline without meeting the reviewer gate. Committee
            silence rejects them at the deadline.
          </p>
          <ul className="mt-2 space-y-1.5">
            {escalations.map((e) => (
              <li key={`${e.initiative_id}-${e.round}`} className="text-sm">
                <Link
                  href={`/contribute?view=initiatives&initiative=${e.initiative_id}`}
                  className="text-indigo-400 transition-colors hover:text-indigo-300"
                >
                  #{e.initiative_id} {e.title}
                </Link>
                <span className="ml-2 text-xs text-zinc-500">
                  round {e.round + 1} · decide by block {e.review_deadline}
                  {" ("}
                  <BlockTime height={e.review_deadline} />
                  {")"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sd-hull-tile rounded-xl p-5">
        <h3 className="text-sm font-semibold text-zinc-200">Waiting on a verdict</h3>
        {queue.length === 0 ? (
          <p className="mt-1 text-xs text-zinc-500">No submitted work is in review.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {queue.map((i) => (
              <li key={i.id} className="text-sm">
                <Link
                  href={`/contribute?view=initiatives&initiative=${i.id}`}
                  className="text-indigo-400 transition-colors hover:text-indigo-300"
                >
                  #{i.id} {i.title}
                </Link>
                <span className="ml-2 text-xs text-zinc-500">
                  {formatSpark(i.budget)} DREAM
                  {i.required_verifiers ? ` · needs ${i.required_verifiers}` : ""}
                  {i.review_deadline && i.review_deadline !== "0"
                    ? ` · by block ${i.review_deadline}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          You cannot review work you commissioned, did, staked on, or invited your way into.
          Open an initiative to file a verdict on it.
        </p>
      </div>
    </div>
  );
}
