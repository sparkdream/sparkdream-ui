// Fetch a withheld body through its module's body query and check it against
// the hash it must have (docs/content-scanning.md §6 step 4). A body that does
// not match is never returned: callers treat that as unchecked.

import {
  getFederatedContentBody,
  getForumPostContent,
  getPostBody,
  getReplyBody,
} from "@/lib/api";
import { invalidate } from "@/lib/queryCache";
import { base64HashToHex, mediaFlags, sha256Hex } from "./protocol";

export type BodyKind = "blog-post" | "blog-reply" | "forum-post" | "federated";

export type BodyResult =
  | { ok: true; body: string }
  | { ok: false; reason: "mismatch" | "no-crypto" | "error" };

const CACHE_PREFIX: Record<BodyKind, string> = {
  "blog-post": "postBody|",
  "blog-reply": "replyBody|",
  "forum-post": "forumPostContent|",
  federated: "federatedContentBody|",
};

async function read(kind: BodyKind, id: string): Promise<string> {
  switch (kind) {
    case "blog-post":
      return (await getPostBody(id)).body ?? "";
    case "blog-reply":
      return (await getReplyBody(id)).body ?? "";
    case "forum-post":
      return (await getForumPostContent(id)).body ?? "";
    case "federated":
      return (await getFederatedContentBody(id)).body ?? "";
  }
}

/** The scanner record key for a body ("blog/post/12"), as workers sign it. */
export function recordKey(kind: BodyKind, id: string): string {
  switch (kind) {
    case "blog-post":
      return `blog/post/${id}`;
    case "blog-reply":
      return `blog/reply/${id}`;
    case "forum-post":
      return `forum/post/${id}`;
    case "federated":
      return `federation/content/${id}`;
  }
}

/**
 * Read the full body of one record and return it only if sha256(body) equals
 * `expectedHex`: the record's body_hash, or for federated content (which has
 * no body_hash) the hash the clean scanner quorum agreed on. A mismatch is
 * retried once past the cache, in case the record was edited since.
 */
export async function loadVerifiedBody(kind: BodyKind, id: string, expectedHex: string): Promise<BodyResult> {
  if (!expectedHex) return { ok: false, reason: "mismatch" };
  for (let attempt = 0; attempt < 2; attempt++) {
    let body: string;
    try {
      body = await read(kind, id);
    } catch {
      return { ok: false, reason: "error" };
    }
    const sum = await sha256Hex(body);
    if (sum === null) return { ok: false, reason: "no-crypto" };
    if (sum === expectedHex) return { ok: true, body };
    invalidate(`${CACHE_PREFIX[kind]}${id}|`);
  }
  return { ok: false, reason: "mismatch" };
}

/**
 * The body to resend in an update that only changes other fields (toggling
 * replies, federating): the record's own body when it is plain text, else the
 * verified stored body. An update sent with the withheld "" would erase it.
 * Throws if the stored body can't be loaded and verified.
 */
export async function bodyForUpdate(
  kind: BodyKind,
  id: string,
  record: { body?: string; content?: string; media_flags?: number | string; body_hash?: string }
): Promise<string> {
  if (!mediaFlags(record.media_flags)) return record.body ?? record.content ?? "";
  const res = await loadVerifiedBody(kind, id, base64HashToHex(record.body_hash));
  if (!res.ok) throw new Error("The stored text couldn't be loaded and verified, so nothing was changed.");
  return res.body;
}
