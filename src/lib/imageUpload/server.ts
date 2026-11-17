// Server side of member image uploads (see policy.ts). Everything here runs
// in the Next server only: it holds the storage keys and the scanner token.

import { createHash, createHmac } from "node:crypto";
import { getRepMember } from "@/lib/api";
import { defaults } from "@/lib/chain";
import { MemberStatus } from "@/types/rep";
import { verifyUploadAuth, type SignedUploadAuth } from "./auth";
import {
  DEFAULT_COPY_MAX_BYTES,
  DEFAULT_MAX_BYTES,
  MAX_SIDE,
  copySourceProblem,
  imageInfo,
  quotaWeek,
  uploadProblem,
  weeklyQuota,
} from "./policy";
import { DEFAULT_ARWEAVE_GATEWAY } from "@/lib/storageRules";
import { deleteObject, listKeys, objectExists, putObject, type S3Config } from "./s3";

export interface UploadConfig {
  s3: S3Config;
  /** Public URL prefix of the bucket; an image is served at <base>/<key>. */
  publicBase: string;
  precheckUrl: string;
  precheckToken: string;
  maxBytes: number;
  /** Largest full-size file kept for a permanent copy to be made from. */
  copyMaxBytes: number;
  chainId: string;
  bech32Prefix: string;
  /** Where ar:// addresses are read from, with {id} for the Arweave id. */
  arweaveGateway: string;
}

/** ARWEAVE_GATEWAY, if it is an https URL template holding {id}. */
export function arweaveGateway(env: NodeJS.ProcessEnv = process.env): string {
  const g = env.ARWEAVE_GATEWAY || "";
  return /^https:\/\/\S+$/.test(g) && g.includes("{id}") ? g : DEFAULT_ARWEAVE_GATEWAY;
}

function s3Config(env: NodeJS.ProcessEnv): S3Config | null {
  const s3: S3Config = {
    endpoint: env.IMAGE_S3_ENDPOINT || env.S3_ENDPOINT || "",
    region: env.IMAGE_S3_REGION || env.S3_REGION || "us-west-2",
    bucket: env.IMAGE_S3_BUCKET || "",
    accessKey: env.IMAGE_S3_ACCESS_KEY || env.S3_ACCESS_KEY || "",
    secretKey: env.IMAGE_S3_SECRET_KEY || env.S3_SECRET_KEY || "",
  };
  return s3.endpoint && s3.bucket && s3.accessKey && s3.secretKey ? s3 : null;
}

/**
 * The upload settings, or null when uploads are off. They are off unless the
 * image bucket, its public address and a scanner pre-check are all set: an
 * image is never stored on the strength of the upload alone. The bucket is
 * named separately from the snapshot archive's (S3_BUCKET) on purpose, so
 * member images never land in the archive; only the endpoint, region and
 * keys fall back to the archive's.
 */
export function uploadConfig(env: NodeJS.ProcessEnv = process.env): UploadConfig | null {
  const s3 = s3Config(env);
  const publicBase = (env.IMAGE_PUBLIC_BASE || "").replace(/\/+$/, "");
  const precheckUrl = env.IMAGE_PRECHECK_URL || "";
  const precheckToken = env.IMAGE_PRECHECK_TOKEN || "";
  if (!s3) return null;
  if (!/^https:\/\//i.test(publicBase) || !/^https?:\/\//i.test(precheckUrl) || !precheckToken) return null;
  const maxBytes = parseInt(env.IMAGE_UPLOAD_MAX_BYTES || "", 10);
  const copyMaxBytes = parseInt(env.IMAGE_COPY_MAX_BYTES || "", 10);
  const bech32Prefix = env.BECH32_PREFIX || env.NEXT_PUBLIC_BECH32_PREFIX || defaults.bech32Prefix;
  return {
    s3,
    publicBase,
    precheckUrl,
    precheckToken,
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES,
    copyMaxBytes: Number.isFinite(copyMaxBytes) && copyMaxBytes > 0 ? copyMaxBytes : DEFAULT_COPY_MAX_BYTES,
    chainId: env.CHAIN_ID || env.NEXT_PUBLIC_CHAIN_ID || defaults.chainId,
    bech32Prefix,
    arweaveGateway: arweaveGateway(env),
  };
}

/**
 * Whether this site offers permanent copies (x/storage requests). The
 * operator can switch them off with ARWEAVE_UPLOADS_DISABLED, read on every
 * request, so it takes effect without a rebuild. Ordinary uploads, copies
 * already requested and reading existing copies are unaffected.
 */
export function permanentCopiesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(1|true|yes|on)$/i.test((env.ARWEAVE_UPLOADS_DISABLED || "").trim());
}

