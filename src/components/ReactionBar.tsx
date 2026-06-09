"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import type { ReactionCounts } from "@/types/blog";
import { ReactionType, REACTION_INFO } from "@/types/blog";
import { getReactionCounts, getUserReaction, invalidateReactions } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useIsReadOnly } from "@/contexts/ArchiveContext";
import { useSessionPermits } from "@/hooks/useSessionPermits";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { useTrustRank } from "@/hooks/useTrustRank";
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
  // The parent post's creator. A post author may always react within their own
  // thread (on the post and on its replies), regardless of membership / trust
  // gating — same self-participation rule as replying.
  postCreator?: string;
}

// The wallet rethrows a failed tx as `Transaction failed: <rawLog>`, where
// rawLog is the chain's verbose form: "failed to execute message; message
// index: 0: <addr>: <reason>". Strip the preamble and the leading bech32
// address so the inline chip shows just the human reason (e.g. "address is not
// an active member"), falling back to the raw message if it doesn't match.
function reactionErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const reason = raw
    .replace(/^Transaction failed:\s*/, "")
    .replace(/^failed to execute message; message index: \d+:\s*/, "")
    .replace(/^[a-z0-9]+1[a-z0-9]+:\s*/i, "")
    .trim();
  return reason || "Reaction failed";
}

export default function ReactionBar({ postId, replyId = "0", minReplyTrustLevel = 0, postCreator }: ReactionBarProps) {
  const { address, connected, signAndBroadcast } = useWallet();
  const permits = useSessionPermits();
  const isReadOnly = useIsReadOnly();
  const isMember = useIsRepMember(address);
  const trustRank = useTrustRank(address);
  const openToAll = minReplyTrustLevel === -1;
  // The post author bypasses the membership / trust gates on their own thread.
  const isAuthor = connected && !!postCreator && address === postCreator;
  const cannotReactMember = !openToAll && !isAuthor && connected && isMember === false;
  // As of chain commit 1124a9b reactions consult the same min_reply_trust_level
  // as replies. A value >= 1 means a member must additionally meet the trust
  // bar. We block only when we have a definitive answer (trustRank !== null);
  // otherwise leave enabled so we don't flash disabled while loading.
  const cannotReactTrust =
    !openToAll &&
    !isAuthor &&
    minReplyTrustLevel >= 1 &&
    connected &&
    isMember === true &&
    trustRank !== null &&
    trustRank < minReplyTrustLevel;
  // Also block when an active session key doesn't grant MsgReact — otherwise we
  // show an add-reaction button the session would reject at broadcast.
  const cannotReactSession = !permits(MsgTypeUrls.React);
  const cannotReact = cannotReactMember || cannotReactTrust || cannotReactSession;
  const [counts, setCounts] = useState<ReactionCounts | null>(null);
  const [userReaction, setUserReaction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close the add-reaction picker on an outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The popover is portaled out of this subtree, so check it separately.
      if (pickerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // Position the picker with fixed viewport coordinates so it never spills off
  // screen: clamp horizontally to the viewport edges and flip above the trigger
  // when there isn't room below (key on small/mobile screens). The popover
  // renders hidden until measured to avoid a mis-positioned flash, and we close
  // on scroll/resize since a fixed element would otherwise drift from its anchor.
  useEffect(() => {
    if (!pickerOpen) {
      setPickerPos(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current;
      const pop = popoverRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const margin = 8;
      const w = pop?.offsetWidth ?? 0;
      const h = pop?.offsetHeight ?? 0;
      let left = w ? Math.min(r.left, window.innerWidth - w - margin) : r.left;
      left = Math.max(margin, left);
      let top = r.bottom + 4;
      if (h && top + h > window.innerHeight - margin) {
        top = Math.max(margin, r.top - h - 4);
      }
      setPickerPos({ top, left });
    };
    place();
    const close = () => setPickerOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pickerOpen]);

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
    setError(null);

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
      // Refresh data after tx (invalidate first so the refetch hits the chain)
      invalidateReactions(postId, replyId);
      await fetchData();
    } catch (err) {
      console.error("Reaction failed:", err);
      setError(reactionErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const reactionsView = (Object.values(ReactionType) as string[]).map((value) => {
    const info = REACTION_INFO[value];
    const key = `${value.replace("REACTION_TYPE_", "").toLowerCase()}_count` as keyof ReactionCounts;
    return { value, info, count: counts ? countToNum(counts[key]) : 0 };
  });

  // When the viewer can't react (not connected, archived, non-member, or below
  // the trust bar) we don't render greyed-out buttons — we show the existing
  // reactions as read-only chips (zero-count emojis dropped) so the social
  // proof survives without the look of broken controls. `cannotReact` is only
  // ever true once membership/trust resolve definitively, so an eligible
  // member never flashes through this branch while those checks load.
  if (!connected || isReadOnly || cannotReact) {
    const present = reactionsView.filter((r) => r.count > 0);
    if (present.length === 0) return null;
    return (
      <div className="flex items-center gap-2">
        {present.map(({ value, info, count }) => (
          <span
            key={value}
            title={info.label}
            className="flex items-center gap-1 rounded-lg bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-400"
          >
            <span>{info.emoji}</span>
            <span className="text-xs">{count}</span>
          </span>
        ))}
      </div>
    );
  }

  // Eligible viewers see a compact bar: a toggle chip per reaction that already
  // has a count, plus an add-reaction button whose popover offers all four.
  const present = reactionsView.filter((r) => r.count > 0);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
      {present.map(({ value, info, count }) => {
        const isActive = userReaction === value;

        return (
          <button
            key={value}
            onClick={() => handleReact(value)}
            disabled={loading}
            title={info.label}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm transition-colors ${
              isActive
                ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/50"
                : "bg-zinc-800 text-zinc-400 border border-transparent hover:bg-zinc-700 hover:text-zinc-300"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <span>{info.emoji}</span>
            <span className="text-xs">{count}</span>
          </button>
        );
      })}

      <div className="relative" ref={pickerRef}>
        <button
          ref={triggerRef}
          onClick={() => setPickerOpen((o) => !o)}
          disabled={loading}
          title="Add reaction"
          aria-label="Add reaction"
          aria-expanded={pickerOpen}
          className={`flex items-center rounded-lg border px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 ${
            pickerOpen ? "border-zinc-600 bg-zinc-700" : "border-transparent bg-zinc-800"
          }`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9" />
            <path d="M8.5 14.5c.9.9 2.1 1.4 3.5 1.4s2.6-.5 3.5-1.4" />
            <path d="M9 9.5h.01M14 9.5h.01" />
            <path d="M19 3v4M17 5h4" />
          </svg>
        </button>

        {pickerOpen && typeof document !== "undefined" && createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: pickerPos?.top ?? 0,
              left: pickerPos?.left ?? 0,
              visibility: pickerPos ? "visible" : "hidden",
            }}
            className="z-50 flex items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-lg"
          >
            {reactionsView.map(({ value, info }) => {
              const isActive = userReaction === value;
              return (
                <button
                  key={value}
                  onClick={() => {
                    handleReact(value);
                    setPickerOpen(false);
                  }}
                  disabled={loading}
                  title={info.label}
                  className={`rounded px-2 py-1 text-base transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                    isActive ? "bg-indigo-600/20" : ""
                  }`}
                >
                  {info.emoji}
                </button>
              );
            })}
          </div>,
          document.body
        )}
      </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
