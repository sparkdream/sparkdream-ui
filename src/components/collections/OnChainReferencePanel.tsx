"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ContentNotice from "@/components/content/ContentNotice";
import { useCopy } from "@/hooks/useCopy";
import { useScannedBody, type ScannedBodyInput } from "@/hooks/useScannedBody";
import { getForumPost, getPost, getReply } from "@/lib/api";
import { PostStatus as BlogPostStatus, ReplyStatus as BlogReplyStatus } from "@/types/blog";
import type { OnChainReference } from "@/types/collect";
import { PostStatus as ForumPostStatus } from "@/types/forum";

// The on-chain reference of a collection item: what it points at, a link to
// it, and its text inline when this app knows how to read the target (forum
// posts and replies, blog posts and replies). x/collect accepts any module
// name, so an unknown target is shown as plain text with no link.
//
// The text goes through the scanner display policy (useScannedBody) like every
// other content body, and is rendered as plain text. Mounted only while the
// item is expanded, so a collection page never fetches bodies for closed rows.

type Withheld = "hidden" | "deleted";

interface Target {
  /** Where the content lives in this app. */
  href: string;
  /** Link text, e.g. "Open in Swarm". */
  linkLabel: string;
  /** "spark", "dream", "reply": the noun used in placeholders. */
  noun: string;
  /** Optional heading (blog post title). */
  title?: string;
  withheld?: Withheld;
  body: ScannedBodyInput;
}

type Resolved =
  | { state: "loading" }
  | { state: "unsupported" }
  | { state: "missing" }
  | { state: "ok"; target: Target };

const isId = (v: string) => /^\d+$/.test(v);

/** Longest line a text may have and still be shown unwrapped. */
const MAX_PREFORMATTED_LINE = 160;

function isSupported(ref: OnChainReference): boolean {
  if (!isId(ref.entity_id)) return false;
  if (ref.module === "forum") return ref.entity_type === "post" || ref.entity_type === "reply";
  if (ref.module === "blog") return ref.entity_type === "post" || ref.entity_type === "reply";
  return false;
}

async function resolve(ref: OnChainReference): Promise<Target> {
  const id = ref.entity_id;
  if (ref.module === "forum") {
    // Forum replies are posts with a parent; both live in the post store, and
    // the Swarm deep link takes the thread's root id.
    const { post } = await getForumPost(id);
    const root = Number(post.root_id) > 0 ? post.root_id : post.post_id;
    return {
      href: `/swarm?thread=${root}`,
      linkLabel: "Open in Swarm",
      noun: "spark",
      withheld:
        post.status === ForumPostStatus.HIDDEN ? "hidden" : post.status === ForumPostStatus.DELETED ? "deleted" : undefined,
      body: {
        kind: "forum-post",
        id: post.post_id,
        body: post.content,
        media_flags: post.media_flags,
        body_hash: post.body_hash,
        author: post.author,
      },
    };
  }
  if (ref.entity_type === "reply") {
    const { reply } = await getReply(id);
    return {
      href: `/imaginarium/${reply.post_id}`,
      linkLabel: "Open in Imaginarium",
      noun: "reply",
      withheld:
        reply.status === BlogReplyStatus.HIDDEN ? "hidden" : reply.status === BlogReplyStatus.DELETED ? "deleted" : undefined,
      body: {
        kind: "blog-reply",
        id: reply.id,
        body: reply.body,
        media_flags: reply.media_flags,
        body_hash: reply.body_hash,
        author: reply.creator,
      },
    };
  }
  const { post } = await getPost(id);
  return {
    href: `/imaginarium/${post.id}`,
    linkLabel: "Open in Imaginarium",
    noun: "dream",
    title: post.title,
    withheld:
      post.status === BlogPostStatus.HIDDEN ? "hidden" : post.status === BlogPostStatus.DELETED ? "deleted" : undefined,
    body: {
      kind: "blog-post",
      id: post.id,
      body: post.body,
      media_flags: post.media_flags,
      body_hash: post.body_hash,
      author: post.creator,
    },
  };
}

function ReferencedText({ target }: { target: Target }) {
  const scanned = useScannedBody(target.body);
  const { copied, copy } = useCopy();

  if (scanned.status !== "show") {
    return <ContentNotice status={scanned.status} reason={scanned.reason} noun={target.noun} className="mt-2" />;
  }
  if (!scanned.text) return null;
  // Text made of short lines (a hash manifest, a table, code) keeps its line
  // structure and scrolls sideways; prose with long lines wraps instead.
  const preformatted = scanned.text.split("\n").every((line) => line.length <= MAX_PREFORMATTED_LINE);
  return (
    <div className="mt-2">
      <pre className={`max-h-80 overflow-auto ${preformatted ? "whitespace-pre" : "whitespace-pre-wrap break-words"} rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs leading-relaxed text-zinc-300`}>
        {scanned.text}
      </pre>
      <button
        type="button"
        onClick={() => copy(scanned.text)}
        className="mt-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        {copied ? "Copied" : "Copy text"}
      </button>
    </div>
  );
}

export default function OnChainReferencePanel({ reference }: { reference: OnChainReference }) {
  const supported = isSupported(reference);
  const key = `${reference.module}|${reference.entity_type}|${reference.entity_id}`;
  const [result, setResult] = useState<{ key: string; resolved: Resolved }>({ key: "", resolved: { state: "loading" } });

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    resolve(reference)
      .then((target) => {
        if (!cancelled) setResult({ key, resolved: { state: "ok", target } });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, resolved: { state: "missing" } });
      });
    return () => {
      cancelled = true;
    };
    // key captures every field of the reference the fetch depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, supported]);

  const resolved: Resolved = !supported
    ? { state: "unsupported" }
    : result.key === key
      ? result.resolved
      : { state: "loading" };
  const target = resolved.state === "ok" ? resolved.target : null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs text-zinc-500">Onchain reference</span>
        <span className="font-mono text-xs text-zinc-300">
          {reference.module} / {reference.entity_type} #{reference.entity_id}
        </span>
        {target && (
          <Link href={target.href} className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline">
            {target.linkLabel}
          </Link>
        )}
      </div>
      {resolved.state === "loading" && <p className="mt-2 text-xs text-zinc-500">Loading.</p>}
      {resolved.state === "missing" && (
        <p className="mt-2 text-xs italic text-zinc-500">
          This content didn&apos;t load. It may have been removed from the chain since the item was added.
        </p>
      )}
      {target?.title && <p className="mt-2 text-sm font-medium text-zinc-200">{target.title}</p>}
      {target?.withheld === "hidden" && (
        <p className="mt-2 text-xs italic text-zinc-500">This {target.noun} was hidden by moderation.</p>
      )}
      {target?.withheld === "deleted" && (
        <p className="mt-2 text-xs italic text-zinc-500">This {target.noun} was deleted by its author.</p>
      )}
      {target && !target.withheld && <ReferencedText target={target} />}
    </div>
  );
}