/** What a browser needs to know before offering an upload. */
export function publicPolicy(cfg: UploadConfig | null, env: NodeJS.ProcessEnv = process.env) {
  return {
    enabled: !!cfg,
    max_bytes: cfg?.maxBytes ?? 0,
    max_side: cfg ? MAX_SIDE : 0,
    // The full-size file a permanent copy is made from has its own limit.
    copy_max_bytes: cfg && permanentCopiesOn(env) ? cfg.copyMaxBytes : 0,
    // Readers need the gateway to show ar:// images and permanent copies
    // whether or not this site takes uploads.
    arweave_gateway: cfg?.arweaveGateway ?? arweaveGateway(env),
    permanent_copies: permanentCopiesOn(env),
    // The browser writes its authorisation's expiry by this clock, not its own.
    server_time: Date.now(),
  };
}

/** A verified member, for the routes that act for one. */
export async function activeMember(
  cfg: UploadConfig,
  auth: SignedUploadAuth,
  now: Date
): Promise<{ ok: true; address: string; trustLevel: string } | { ok: false; status: number; message: string }> {
  const who = await verifyUploadAuth(auth, { chainId: cfg.chainId, bech32Prefix: cfg.bech32Prefix, now });
  if (!who.ok) return { ok: false, status: 401, message: UNSIGNED };
  return activeMemberAt(who.address);
}

const UNSIGNED = "Your upload permission is missing or has expired. Try again to sign a new one.";

/** The active member at an address whose signature has already been checked. */
async function activeMemberAt(
  address: string
): Promise<{ ok: true; address: string; trustLevel: string } | { ok: false; status: number; message: string }> {
  let member;
  try {
    member = (await getRepMember(address)).member;
  } catch {
    member = null;
  }
  if (!member?.address || member.status !== MemberStatus.ACTIVE) {
    return { ok: false, status: 403, message: "Uploading images is for active members." };
  }
  return { ok: true, address, trustLevel: member.trust_level };
}

export type UploadOutcome =
  | { ok: true; url: string; sha256: string; used: number; quota: number }
  | { ok: false; status: number; message: string };

const refuse = (status: number, message: string): UploadOutcome => ({ ok: false, status, message });

// ---- Attempt limiter ------------------------------------------------------------
//
// The weekly allowance counts stored images. A scanner pre-check costs seconds
// of CPU whether or not the image is kept, so attempts are limited too, per
// member and in memory (a restart forgetting them is harmless). Each server
// process counts on its own, so several instances allow that many times the
// attempts; the weekly allowance below holds across all of them.

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPTS_PER_WINDOW = 12;
const attempts = new Map<string, number[]>();

