"use client";

import { useEffect, useState, useCallback } from "react";
import type { ReactionCounts } from "@/types/blog";
import { ReactionType, REACTION_INFO } from "@/types/blog";
import { getReactionCounts, getUserReaction } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { MsgTypeUrls } from "@/lib/tx";
import { countToNum } from "@/lib/utils";

interface ReactionBarProps {
  postId: string;
  replyId?: string;
}

export default function ReactionBar({ postId, replyId = "0" }: ReactionBarProps) {
  const { address, connected, signAndBroadcast } = useWallet();
  const [counts, setCounts] = useState<ReactionCounts | null>(null);
  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [countsRes, userRes] = await Promise.all([
        getReactionCounts(postId, replyId),
        address
          ? getUserReaction(address, postId, replyId)
          : Promise.resolve({ reaction: null }),
      ]);
      setCounts(countsRes.counts);
      setUserReaction(userRes.reaction?.reaction_type || null);
    } catch {
      // API might not be available
    }
  }, [postId, replyId, address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleReact = async (reactionType: string) => {
    if (!connected || loading) return;
    setLoading(true);

    try {
      if (userReaction === reactionType) {
        // Remove reaction
        await signAndBroadcast([
          {
            typeUrl: MsgTypeUrls.RemoveReaction,
            value: {
              creator: address,
              postId: parseInt(postId),
              replyId: parseInt(replyId),
            },
          },
        ]);
      } else {
        // Add or change reaction
        await signAndBroadcast([
          {
            typeUrl: MsgTypeUrls.React,
            value: {
              creator: address,
              postId: parseInt(postId),
              replyId: parseInt(replyId),
              reactionType: (Object.values(ReactionType) as string[]).indexOf(reactionType) + 1,
            },
          },
        ]);
      }
      // Refresh data after tx
      await fetchData();
    } catch (err) {
      console.error("Reaction failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {Object.entries(ReactionType).map(([, value]) => {
        const info = REACTION_INFO[value];
        const key = `${value.replace("REACTION_TYPE_", "").toLowerCase()}_count` as keyof ReactionCounts;
        const count = counts ? countToNum(counts[key]) : 0;
        const isActive = userReaction === value;

        return (
          <button
            key={value}
            onClick={() => handleReact(value)}
            disabled={!connected || loading}
            title={connected ? info.label : "Connect wallet to react"}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm transition-colors ${
              isActive
                ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/50"
                : "bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700 hover:text-zinc-300"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <span>{info.emoji}</span>
            {count > 0 && <span className="text-xs">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
