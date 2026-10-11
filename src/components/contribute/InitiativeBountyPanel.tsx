"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { getLatestBlockHeight, getRepMember, getRepParams, initiativeBounty } from "@/lib/api";
import { RepMsgTypeUrls } from "@/lib/tx";
import { formatDecPercent, formatSpark, parseDreamToUdream } from "@/lib/utils";
import { describeTxError, isMissingEndpoint } from "@/lib/errors";
import { useDreamDenom } from "@/hooks/useDreamDenom";
import BlockEta from "@/components/BlockEta";
import type { Initiative, InitiativeBountyResponse } from "@/types/rep";
import { InitiativeStatus } from "@/types/rep";

interface Props {
  initiative: Initiative;
  /** The parent project's creator, who is barred from funding the bounty. */
  projectCreator?: string;
  /** Re-reads the initiative list after a bounty change. */
  onChanged: () => void;
}

/** The rep params this panel reads, already parsed. */
interface BountyParams {
  /** initiative_bounty_max_budget_ratio scaled by 1e18 (LegacyDec). */
  ratioAtto: bigint;
  ratioText: string;
  perFunderEpoch: bigint;
  minContribution: bigint;
  maxContributions: number;
  reclaimDelay: string;
  epochBlocks: bigint;
  transferTaxRate: string;
}

const ZERO = BigInt(0);
const ATTO = BigInt("1000000000000000000");

function toBig(v: unknown): bigint {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  return ZERO;
}

/** LegacyDec string ("1.000000000000000000") to an integer scaled by 1e18. */
function decToAtto(v: unknown): bigint {
  if (typeof v !== "string" || !/^\d+(\.\d+)?$/.test(v)) return ZERO;
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole) * ATTO + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

function parseParams(p: Record<string, unknown>): BountyParams {
  return {
    ratioAtto: decToAtto(p.initiative_bounty_max_budget_ratio),
    ratioText: String(p.initiative_bounty_max_budget_ratio ?? ""),
    perFunderEpoch: toBig(p.max_initiative_bounty_per_funder_epoch),
    minContribution: toBig(p.min_initiative_bounty_contribution),
    maxContributions: Number(p.max_initiative_bounty_contributions ?? 0),
    reclaimDelay: String(p.initiative_bounty_reclaim_delay ?? ""),
    epochBlocks: toBig(p.epoch_blocks),
    transferTaxRate: String(p.transfer_tax_rate ?? ""),
  };
}

function errorMessage(err: unknown, fallback: string): string {
  const raw = describeTxError(err);
  return raw.trim() ? raw : fallback;
}

const FUNDABLE = new Set<string>([InitiativeStatus.OPEN, InitiativeStatus.ASSIGNED]);

/**
 * The initiative bounty: DREAM members escrow against an initiative they want
 * done, paid to the assignee only if it completes (chain commit b9da52e).
 *
 * Distinct from the review bounty in InitiativeReviewPanel, which pays
 * reviewers per verdict and never depends on the outcome. This one is
 * contingent on completion, so the chain hedges it: total capped at a ratio of
 * the budget, each funder capped per epoch, closed to anyone affiliated with
 * the work, taxed on release and clipped to the assignee's transfer receive
 * limits. Closing, rejection and project cancellation refund every funder.
 *
 * Renders nothing on a node without the query (older than the commit), and
 * nothing on an initiative that holds no bounty and can no longer take one.
 */
