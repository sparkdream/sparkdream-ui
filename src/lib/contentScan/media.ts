// Loading an external image only after it has cleared, and only as the bytes
// the scanners checked (docs/content-scanning.md §6 step 4, §12 "host serves
// scanners and readers different files"). The image is fetched as bytes,
// hashed, and shown from a blob URL only if the hash matches the clean
// verdict. A host that blocks cross-origin reads can't be checked this way,
// so its image does not load: the safe failure.

import { sha256Hex } from "./protocol";

export type ImageLoad =
  | { ok: true; url: string }
  | { ok: false; reason: "unsupported" | "blocked" | "mismatch" | "no-crypto" | "error" };

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const loaded = new Map<string, string>();

export function isFetchableUri(uri: string): boolean {
  return /^https:\/\//i.test(uri) || /^http:\/\//i.test(uri);
}

export async function loadVerifiedImage(uri: string, sha256: string): Promise<ImageLoad> {
  const key = `${uri}|${sha256}`;
  const hit = loaded.get(key);
  if (hit) return { ok: true, url: hit };
  if (!isFetchableUri(uri)) return { ok: false, reason: "unsupported" };
  let res: Response;
  try {
    res = await fetch(uri, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // CORS refusal and network failure look the same from here.
    return { ok: false, reason: "blocked" };
  }
  if (!res.ok) return { ok: false, reason: "error" };
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) return { ok: false, reason: "error" };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "error" };
  const sum = await sha256Hex(bytes);
  if (sum === null) return { ok: false, reason: "no-crypto" };
  if (sum !== sha256) return { ok: false, reason: "mismatch" };
  const type = res.headers.get("content-type") || "";
  // Only image types become a blob URL (an <img> never runs script, SVG included).
  if (!/^image\//i.test(type)) return { ok: false, reason: "error" };
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  loaded.set(key, url);
  return { ok: true, url };
}
