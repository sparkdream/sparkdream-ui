"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTrustRank } from "@/hooks/useTrustRank";
import { ForumMsgTypeUrls } from "@/lib/tx";
import { getForumParams, getTxEventAttributes } from "@/lib/api";

// ESTABLISHED trust rank (see useTrustRank): the chain requires ESTABLISHED+
// to open a post-conviction stake.
const ESTABLISHED_RANK = 2;
const UDREAM = 1_000_000;

// The chain exposes no query for PostConvictionStakes, and a release needs the
// stake id (returned only in the `post_conviction_staked` tx event). We mirror
// the staker's own stakes in localStorage keyed by address so they can release
// in-app after the lock window; stakes are always also releasable via the CLI.
interface StoredStake {
  stakeId: string;
  postId: string;
  amount: string; // uDREAM
  unlocksAt: number; // unix seconds
}

function storageKey(address: string): string {
  return `forum.conviction.${address}`;
}

function loadStakes(address: string): StoredStake[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(storageKey(address)) || "[]");
  } catch {
    return [];
  }
}

function saveStakes(address: string, stakes: StoredStake[]): void {
  localStorage.setItem(storageKey(address), JSON.stringify(stakes));
}

function formatDream(udream: string): string {
  if (!udream || udream === "0") return "0";
  return (BigInt(udream) / BigInt(UDREAM)).toLocaleString();
}

interface Props {
  postId: string;
  author: string;
  onChanged?: () => void;
}

export default function PostConvictionControl({ postId, author, onChanged }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const rank = useTrustRank(address);

  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [minStake, setMinStake] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stakes, setStakes] = useState<StoredStake[]>([]);
  const [nowSec, setNowSec] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // Reset to null synchronously when the viewer changes so we never show the
  // previous account's stakes for a render (mirrors useTrustRank's pattern).
  const [trackedAddress, setTrackedAddress] = useState(address);
  if (address !== trackedAddress) {
    setTrackedAddress(address);
    setStakes(address ? loadStakes(address) : []);
  }

  useEffect(() => {
    setStakes(address ? loadStakes(address) : []);
  }, [address]);

  // A coarse clock for the unlock countdown; release only flips available once
  // a minute, which is plenty for a lock measured in days.
  useEffect(() => {
    setNowSec(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  const postStakes = stakes.filter((s) => s.postId === postId);

  // Don't surface anything to the author (they can't stake on their own post)
  // or to disconnected viewers with nothing stored.
  if (!address || address === author) return null;
  const eligible = rank !== null && rank >= ESTABLISHED_RANK;
  if (!eligible && postStakes.length === 0) {
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
      const hash = await signAndBroadcast([
        {
          typeUrl: ForumMsgTypeUrls.StakePostConviction,
          value: { creator: address, postId: BigInt(postId), amount: udream },
        },
      ]);
      // Recover the stake id + unlock time from the tx event so the staker can
      // release in-app later (no query endpoint exists for stakes).
      const attrs = await getTxEventAttributes(hash, "post_conviction_staked").catch(
        () => ({} as Record<string, string>)
      );
      if (attrs.stake_id) {
        const next = [
          ...loadStakes(address),
          {
            stakeId: attrs.stake_id,
            postId,
            amount: attrs.amount || udream,
            unlocksAt: parseInt(attrs.unlocks_at || "0", 10),
          },
        ];
        saveStakes(address, next);
        setStakes(next);
        setNotice(null);
      } else {
        setNotice("Stake created, but its id could not be recorded for in-app release. You can still release it via the CLI.");
      }
      setShowForm(false);
      setAmount("");
      onChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to open conviction stake.");
    } finally {
      setLoading(false);
    }
  };

  const handleRelease = async (stake: StoredStake) => {
    if (!address) return;
    setLoading(true);
    setNotice(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: ForumMsgTypeUrls.ReleasePostConviction,
          value: { creator: address, stakeId: BigInt(stake.stakeId) },
        },
      ]);
      const next = loadStakes(address).filter((s) => s.stakeId !== stake.stakeId);
      saveStakes(address, next);
      setStakes(next);
      onChanged?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to release stake.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {postStakes.map((s) => {
        const unlocked = s.unlocksAt > 0 && nowSec >= s.unlocksAt;
        const mins = Math.max(0, Math.ceil((s.unlocksAt - nowSec) / 60));
        return (
          <button
            key={s.stakeId}
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