export default function InitiativeBountyPanel({ initiative, projectCreator, onChanged }: Props) {
  const dream = useDreamDenom();
  const { address, signAndBroadcast } = useWallet();

  const [bounty, setBounty] = useState<InitiativeBountyResponse | null>(null);
  const [params, setParams] = useState<BountyParams | null>(null);
  const [fundedThisEpoch, setFundedThisEpoch] = useState<bigint | null>(null);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const id = initiative.id;

  const load = useCallback(async () => {
    setLoading(true);
    const [bountyRes, paramsRes, heightRes, memberRes] = await Promise.allSettled([
      initiativeBounty(id),
      getRepParams(),
      getLatestBlockHeight(),
      address ? getRepMember(address) : Promise.reject(new Error("no signer")),
    ]);
    if (bountyRes.status === "fulfilled") {
      setBounty(bountyRes.value);
    } else {
      setBounty(null);
      if (isMissingEndpoint(bountyRes.reason)) setSupported(false);
    }
    const parsed =
      paramsRes.status === "fulfilled"
        ? parseParams((paramsRes.value.params as Record<string, unknown>) || {})
        : null;
    setParams(parsed);
    const h =
      heightRes.status === "fulfilled" && /^\d+$/.test(heightRes.value)
        ? BigInt(heightRes.value)
        : null;
    // The per-funder epoch counter resets lazily on the next funding, so a
    // value from an earlier epoch is spent allowance that no longer counts.
    if (memberRes.status === "fulfilled" && parsed && h !== null && parsed.epochBlocks > ZERO) {
      const m = memberRes.value.member;
      const epoch = h / parsed.epochBlocks;
      setFundedThisEpoch(
        m?.last_initiative_bounty_epoch && BigInt(m.last_initiative_bounty_epoch) === epoch
          ? toBig(m.initiative_bounty_funded_this_epoch)
          : ZERO,
      );
    } else {
      setFundedThisEpoch(null);
    }
    setLoading(false);
  }, [id, address]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    await load();
    onChanged();
  };

  const total = toBig(bounty?.bounty?.amount);
  const contributions = bounty?.bounty?.contributions ?? [];
  const mine = (bounty?.reclaim_status ?? []).filter((c) => c.funder === address);
  const myTotal = mine.reduce((sum, c) => sum + toBig(c.amount), ZERO);
  const myReclaimable = mine.filter((c) => c.reclaimable).reduce((sum, c) => sum + toBig(c.amount), ZERO);
  const nextMaturity = mine
    .filter((c) => !c.reclaimable)
    .map((c) => c.reclaimable_at_height)
    .sort((a, b) => Number(a) - Number(b))[0];

  const budget = toBig(initiative.budget);
  const ceiling = params ? (params.ratioAtto * budget) / ATTO : null;
  const room = ceiling !== null ? (ceiling > total ? ceiling - total : ZERO) : null;
  const myEpochRoom =
    params && fundedThisEpoch !== null
      ? params.perFunderEpoch > fundedThisEpoch
        ? params.perFunderEpoch - fundedThisEpoch
        : ZERO
      : null;
  const disabled = params !== null && params.ratioAtto === ZERO;
  const contributionsFull =
    params !== null && params.maxContributions > 0 && contributions.length >= params.maxContributions;

  const isOpen = initiative.status === InitiativeStatus.OPEN;
  const fundable = FUNDABLE.has(initiative.status);
  const affiliated =
    !!address &&
    [initiative.assignee, initiative.apprentice, initiative.creator, projectCreator].some(
      (a) => !!a && a === address,
    );
  const canFund = !!address && fundable && !affiliated && !disabled && !contributionsFull && room !== ZERO;

  const handleFund = async () => {
    if (!address) return;
    const micro = parseDreamToUdream(amount);
    if (!micro || micro === "0") {
      setActionError(`Enter a ${dream} amount above zero`);
      return;
    }
    const want = BigInt(micro);
    if (params && want < params.minContribution) {
      setActionError(`The smallest contribution is ${formatSpark(params.minContribution)} ${dream}`);
      return;
    }
    if (room !== null && want > room) {
      setActionError(`Only ${formatSpark(room)} ${dream} more fits under this initiative's bounty cap`);
      return;
    }
    if (myEpochRoom !== null && want > myEpochRoom) {
      setActionError(`You can fund ${formatSpark(myEpochRoom)} ${dream} more in bounties this epoch`);
      return;
    }
    try {
      setBusy("fund");
      setActionError(null);
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.FundInitiativeBounty,
          // uint64 as BigInt (the amino converter omits zero by BigInt
          // comparison); cosmos.Int as a decimal string.
          value: { funder: address, initiativeId: BigInt(id), amount: micro },
        },
      ]);
      setAmount("");
      await refresh();
    } catch (err) {
      console.error("Fund initiative bounty failed:", err);
      setActionError(errorMessage(err, "Failed to fund the bounty"));
    } finally {
      setBusy(null);
    }
  };

  const handleReclaim = async () => {
    if (!address) return;
    try {
      setBusy("reclaim");
      setActionError(null);
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.ReclaimInitiativeBounty,
          value: { funder: address, initiativeId: BigInt(id) },
        },
      ]);
      await refresh();
    } catch (err) {
      console.error("Reclaim initiative bounty failed:", err);
      setActionError(errorMessage(err, "Failed to reclaim the bounty"));
    } finally {
      setBusy(null);
    }
  };

  if (!supported) return null;
  if (loading && !bounty) return null;
  // Nothing escrowed and nothing more can be: say nothing.
  if (total === ZERO && (!fundable || disabled)) return null;

  const taxText = params?.transferTaxRate ? formatDecPercent(params.transferTaxRate) : null;

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Initiative bounty</h4>
        <span style={{ color: "var(--amber)" }} className="text-xs">
          {formatSpark(total)} {dream} escrowed
        </span>
        {ceiling !== null && ceiling > ZERO && (
          <span className="text-xs text-zinc-500">
            of {formatSpark(ceiling)} {dream} cap
          </span>
        )}
        {contributions.length > 0 && (
          <span className="text-xs text-zinc-500">
            {contributions.length} {contributions.length === 1 ? "contribution" : "contributions"}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Paid to the assignee only if the initiative completes
        {taxText ? `, less the ${taxText} transfer tax` : ""}, and only up to what they may still
        receive in transfers this epoch and season. If it closes or a challenge against it is
        upheld, every funder is refunded in full.
      </p>

      {mine.length > 0 && (
        <p className="mt-2 text-xs text-zinc-400">
          You have{" "}
          <span style={{ color: "var(--amber)" }}>
            {formatSpark(myTotal)} {dream}
          </span>{" "}
          in this bounty.
          {isOpen ? " While you hold it, you can't be assigned this initiative." : ""}
        </p>
      )}

      {address && fundable && (
        <div className="mt-2">
          {affiliated ? (
            <p className="text-xs text-zinc-500">
              The assignee, apprentice, initiative creator and project creator can&apos;t fund this bounty.
            </p>
          ) : disabled ? null : contributionsFull ? (
            <p className="text-xs text-zinc-500">This bounty has reached its limit of contributions.</p>
          ) : room === ZERO ? (
            <p className="text-xs text-zinc-500">This bounty is at its cap.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={dream}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-28 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleFund}
                  disabled={!canFund || busy === "fund" || !amount.trim()}
                  className="sd-btn sd-btn-secondary"
                >
                  {busy === "fund" ? "Funding..." : "Fund"}
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {room !== null && <>Room under the cap: {formatSpark(room)} {dream}.</>}
                {myEpochRoom !== null && (
                  <>
                    {" "}
                    You can fund {formatSpark(myEpochRoom)} {dream} more in bounties this epoch.
                  </>
                )}
                {params && params.minContribution > ZERO && (
                  <>
                    {" "}
                    Minimum {formatSpark(params.minContribution)} {dream}.
                  </>
                )}
              </p>
            </>
          )}
        </div>
      )}

      {mine.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleReclaim}
            disabled={busy === "reclaim" || myReclaimable === ZERO}
            className="sd-btn sd-btn-secondary"
          >
            {busy === "reclaim"
              ? "Reclaiming..."
              : `Reclaim ${formatSpark(myReclaimable > ZERO ? myReclaimable : myTotal)} ${dream}`}
          </button>
          {myReclaimable === ZERO && (
            <span className="text-xs text-zinc-500">
              {!isOpen ? (
                "Reclaim reopens only if the initiative returns to open."
              ) : nextMaturity ? (
                <>
                  Reclaimable from block {nextMaturity} (<BlockEta height={nextMaturity} fallback="timing unknown" />).
                </>
              ) : null}
            </span>
          )}
        </div>
      )}

      {actionError && <p className="mt-2 text-xs text-red-400">{actionError}</p>}
    </div>
  );
}
