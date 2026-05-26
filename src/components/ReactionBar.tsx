"use client";

import { useEffect, useState, useCallback } from "react";
import type { ReactionCounts } from "@/types/blog";
import { ReactionType, REACTION_INFO } from "@/types/blog";
import { getReactionCounts, getUserReaction } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useIsReadOnly } from "@/contexts/ArchiveContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { MsgTypeUrls } from "@/lib/tx";
import { countToNum } from "@/lib/utils";

interface ReactionBarProps {
  postId: string;
  replyId?: string;
  // The parent post's min_reply_trust_level. Governs who can react (mirrors
  // the chain rule that the same knob controls reply AND reaction audience).
  // -1 = open to anyone, 0 (default) = active members only, >=1 = trust gate.
  // Reactions on a reply use the parent post's setting — pass the same value.
  minReplyTrustLevel?: number;
}

export default function ReactionBar({ postId, replyId = "0", minReplyTrustLevel = 0 }: ReactionBarProps) {
  const { address, connected, signAndBroadcast } = useWallet();
  const isReadOnly = useIsReadOnly();
  const isMember = useIsRepMember(address);
  const openToAll = minReplyTrustLevel === -1;
  const cannotReact = !openToAll && connected && isMember === false;
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
      // post_id / reply_id are uint64. replyId defaults to "0" for reactions
      // on a top-level post; passing Number(0) made the override's
      // `!== BigInt(0)` check fail-open (Number !== BigInt is always true)
      // and signed `"reply_id":"0"` while aminojson on the chain omits the
      // uint64 zero — every reaction on a non-reply hit "unauthorized"
      // sigverify. Wrap both in BigInt so the override's zero-omit branch
      // actually fires.
      if (userReaction === reactionType) {
        // Remove reaction
        await signAndBroadcast([
          {
            typeUrl: MsgTypeUrls.RemoveReaction,
            value: {
              creator: address,
              postId: BigInt(postId),
              replyId: BigInt(replyId),
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
              postId: BigInt(postId),
              replyId: BigInt(replyId),
              // reaction_type is int32 enum on the wire — Number stays a
              // Number, the override uses `=== 0` which works correctly.
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
            disabled={!connected || loading || isReadOnly || cannotReact}
            title={
              isReadOnly
                ? "Archived — read only"
                : !connected
                  ? "Connect wallet to react"
                  : cannotReact
                    ? "Only existing members can react"
                    : info.label
            }
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
