"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTrustRank } from "@/hooks/useTrustRank";
import { ForumMsgTypeUrls } from "@/lib/tx";
import { getForumParams } from "@/lib/api";
import type { PostConvictionStake } from "@/types/forum";

// ESTABLISHED trust rank (see useTrustRank): the chain requires ESTABLISHED+
// to open a post-conviction stake.
const ESTABLISHED_RANK = 2;
const UDREAM = 1_000_000;

function formatDream(udream: string): string {
  if (!udream || udream === "0") return "0";
  return (BigInt(udream) / BigInt(UDREAM)).toLocaleString();
}

interface Props {
  postId: string;
  author: string;
  // The connected viewer's open (unreleased) stakes on this post, fetched once
  // by the parent thread via listPostConvictionStakesByStaker. After a stake or
  // release, onChanged triggers the parent to refetch and flow new stakes down.
  stakes: PostConvictionStake[];
  onChanged?: () => void;
}

export default function PostConvictionControl({ postId, author, stakes, onChanged }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const rank = useTrustRank(address);

  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [minStake, setMinStake] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nowSec, setNowSec] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // A coarse clock for the unlock countdown; release only flips available once
  // a minute, which is plenty for a lock measured in days.
  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  // Don't surface anything to the author (they can't stake on their own post)
  // or to disconnected viewers with nothing staked.
  if (!address || address === author) return null;
  const eligible = rank !== null && rank >= ESTABLISHED_RANK;
  if (!eligible && stakes.length === 0) {
    return (
      <span
        className="text-xs text-zinc-600"
        title="Backing an author with a conviction stake requires Established trust level or higher"
      >
        Back author
      </span>
    );
  }

  const openForm = async () => {
    setShowForm(true);
    setNotice(null);
    if (minStake === null) {
      const res = await getForumParams().catch(() => null);
      if (res) setMinStake(res.params?.min_post_conviction_stake || "0");
    }
  };

  const handleStake = async () => {
    if (!address) return;
    const dream = parseFloat(amount);
    if (!Number.isFinite(dream) || dream <= 0) {
      setNotice("Enter a DREAM amount greater than zero.");
      return;
    }
    const udream = BigInt(Math.round(dream * UDREAM)).toString();
    setLoading(true);
    setNotice(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: ForumMsgTypeUrls.StakePostConviction,
          value: { creator: address, postId: BigInt(postId), amount: udream },
        },
      ]);
      setShowForm(false);
      setAmount("");
      onChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to open conviction stake.");
    } finally {
      setLoading(false);
    }
  };

  const handleRelease = async (stake: PostConvictionStake) => {
    if (!address) return;
    setLoading(true);
    setNotice(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: ForumMsgTypeUrls.ReleasePostConviction,
          value: { creator: address, stakeId: BigInt(stake.id) },
        },
      ]);
      onChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to release stake.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {stakes.map((s) => {
        const unlocksAt = parseInt(s.unlocks_at || "0", 10);
        const unlocked = unlocksAt > 0 && nowSec >= unlocksAt;
        const mins = Math.max(0, Math.ceil((unlocksAt - nowSec) / 60));
        return (
          <button
            key={s.id}
            onClick={() => handleRelease(s)}
            disabled={loading || !unlocked}
            title={
              unlocked
                ? `Release your ${formatDream(s.amount)} DREAM conviction stake`
                : `Locked for ~${mins >= 60 ? `${Math.ceil(mins / 60)}h` : `${mins}m`} more`
            }
            className="rounded border border-emerald-700/50 px-2 py-0.5 text-xs text-emerald-400 transition-colors hover:bg-emerald-900/20 disabled:opacity-50"
          >
            {unlocked ? `Release ${formatDream(s.amount)} DREAM` : `Staked ${formatDream(s.amount)} DREAM (locked)`}
          </button>
        );
      })}

      {!showForm ? (
        <button
          onClick={openForm}
          disabled={!eligible}
          title={eligible ? "Lock DREAM to stream reputation to this author" : "Requires Established trust level or higher"}
          className="text-xs text-zinc-400 transition-colors hover:text-emerald-400 disabled:opacity-50"
        >
          Back author
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={minStake ? `min ${formatDream(minStake)}` : "DREAM"}
            className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200 focus:border-emerald-700 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">DREAM</span>
          <button
            onClick={handleStake}
            disabled={loading}
            className="rounded bg-emerald-700/30 px-2 py-0.5 text-xs text-emerald-400 transition-colors hover:bg-emerald-700/50 disabled:opacity-50"
          >
            {loading ? "..." : "Stake"}
          </button>
          <button
            onClick={() => { setShowForm(false); setNotice(null); }}
            disabled={loading}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </span>
      )}

      {notice && <span className="text-xs text-amber-400">{notice}</span>}
    </span>
  );
}
