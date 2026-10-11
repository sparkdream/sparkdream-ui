"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { getCurrentSeason, getLatestBlockHeight, getRepMember, getRepParams } from "@/lib/api";
import { licenseLabel, licenseUrl } from "@/lib/contentLicense";
import { formatTime } from "@/lib/utils";
import CopyableAddress from "@/components/CopyableAddress";
import type { RepMember } from "@/types/rep";
import { TRUST_LEVEL_LABELS, MEMBER_STATUS_LABELS, TrustLevel } from "@/types/rep";
import ErrorState from "@/components/ErrorState";
import { isMissingEndpoint } from "@/lib/errors";
import { useDreamDenom } from "@/hooks/useDreamDenom";

function trustLevelColor(level: string): string {
  switch (level) {
    case TrustLevel.CORE: return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case TrustLevel.TRUSTED: return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case TrustLevel.ESTABLISHED: return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case TrustLevel.PROVISIONAL: return "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
    default: return "bg-zinc-800/50 text-zinc-400 border-zinc-700";
  }
}

function formatDream(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  const divisor = BigInt(1000000);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === BigInt(0)) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

/** The member's DREAM transfer allowances, with stale counters zeroed. */
interface Allowances {
  receiveEpochLeft: bigint;
  receiveEpochMax: bigint;
  receiveSeasonLeft: bigint;
  receiveSeasonMax: bigint;
  tipsLeft: bigint;
  tipsMax: bigint;
  maxTip: bigint;
  bountyFundLeft: bigint;
  bountyFundMax: bigint;
}

const ZERO = BigInt(0);

function big(v: unknown): bigint {
  return typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : ZERO;
}

function left(max: bigint, used: bigint): bigint {
  return max > used ? max - used : ZERO;
}

/**
 * Remaining transfer allowances (chain commit b9da52e). Every counter on the
 * member record resets lazily on the next transfer, so one stamped with an
 * earlier epoch or season counts as nothing used.
 */
function computeAllowances(
  m: RepMember,
  p: Record<string, unknown>,
  epoch: bigint | null,
  season: bigint | null,
): Allowances | null {
  const receiveEpochMax = big(p.max_transfer_received_per_epoch);
  const receiveSeasonMax = big(p.max_transfer_received_per_season);
  // A node older than the transfer caps reports none of these params.
  if (receiveEpochMax === ZERO && receiveSeasonMax === ZERO) return null;
  const current = (stamp: string | undefined, now: bigint | null, used: string | undefined) =>
    now !== null && stamp !== undefined && /^\d+$/.test(stamp) && BigInt(stamp) === now ? big(used) : ZERO;
  const tipsMax = big(p.max_tips_sent_per_epoch);
  const bountyFundMax = big(p.max_initiative_bounty_per_funder_epoch);
  return {
    receiveEpochMax,
    receiveEpochLeft: left(receiveEpochMax, current(m.last_transfer_received_epoch, epoch, m.transfer_received_this_epoch)),
    receiveSeasonMax,
    receiveSeasonLeft: left(receiveSeasonMax, current(m.last_transfer_received_season, season, m.transfer_received_this_season)),
    tipsMax,
    tipsLeft: left(tipsMax, current(m.last_tip_epoch, epoch, m.tips_sent_this_epoch)),
    maxTip: big(p.max_tip_amount),
    bountyFundMax,
    bountyFundLeft: left(bountyFundMax, current(m.last_initiative_bounty_epoch, epoch, m.initiative_bounty_funded_this_epoch)),
  };
}

