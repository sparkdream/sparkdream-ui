"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Post, ReactionCounts } from "@/types/blog";
import { PostStatus, REACTION_INFO, ReactionType } from "@/types/blog";
import { timeAgo, countToNum, truncateAddress } from "@/lib/utils";
import { getReactionCounts } from "@/lib/api";
import { useDisplayName } from "@/hooks/useDisplayName";

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #6366f1, #f472b6)",
  "linear-gradient(135deg, #34d399, #6366f1)",
  "linear-gradient(135deg, #f59e0b, #f472b6)",
  "linear-gradient(135deg, #60a5fa, #34d399)",
  "linear-gradient(135deg, #f472b6, #f59e0b)",
  "linear-gradient(135deg, #7c7fff, #60a5fa)",
];

function gradientFor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

function initialFor(name: string | null, addr: string): string {
  const src = name || addr;
  const match = src.match(/[A-Za-z]/);
  return (match ? match[0] : "•").toUpperCase();
}

export default function PostRow({
  post,
  onSelect,
}: {
  post: Post;
  /** When provided, the row renders as a button that calls this handler
      instead of navigating via Link. Used when the parent page wants to show
      the detail view inline (like Swarm/Wonders). */
  onSelect?: (post: Post) => void;
}) {
  const [counts, setCounts] = useState<ReactionCounts | null>(null);
  const { name } = useDisplayName(post.creator);

  useEffect(() => {
    getReactionCounts(post.id)
      .then((r) => setCounts(r.counts))
      .catch(() => {});
  }, [post.id]);

  if (post.status === PostStatus.DELETED) return null;

  const isHidden = post.status === PostStatus.HIDDEN;
  const replyCount = countToNum(post.reply_count);

  const commonStyle = isHidden ? { opacity: 0.5 } : undefined;

  const inner = (
    <>
      <div className="who-col">
        <div className="sd-avatar" style={{ background: gradientFor(post.creator) }}>
          {initialFor(name, post.creator)}
        </div>
      </div>
      <div className="body-col">
        <div className="head">
          <span className="addr">{name || truncateAddress(post.creator)}</span>
          <span className="sep">·</span>
          <span>{timeAgo(post.created_at)}</span>
          {post.edited && (
            <>
              <span className="sep">·</span>
              <span style={{ fontStyle: "italic" }}>edited</span>
            </>
          )}
          {post.pinned_by && (
            <>
              <span className="sep">·</span>
              <span className="sd-pill trust-core" style={{ fontFamily: "var(--font-geist-sans)" }}>
                ◆ Pinned
              </span>
            </>
          )}
          {isHidden && (
            <>
              <span className="sep">·</span>
              <span className="sd-pill" style={{ background: "rgba(244,63,94,0.12)", color: "#fb7185" }}>
                Hidden
              </span>
            </>
          )}
        </div>
        <h3>{post.title}</h3>
        <p className="excerpt">{post.body}</p>
      </div>
      <div className="stats-col">
        <span className="stat">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {replyCount} {replyCount === 1 ? "reply" : "replies"}
        </span>
        {counts && (
          <div className="react-row">
            {Object.values(ReactionType).map((rt) => {
              const info = REACTION_INFO[rt];
              const key = `${rt.replace("REACTION_TYPE_", "").toLowerCase()}_count` as keyof ReactionCounts;
              const n = countToNum(counts[key]);
              if (n === 0) return null;
              return (
                <span key={rt} className="react">
                  {info.emoji} {n}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(post)}
        className="sd-post"
        style={{ ...commonStyle, textAlign: "left", width: "100%", font: "inherit" }}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link href={`/imaginarium/${post.id}`} className="sd-post" style={commonStyle}>
      {inner}
    </Link>
  );
}
