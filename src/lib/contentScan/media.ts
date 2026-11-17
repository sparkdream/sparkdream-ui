// Loading an external image only after it has cleared, and only as the bytes
// the scanners checked (docs/content-scanning.md §6 step 4, §12 "host serves
// scanners and readers different files"). The image is fetched as bytes,
// hashed, and shown from a blob URL only if the hash matches the clean
// verdict. A host that blocks cross-origin reads can't be checked this way,
// so its image does not load: the safe failure.

import { loadUploadPolicy } from "@/lib/imageUpload/client";
import { DEFAULT_ARWEAVE_GATEWAY } from "@/lib/storageRules";
import { sha256Hex } from "./protocol";

export type ImageLoad =
  | { ok: true; url: string }
  | { ok: false; reason: "unsupported" | "blocked" | "timeout" | "mismatch" | "no-crypto" | "error" };

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// For the whole download, headers and body. Gateways for content-addressed
// storage can take a while to start sending a file they haven't served lately.
const LOAD_TIMEOUT_MS = 60_000;

function timedOut(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
}
const loaded = new Map<string, string>();

export function isFetchableUri(uri: string): boolean {
  return /^https:\/\//i.test(uri) || /^http:\/\//i.test(uri) || arweaveId(uri) !== null;
}

/** The Arweave id of an ar:// address, or null. */
export function arweaveId(uri: string): string | null {
  return /^ar:\/\/([A-Za-z0-9_-]{43})$/i.exec(uri)?.[1] ?? null;
}

/** The gateway Arweave data is read through (the site's ARWEAVE_GATEWAY, from its upload policy). */
export async function arweaveGateway(): Promise<string> {
  const g = (await loadUploadPolicy()).arweave_gateway;
  return g && g.includes("{id}") ? g : DEFAULT_ARWEAVE_GATEWAY;
}

/** Where to fetch a URI from: itself, or a gateway for ar://. */
export async function fetchTarget(uri: string): Promise<string> {
  const id = arweaveId(uri);
  return id ? (await arweaveGateway()).replace("{id}", id) : uri;
}

type Fetched = { ok: true; url: string } | { ok: false; reason: Exclude<ImageLoad, { ok: true }>["reason"] };

/** Fetch `target` and make a blob URL of it, only if its bytes hash to `sha256`. */
async function fetchVerified(target: string, sha256: string): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetch(target, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
    });
  } catch (err) {
    // CORS refusal and network failure look the same from here.
    return { ok: false, reason: timedOut(err) ? "timeout" : "blocked" };
  }
  if (!res.ok) return { ok: false, reason: "error" };
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) return { ok: false, reason: "error" };
  // The body arrives after fetch() resolves, so the timeout or a dropped
  // connection surfaces here. It must become a result: a rejection would
  // leave the caller showing "loading" for ever.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return { ok: false, reason: timedOut(err) ? "timeout" : "error" };
  }
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "error" };
  const sum = await sha256Hex(bytes);
  if (sum === null) return { ok: false, reason: "no-crypto" };
  if (sum !== sha256) return { ok: false, reason: "mismatch" };
  const type = imageBlobType(res.headers.get("content-type") || "", bytes);
  if (!type) return { ok: false, reason: "error" };
  return { ok: true, url: URL.createObjectURL(new Blob([bytes], { type })) };
}

/**
 * Where the permanent copy of the file with this hash is, if the chain
 * records one (x/storage): a request that is completed or settled names the
 * copy. The copy is looked up by the hash, so it can only ever be the same
 * picture, whoever asked for it and whichever site first stored the image.
 */
function permanentCopyTarget(sha256: string): Promise<string | null> {
  const now = Date.now();
  const hit = copyTargets.get(sha256);
  if (hit && now - hit.at < COPY_LOOKUP_TTL_MS) return hit.target;
  // The answer is kept for a while whatever it is, "no copy" included: a
  // page of images that don't load must not ask the chain again for each
  // retry or remount, and concurrent loads of one file share one lookup.
  const target = lookUpCopyTarget(sha256);
  copyTargets.set(sha256, { at: now, target });
  if (copyTargets.size > 2000) copyTargets.delete(copyTargets.keys().next().value as string);
  return target;
}