export default function MemberProfile() {
  const dream = useDreamDenom();
  const { address } = useWallet();
  const [member, setMember] = useState<RepMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [allowances, setAllowances] = useState<Allowances | null>(null);

  const fetchMember = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);
      setNotFound(false);
      const res = await getRepMember(address);
      setMember(res.member);
      // Allowances are a nicety: any read failing just hides the section.
      const [paramsRes, heightRes, seasonRes] = await Promise.allSettled([
        getRepParams(),
        getLatestBlockHeight(),
        getCurrentSeason(),
      ]);
      if (paramsRes.status === "fulfilled" && res.member) {
        const p = (paramsRes.value.params as Record<string, unknown>) || {};
        const epochBlocks = big(p.epoch_blocks);
        const epoch =
          heightRes.status === "fulfilled" && /^\d+$/.test(heightRes.value) && epochBlocks > ZERO
            ? BigInt(heightRes.value) / epochBlocks
            : null;
        const season =
          seasonRes.status === "fulfilled" && /^\d+$/.test(seasonRes.value.number ?? "")
            ? BigInt(seasonRes.value.number)
            : null;
        setAllowances(computeAllowances(res.member, p, epoch, season));
      } else {
        setAllowances(null);
      }
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setNotFound(true);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchMember();
  }, [fetchMember]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-xl sd-hull-tile" />
        <div className="h-48 animate-pulse rounded-xl sd-hull-tile" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState error={error} onRetry={fetchMember} />
    );
  }

  if (notFound || !member) {
    return (
      <div className="rounded-xl sd-hull-tile p-12 text-center">
        <svg className="mx-auto h-12 w-12 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
        <p className="mt-4 text-zinc-400">You are not yet a member</p>
        <p className="mt-1 text-xs text-zinc-500">
          An existing member needs to invite you to join
        </p>
      </div>
    );
  }

  const repTags = Object.entries(member.reputation_scores || {});

  return (
    <div className="space-y-4">
      {/* Balance & trust level card */}
      <div className="rounded-xl sd-hull-tile p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-zinc-500">Member</p>
            <CopyableAddress className="mt-0.5 font-mono text-sm text-zinc-300" address={member.address} prefixLen={14} suffixLen={6} style={{ display: "block" }} />
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${trustLevelColor(member.trust_level)}`}>
              {TRUST_LEVEL_LABELS[member.trust_level] || member.trust_level}
            </span>
            <span className="rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-0.5 text-xs text-zinc-400">
              {MEMBER_STATUS_LABELS[member.status] || member.status}
            </span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-zinc-500">Liquid {dream}</p>
            <p className="mt-0.5 text-lg font-semibold text-white">{formatDream(member.dream_balance)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Staked {dream}</p>
            <p className="mt-0.5 text-lg font-semibold text-white">{formatDream(member.staked_dream)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Lifetime earned</p>
            <p className="mt-0.5 text-lg font-semibold text-zinc-300">{formatDream(member.lifetime_earned)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Invitation credits</p>
            <p className="mt-0.5 text-lg font-semibold text-zinc-300">{member.invitation_credits}</p>
          </div>
        </div>
      </div>

      {/* Reputation scores */}
      <div className="rounded-xl sd-hull-tile p-5">
        <h3 className="text-sm font-semibold text-zinc-200">Reputation scores</h3>
        {repTags.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No reputation scores yet</p>
        ) : (
          <div className="mt-3 space-y-2">
            {repTags.map(([tag, score]) => (
              <div key={tag} className="flex items-center justify-between rounded-lg bg-zinc-800/30 px-3 py-2">
                <span className="text-sm text-zinc-300">{tag}</span>
                <span className="font-mono text-sm text-indigo-400">{parseFloat(score).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="rounded-xl sd-hull-tile p-5">
        <h3 className="text-sm font-semibold text-zinc-200">Details</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-500">Joined</dt>
            <dd className="text-zinc-300">{formatTime(member.joined_at)}</dd>
          </div>
          {member.invited_by && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">Invited by</dt>
              <dd className="font-mono text-xs text-zinc-300"><CopyableAddress address={member.invited_by} /></dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-zinc-500">Completed initiatives</dt>
            <dd className="text-zinc-300">{member.completed_initiatives_count}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Completed interims</dt>
            <dd className="text-zinc-300">{member.completed_interims_count}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Season joined</dt>
            <dd className="text-zinc-300">{member.joined_season}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Content license</dt>
            <dd className="text-right text-zinc-300">
              {member.content_license ? (
                <>
                  {licenseUrl(member.content_license) ? (
                    <a
                      href={licenseUrl(member.content_license)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {licenseLabel(member.content_license)}
                    </a>
                  ) : (
                    licenseLabel(member.content_license)
                  )}
                  <span className="block text-xs text-zinc-500">Agreed on joining</span>
                </>
              ) : (
                <span className="text-zinc-500">Not recorded</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* Transfer allowances. The chain caps what a member may receive (tips
          and initiative bounty payouts) per epoch and per season, tips by
          amount per sender, and bounty funding per funder. Gifts are capped
          per invitee for life and are not shown here. */}
      {allowances && (
        <div className="rounded-xl sd-hull-tile p-5">
          <h3 className="text-sm font-semibold text-zinc-200">{dream} transfer allowances</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">You can still receive this epoch</dt>
              <dd style={{ color: "var(--amber)" }}>
                {formatDream(allowances.receiveEpochLeft.toString())} of {formatDream(allowances.receiveEpochMax.toString())}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">You can still receive this season</dt>
              <dd style={{ color: "var(--amber)" }}>
                {formatDream(allowances.receiveSeasonLeft.toString())} of {formatDream(allowances.receiveSeasonMax.toString())}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Tips you can still send this epoch</dt>
              <dd className="text-zinc-300">
                {formatDream(allowances.tipsLeft.toString())} of {formatDream(allowances.tipsMax.toString())}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Initiative bounty funding left this epoch</dt>
              <dd className="text-zinc-300">
                {formatDream(allowances.bountyFundLeft.toString())} of {formatDream(allowances.bountyFundMax.toString())}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">
            Received counts tips and initiative bounty payouts. A single tip is at most{" "}
            {formatDream(allowances.maxTip.toString())} {dream}.
          </p>
        </div>
      )}
    </div>
  );
}
