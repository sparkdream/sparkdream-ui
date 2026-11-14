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
  const type = imageBlobType(res.headers.get("content-type") || "", bytes);
  if (!type) return { ok: false, reason: "error" };
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  loaded.set(key, url);
  return { ok: true, url };
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