const COPY_LOOKUP_TTL_MS = 5 * 60 * 1000;
const copyTargets = new Map<string, { at: number; target: Promise<string | null> }>();
// The backend list, failures included (a chain without x/storage answers
// 501 every time), so it is read once per span and not once per image.
let copyBackends: { at: number; list: Promise<{ name: string; locator_format?: string }[]> } | null = null;

async function lookUpCopyTarget(sha256: string): Promise<string | null> {
  try {
    const [{ listStorageBackends, getStorageRequestByHash }, { locatorTarget }] = await Promise.all([
      import("@/lib/storageApi"),
      import("@/lib/storageRules"),
    ]);
    const now = Date.now();
    if (!copyBackends || now - copyBackends.at >= COPY_LOOKUP_TTL_MS) {
      copyBackends = { at: now, list: listStorageBackends().catch(() => []) };
    }
    for (const backend of await copyBackends.list) {
      const r = (await getStorageRequestByHash(backend.name, sha256))?.request;
      const target = r?.locator ? locatorTarget(backend.locator_format, r.locator, await arweaveGateway()) : null;
      if (target) return target;
    }
  } catch {
    // The chain didn't answer: no copy to try now, and nothing to remember.
    copyTargets.delete(sha256);
  }
  return null;
}

/**
 * `fallback: false` skips the permanent-copy lookup, for a caller that
 * already tries the copy itself.
 */
export async function loadVerifiedImage(uri: string, sha256: string, opts: { fallback?: boolean } = {}): Promise<ImageLoad> {
  const key = `${uri}|${sha256}`;
  const hit = loaded.get(key);
  if (hit) return { ok: true, url: hit };
  if (!isFetchableUri(uri)) return { ok: false, reason: "unsupported" };
  let got = await fetchVerified(await fetchTarget(uri), sha256);
  if (!got.ok && got.reason !== "no-crypto" && opts.fallback !== false) {
    // An image that no longer loads from where it is hosted (or was replaced
    // there) is read from its permanent copy, if it has one.
    const copy = await permanentCopyTarget(sha256);
    if (copy) {
      const fromCopy = await fetchVerified(copy, sha256);
      if (fromCopy.ok) got = fromCopy;
    }
  }
  if (got.ok) loaded.set(key, got.url);
  return got;
}

/**
 * The type to give a fetched image's blob URL, or null if it must not load.
 * Only image types become a blob URL. Storage buckets often serve every file
 * as application/octet-stream, so a response without an image type is
 * identified by its (already verified) bytes, the way scanners classify what
 * they fetch.
 *
 * SVG never loads. Scanners refuse to judge it (docs/content-scanning.md
 * §5.2): it is drawing instructions, and a scanner can't be sure of drawing
 * what this browser would. A host can only make bytes render as SVG by
 * declaring the type, so refusing the declared type is enough.
 */
export function imageBlobType(declaredType: string, bytes: Uint8Array): string | null {
  const declared = declaredType.split(";")[0].trim().toLowerCase();
  if (declared === "image/svg+xml") return null;
  return declared.startsWith("image/") ? declared : sniffImageType(bytes);
}

/**
 * The raster image type a file's leading bytes identify (the MIME sniffing
 * standard's image patterns, plus AVIF), or null. Never SVG: that is text,
 * and imageBlobType refuses it.
 */
export function sniffImageType(b: Uint8Array): string | null {
  const at = (offset: number, sig: string) =>
    b.length >= offset + sig.length && [...sig].every((ch, i) => b[offset + i] === ch.charCodeAt(0));
  if (at(0, "\x89PNG\r\n\x1a\n")) return "image/png";
  if (at(0, "\xff\xd8\xff")) return "image/jpeg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
  if (at(0, "BM")) return "image/bmp";
  if (at(0, "RIFF") && at(8, "WEBPVP")) return "image/webp";
  if (at(4, "ftypavif") || at(4, "ftypavis")) return "image/avif";
  return null;
}
