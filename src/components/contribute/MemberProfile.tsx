"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { getRepMember } from "@/lib/api";
import { truncateAddress, formatTime } from "@/lib/utils";
import type { RepMember } from "@/types/rep";
import { TRUST_LEVEL_LABELS, MEMBER_STATUS_LABELS, TrustLevel } from "@/types/rep";

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

export default function MemberProfile() {
  const { address } = useWallet();
  const [member, setMember] = useState<RepMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const fetchMember = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);
      setNotFound(false);
      const res = await getRepMember(address);
      setMember(res.member);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load member";
      if (msg.includes("404") || msg.includes("not found")) {
        setNotFound(true);
      } else {
        setError(msg);
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
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        <div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchMember} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  if (notFound || !member) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
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
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-zinc-500">Member</p>
            <p className="mt-0.5 font-mono text-sm text-zinc-300">{truncateAddress(member.address, 14, 6)}</p>
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
            <p className="text-xs text-zinc-500">Liquid DREAM</p>
            <p className="mt-0.5 text-lg font-semibold text-white">{formatDream(member.dream_balance)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Staked DREAM</p>
            <p className="mt-0.5 text-lg font-semibold text-white">{formatDream(member.staked_dream)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Lifetime Earned</p>
            <p className="mt-0.5 text-lg font-semibold text-zinc-300">{formatDream(member.lifetime_earned)}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Invitation Credits</p>
            <p className="mt-0.5 text-lg font-semibold text-zinc-300">{member.invitation_credits}</p>
          </div>
        </div>
      </div>

      {/* Reputation scores */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h3 className="text-sm font-semibold text-zinc-200">Reputation Scores</h3>
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
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h3 className="text-sm font-semibold text-zinc-200">Details</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-500">Joined</dt>
            <dd className="text-zinc-300">{formatTime(member.joined_at)}</dd>
          </div>
          {member.invited_by && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">Invited by</dt>
              <dd className="font-mono text-xs text-zinc-300">{truncateAddress(member.invited_by)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-zinc-500">Completed Initiatives</dt>
            <dd className="text-zinc-300">{member.completed_initiatives_count}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Completed Interims</dt>
            <dd className="text-zinc-300">{member.completed_interims_count}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-500">Season Joined</dt>
            <dd className="text-zinc-300">{member.joined_season}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
