"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Post, Reply } from "@/types/blog";
import { PostStatus } from "@/types/blog";
import { getPost, listReplies } from "@/lib/api";
import { truncateAddress, formatTime, timeAgo } from "@/lib/utils";
import ReactionBar from "@/components/ReactionBar";
import ReplyThread from "@/components/ReplyThread";
import ReplyForm from "@/components/ReplyForm";
import { useWallet } from "@/contexts/WalletContext";
import { MsgTypeUrls } from "@/lib/tx";

export default function PostDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { address, connected, signAndBroadcast } = useWallet();

  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [postRes, repliesRes] = await Promise.all([
        getPost(id),
        listReplies(id, { limit: "100", countTotal: true }),
      ]);
      setPost(postRes.post);
      setReplies(repliesRes.replies || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load post");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this post?")) return;
    setActionLoading(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: MsgTypeUrls.DeletePost,
          value: { creator: address, id: parseInt(id) },
        },
      ]);
      await fetchData();
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleHide = async () => {
    setActionLoading(true);
    try {
      const isHidden = post?.status === PostStatus.HIDDEN;
      await signAndBroadcast([
        {
          typeUrl: isHidden ? MsgTypeUrls.UnhidePost : MsgTypeUrls.HidePost,
          value: { creator: address, id: parseInt(id) },
        },
      ]);
      await fetchData();
    } catch (err) {
      console.error("Hide/unhide failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleReplies = async () => {
    if (!post) return;
    setActionLoading(true);
    try {
      const newRepliesEnabled = !post.replies_enabled;
      await signAndBroadcast([
        {
          typeUrl: MsgTypeUrls.UpdatePost,
          value: {
            creator: address,
            id: parseInt(id),
            title: post.title,
            body: post.body,
            contentType: parseInt(post.content_type) || 0,
            repliesEnabled: newRepliesEnabled,
            minReplyTrustLevel: post.min_reply_trust_level,
          },
        },
      ]);
      await fetchData();
    } catch (err) {
      console.error("Toggle replies failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePin = async () => {
    setActionLoading(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: MsgTypeUrls.PinPost,
          value: { creator: address, id: parseInt(id) },
        },
      ]);
      await fetchData();
    } catch (err) {
      console.error("Pin failed:", err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="mt-4 h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border border-red-800 bg-red-900/20 p-6 text-center">
          <p className="text-red-400">{error || "Post not found"}</p>
          <Link
            href="/blog"
            className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300"
          >
            Back to blog
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = connected && address === post.creator;
  const isHidden = post.status === PostStatus.HIDDEN;
  const isDeleted = post.status === PostStatus.DELETED;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <Link
        href="/blog"
        className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to blog
      </Link>

      {/* Post */}
      <article
        className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 ${
          isHidden ? "opacity-60" : ""
        }`}
      >
        {/* Status badges */}
        <div className="mb-3 flex items-center gap-2">
          {post.pinned_by && (
            <span className="rounded bg-amber-900/30 px-2 py-0.5 text-xs text-amber-400">
              Pinned
            </span>
          )}
          {isHidden && (
            <span className="rounded bg-red-900/30 px-2 py-0.5 text-xs text-red-400">
              Hidden
            </span>
          )}
          {isDeleted && (
            <span className="rounded bg-red-900/30 px-2 py-0.5 text-xs text-red-400">
              Deleted
            </span>
          )}
          {post.expires_at && post.expires_at !== "0" && (
            <span className="rounded bg-yellow-900/30 px-2 py-0.5 text-xs text-yellow-400" title={`Expires ${formatTime(post.expires_at)}`}>
              Ephemeral
            </span>
          )}
          {post.conviction_sustained && (
            <span className="rounded bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
              Conviction Sustained
            </span>
          )}
          {post.initiative_id && post.initiative_id !== "0" && (
            <span className="rounded bg-blue-900/30 px-2 py-0.5 text-xs text-blue-400">
              Initiative #{post.initiative_id}
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="mb-3 flex items-center gap-2 text-sm text-zinc-500">
          <span className="font-mono">{truncateAddress(post.creator)}</span>
          <span>&middot;</span>
          <span title={formatTime(post.created_at)}>{timeAgo(post.created_at)}</span>
          {post.edited && (
            <>
              <span>&middot;</span>
              <span className="italic" title={`Edited ${formatTime(post.edited_at)}`}>
                edited
              </span>
            </>
          )}
        </div>

        {/* Title & Body */}
        <h1 className="mb-4 text-2xl font-bold text-white">{post.title}</h1>
        <div className="mb-6 whitespace-pre-wrap text-zinc-300 leading-relaxed">
          {isDeleted ? (
            <p className="italic text-zinc-600">[This post has been deleted]</p>
          ) : (
            post.body
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
          <ReactionBar postId={post.id} />

          <div className="flex items-center gap-2">
            {connected && !isDeleted && !post.pinned_by && post.expires_at && post.expires_at !== "0" && (
              <button
                onClick={handlePin}
                disabled={actionLoading}
                className="rounded px-3 py-1 text-xs text-amber-500 transition-colors hover:bg-amber-900/20 hover:text-amber-400 disabled:opacity-50"
              >
                Pin
              </button>
            )}
            {isOwner && !isDeleted && (
              <>
                <Link
                  href={`/blog/${id}/edit`}
                  className="rounded px-3 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                >
                  Edit
                </Link>
                <button
                  onClick={handleHide}
                  disabled={actionLoading}
                  className="rounded px-3 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
                >
                  {isHidden ? "Unhide" : "Hide"}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={actionLoading}
                  className="rounded px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-900/20 hover:text-red-400 disabled:opacity-50"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </article>

      {/* Replies section */}
      {!isDeleted && (
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              Replies ({replies.length})
            </h2>
            {isOwner && (
              <button
                onClick={handleToggleReplies}
                disabled={actionLoading}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  post.replies_enabled
                    ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                    : "bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30"
                }`}
              >
                <span
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                    post.replies_enabled ? "bg-indigo-600" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
                      post.replies_enabled ? "translate-x-3.5" : "translate-x-1"
                    }`}
                  />
                </span>
                {post.replies_enabled ? "Replies on" : "Replies off"}
              </button>
            )}
          </div>

          {!post.replies_enabled ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-sm text-zinc-500">
              Replies are disabled for this post.
            </div>
          ) : (
            <>
              <div className="mb-6">
                <ReplyForm postId={post.id} onSubmitted={fetchData} />
              </div>

              <ReplyThread
                replies={replies}
                postId={post.id}
                postCreator={post.creator}
                onReplySubmitted={fetchData}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