function tooManyAttempts(address: string, now: number): boolean {
  const recent = (attempts.get(address) || []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  if (recent.length >= ATTEMPTS_PER_WINDOW) {
    attempts.set(address, recent);
    return true;
  }
  recent.push(now);
  // Re-inserted so the map stays in order of last use: when it is full, the
  // member dropped is the one idle longest, never one in the middle of a burst.
  attempts.delete(address);
  attempts.set(address, recent);
  if (attempts.size > 5000) attempts.delete(attempts.keys().next().value as string);
  return false;
}

// ---- Storage layout -------------------------------------------------------------
//
//   img/<sha256>.<ext>                      the image, public, content-addressed
//   quota/<week>/<member tag>/<sha256>      empty marker: this member stored
//                                           this image in this week
//   src/<sha256>.<ext>                      the full-size file a permanent copy
//                                           is made from, kept until the request
//                                           for it closes (scripts/images-gc.mts)
//   srcquota/<week>/<member tag>/<sha256>   its marker, counted on its own
//
// The image's address says nothing about who uploaded it, so an image in an
// anonymous dream doesn't name its author. The member tag is a keyed hash of
// the address for the same reason: markers can't be read back into addresses
// without the storage secret.

export function imageKey(sha256: string, ext: string): string {
  return `img/${sha256}.${ext}`;
}

export function sourceKey(sha256: string, ext: string): string {
  return `src/${sha256}.${ext}`;
}

/** What an upload is: a dream's image, or the full-size source of a permanent copy. */
export type UploadKind = "image" | "copy";

export function memberTag(cfg: UploadConfig, address: string): string {
  return createHmac("sha256", `image-quota|${cfg.s3.secretKey}`).update(address).digest("hex").slice(0, 32);
}

function quotaPrefix(cfg: UploadConfig, address: string, now: Date, kind: UploadKind): string {
  return `${kind === "copy" ? "srcquota" : "quota"}/${quotaWeek(now)}/${memberTag(cfg, address)}/`;
}

// ---- The scanner pre-check ------------------------------------------------------

async function precheck(cfg: UploadConfig, bytes: Uint8Array, sha256: string): Promise<UploadOutcome | null> {
  let res: Response;
  try {
    res = await fetch(cfg.precheckUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.precheckToken}`, "content-type": "application/octet-stream" },
      body: Buffer.from(bytes),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return refuse(503, "The content scanner didn't answer, so the image wasn't uploaded. Try again in a minute.");
  }
  let body: { verdict?: string; sha256?: string; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Not JSON: handled as a failed check below.
  }
  if (res.status === 503) {
    return refuse(503, "The content scanner is busy, so the image wasn't uploaded. Try again in a minute.");
  }
  if (res.status === 422) return refuse(422, "The content scanner can't check this kind of image, so it can't be uploaded.");
  if (!res.ok || body.sha256 !== sha256) {
    return refuse(502, "The content scanner couldn't check the image, so it wasn't uploaded. Try again later.");
  }
  if (body.verdict !== "clean") {
    return refuse(422, "The content scanner didn't clear this image, so it can't be uploaded.");
  }
  return null;
}

// ---- The upload -----------------------------------------------------------------

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Accept one image: signed by an active member, inside the limits and their
 * weekly allowance, and cleared by the scanner before it is stored.
 */
export async function acceptUpload(
  cfg: UploadConfig,
  auth: SignedUploadAuth,
  bytes: Uint8Array,
  now: Date = new Date(),
  kind: UploadKind = "image"
): Promise<UploadOutcome> {
  // Checked before the member lookup so a bad signature costs no chain read.
  const signed = await verifyUploadAuth(auth, { chainId: cfg.chainId, bech32Prefix: cfg.bech32Prefix, now });
  if (!signed.ok) return refuse(401, UNSIGNED);

  if (kind === "copy" && !permanentCopiesOn()) return refuse(403, "Permanent copies are switched off on this site.");
  const problem = kind === "copy" ? copySourceProblem(bytes, cfg.copyMaxBytes) : uploadProblem(bytes, cfg.maxBytes);
  if (problem) return refuse(400, problem);
  const info = imageInfo(bytes)!;

  const who = await activeMemberAt(signed.address);
  if (!who.ok) return refuse(who.status, who.message);
  const quota = weeklyQuota(who.trustLevel);
  if (quota <= 0) return refuse(403, "Your trust level doesn't include image uploads.");
  if (tooManyAttempts(who.address, now.getTime())) {
    return refuse(429, "Too many uploads in a short time. Try again in a few minutes.");
  }

  const sha256 = sha256Hex(bytes);
  // One member's uploads are taken one at a time in this process, so a burst
  // of them is counted in turn. Across processes the marker written before
  // the recount below keeps the allowance.
  return inTurn(who.address, () => storeCounted(cfg, who.address, quota, bytes, sha256, info, now, kind));
}

const turns = new Map<string, Promise<unknown>>();

function inTurn<T>(address: string, run: () => Promise<T>): Promise<T> {
  const next = (turns.get(address) ?? Promise.resolve()).then(run, run);
  const settled = next.catch(() => undefined);
  turns.set(address, settled);
  void settled.then(() => {
    if (turns.get(address) === settled) turns.delete(address);
  });
  return next;
}

async function storeCounted(
  cfg: UploadConfig,
  address: string,
  quota: number,
  bytes: Uint8Array,
  sha256: string,
  info: { ext: string; type: string },
  now: Date,
  kind: UploadKind
): Promise<UploadOutcome> {
  const key = kind === "copy" ? sourceKey(sha256, info.ext) : imageKey(sha256, info.ext);
  const url = `${cfg.publicBase}/${key}`;
  const prefix = quotaPrefix(cfg, address, now, kind);
  const marker = `${prefix}${sha256}`;
  const unanswered = refuse(502, "Image storage didn't answer, so the image wasn't uploaded. Try again later.");
  const full = refuse(
    429,
    kind === "copy"
      ? `You've used your ${quota} permanent-copy uploads for this week.`
      : `You've used your ${quota} image uploads for this week.`
  );

  let mine: string[];
  let stored: boolean;
  try {
    [mine, stored] = await Promise.all([listKeys(cfg.s3, prefix), objectExists(cfg.s3, key)]);
  } catch {
    return unanswered;
  }
  const counted = mine.includes(marker);
  if (!counted && mine.length >= quota) return full;

  // The place in the allowance is taken before anything else, then counted
  // again: of uploads racing each other, whichever counts last sees them
  // all, so together they can never store more than the allowance. One that
  // finds itself over gives its place back.
  const release = () => deleteObject(cfg.s3, marker).catch(() => undefined);
  let used = mine.length;
  if (!counted) {
    try {
      await putObject(cfg.s3, marker, new Uint8Array(), "application/octet-stream");
      used = (await listKeys(cfg.s3, prefix)).length;
    } catch {
      await release();
      return unanswered;
    }
    if (used > quota) {
      await release();
      return full;
    }
  }

  // Bytes already in the bucket were cleared when they were first stored.
  if (!stored) {
    const refused = await precheck(cfg, bytes, sha256);
    if (refused) {
      if (!counted) await release();
      return refused;
    }
    try {
      await putObject(cfg.s3, key, bytes, info.type);
    } catch {
      if (!counted) await release();
      return refuse(502, "Image storage refused the file. Try again later.");
    }
  }
  return { ok: true, url, sha256, used, quota };
}
