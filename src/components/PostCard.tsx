"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Post, ReactionCounts } from "@/types/blog";
import { PostStatus, REACTION_INFO, ReactionType } from "@/types/blog";
import { timeAgo, countToNum } from "@/lib/utils";
import { getReactionCounts } from "@/lib/api";
import NameOrAddress from "@/components/NameOrAddress";
import ContentNotice from "@/components/content/ContentNotice";
import { useScannedBody } from "@/hooks/useScannedBody";

interface PostCardProps {
  post: Post;
}

export default function PostCard({ post }: PostCardProps) {
  const [counts, setCounts] = useState<ReactionCounts | null>(null);
  const scanned = useScannedBody({
    kind: "blog-post",
    id: post.id,
    body: post.body,
    media_flags: post.media_flags,
    body_hash: post.body_hash,
    author: post.creator,
  });

  useEffect(() => {
    getReactionCounts(post.id)
      .then((r) => setCounts(r.counts))
      .catch(() => {});
  }, [post.id]);

  if (post.status === PostStatus.DELETED) return null;
  // Removed by scanner verdict: dropped from lists, as before.
  if (scanned.status === "removed") return null;

  const isHidden = post.status === PostStatus.HIDDEN;
  const replyCount = countToNum(post.reply_count);

  return (
    <Link href={`/imaginarium/${post.id}`} className="block">
      <article
        className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900 ${
          isHidden ? "opacity-50" : ""
        }`}
      >
        <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
          <NameOrAddress address={post.creator} className="font-mono" />
          <span>&middot;</span>
          <span>{timeAgo(post.created_at)}</span>
          {post.edited && (
            <>
              <span>&middot;</span>
              <span className="italic">edited</span>
            </>
          )}
          {post.pinned_by && (
            <span className="ml-auto rounded bg-amber-900/30 px-1.5 py-0.5 text-amber-400">
              Pinned
            </span>
          )}
          {isHidden && (
            <span className="ml-auto rounded bg-red-900/30 px-1.5 py-0.5 text-red-400">
              Hidden
            </span>
          )}
        </div>

        <h2 className="mb-2 text-lg font-semibold text-white">
          {post.title}
        </h2>

        <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-zinc-400">
          {scanned.status === "show" ? (
            scanned.text
          ) : (
            <ContentNotice status={scanned.status} reason={scanned.reason} noun="dream" compact />
          )}
        </p>

        <div className="flex items-center gap-4 text-xs text-zinc-500">
          {counts && (
            <div className="flex items-center gap-3">
              {Object.entries(ReactionType).map(([, value]) => {
                const info = REACTION_INFO[value];
                const key = `${value.replace("REACTION_TYPE_", "").toLowerCase()}_count` as keyof ReactionCounts;
                const count = countToNum(counts[key]);
                if (count === 0) return null;
                return (
                  <span key={value} className="flex items-center gap-1">
                    <span>{info.emoji}</span>
                    <span>{count}</span>
                  </span>
                );
              })}
            </div>
          )}
          <span className="ml-auto flex items-center gap-1">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
        </div>
      </article>
    </Link>
  );
}
