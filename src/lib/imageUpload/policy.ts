// Member image uploads: what both the browser and the server go by.
//
// A member may attach an image to a dream by uploading it instead of linking
// to one hosted elsewhere. The browser shrinks it first; the server accepts
// it only from an active member, within their weekly allowance, inside the
// limits below, and only after a content scanner has called the exact bytes
// clean (docs/content-scanning.md §5.2). Storage is content-addressed, so
// the same image is stored once however often it is uploaded.

import { fileProfileProblem } from "@/lib/fileProfile";
import { TrustLevel } from "@/types/rep";

/** Largest stored image, unless IMAGE_UPLOAD_MAX_BYTES says otherwise. */
export const DEFAULT_MAX_BYTES = 300_000;
/**
 * Largest file kept for a permanent copy to be made from, unless
 * IMAGE_COPY_MAX_BYTES says otherwise: the scanner's default pre-check limit.
 */
export const DEFAULT_COPY_MAX_BYTES = 4 * 1024 * 1024;
/** Longest side, in pixels, of a stored image. */
export const MAX_SIDE = 2048;
/** How long a signed upload authorisation may last. */
export const AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** New images a member may store per week, by trust level. */
export const WEEKLY_QUOTA: Record<string, number> = {
  [TrustLevel.NEW]: 3,
  [TrustLevel.PROVISIONAL]: 5,
  [TrustLevel.ESTABLISHED]: 10,
  [TrustLevel.TRUSTED]: 20,
  [TrustLevel.CORE]: 40,
};

export function weeklyQuota(trustLevel: string | undefined): number {
  return WEEKLY_QUOTA[trustLevel || ""] ?? 0;
}

/** Quota weeks are fixed seven-day spans of UTC time. */
export function quotaWeek(now: Date): number {
  return Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
}

// ---- The signed authorisation ---------------------------------------------------

export interface UploadAuth {
  chainId: string;
  /** The member the images are uploaded for. */
  address: string;
  /**
   * Set when a session key signs for the member instead of the member's own
   * wallet: the key's address. The server then checks onchain that the member
   * gave this key a session that may publish dreams (sessionAllowsUpload).
   */
  sessionKey?: string;
  /** ISO time after which the authorisation is no longer accepted. */
  expires: string;
}

const AUTH_HEADING = "Spark Dream image upload";

/**
 * The text a member signs with their wallet (ADR-036) to upload images. It
 * says what it is for in plain words, since the wallet shows it, and it is
 * bound to one chain, one address and an expiry, so it can't be replayed
 * elsewhere or for long. Signing it moves no funds and sends no transaction.
 */
export function uploadAuthMessage(a: UploadAuth): string {
  return [
    AUTH_HEADING,
    "",
    "Signing this lets this browser upload images for your dreams until the time below.",
    "It does not send a transaction or move any funds.",
    "",
    `Chain: ${a.chainId}`,
    `Address: ${a.address}`,
    ...(a.sessionKey ? [`Session key: ${a.sessionKey}`] : []),
    `Expires: ${a.expires}`,
  ].join("\n");
}

/** Parse a message built by uploadAuthMessage; null if it is anything else. */
export function parseUploadAuthMessage(message: string): UploadAuth | null {
  const lines = message.split("\n");
  if (lines[0] !== AUTH_HEADING) return null;
  const field = (name: string) => {
    const hits = lines.filter((l) => l.startsWith(`${name}: `));
    return hits.length === 1 ? hits[0].slice(name.length + 2) : null;
  };
  const chainId = field("Chain");
  const address = field("Address");
  const expires = field("Expires");
  if (!chainId || !address || !expires) return null;
  const parsed: UploadAuth = { chainId, address, expires };
  // Optional, but never repeated and never the member's own address.
  if (lines.some((l) => l.startsWith("Session key: "))) {
    const sessionKey = field("Session key");
    if (!sessionKey || sessionKey === address) return null;
    parsed.sessionKey = sessionKey;
  }
  // Only the exact text this app would have produced is accepted.
  return uploadAuthMessage(parsed) === message ? parsed : null;
}

/**
 * The messages that publish or edit a dream. A session key that holds one of
 * them may upload a dream's images for the member who granted it: it can
 * already publish as them, and an upload sends nothing onchain and moves no
 * funds. It counts against the member's own weekly allowance.
 */
export const UPLOAD_SESSION_MSG_TYPES = ["/sparkdream.blog.v1.MsgCreatePost", "/sparkdream.blog.v1.MsgUpdatePost"];

export function sessionAllowsUpload(allowedMsgTypes: readonly string[] | undefined): boolean {
  return !!allowedMsgTypes?.some((t) => UPLOAD_SESSION_MSG_TYPES.includes(t));
}

// ---- What kind of image the bytes are -------------------------------------------

export interface ImageInfo {
  type: "image/webp" | "image/jpeg" | "image/png";
  ext: "webp" | "jpg" | "png";
  width: number;
  height: number;
  animated: boolean;
}

/**
 * Read an image's type and size from its header, without decoding it. Only
 * the three formats an upload may be stored as are recognised; anything else,
 * or a header that doesn't parse, is null.
 */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  const ascii = (off: number, s: string) =>
    b.length >= off + s.length && [...s].every((ch, i) => b[off + i] === ch.charCodeAt(0));
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u16le = (o: number) => b[o] | (b[o + 1] << 8);
  const u24le = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const u32be = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const u32le = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const sized = (info: ImageInfo) => (info.width > 0 && info.height > 0 ? info : null);

  if (ascii(0, "\x89PNG\r\n\x1a\n")) {
    if (b.length < 33 || !ascii(12, "IHDR")) return null;
    // An acTL chunk before the image data marks an animated PNG.
    let animated = false;
    for (let o = 8; o + 12 <= b.length; ) {
      const len = u32be(o);
      if (ascii(o + 4, "acTL")) animated = true;
      if (ascii(o + 4, "IDAT") || ascii(o + 4, "IEND")) break;
      o += 12 + len;
    }
    return sized({ type: "image/png", ext: "png", width: u32be(16), height: u32be(20), animated });
  }

  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the frame header (SOF0-15, less DHT, JPG and DAC).
    for (let o = 2; o + 9 <= b.length; ) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      if (marker === 0xff) {
        o += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        o += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return sized({ type: "image/jpeg", ext: "jpg", width: u16be(o + 7), height: u16be(o + 5), animated: false });
      }
      if (marker === 0xda || marker === 0xd9) return null;
      o += 2 + u16be(o + 2);
    }
    return null;
  }

  if (ascii(0, "RIFF") && ascii(8, "WEBP") && b.length >= 30) {
    const webp = (width: number, height: number, animated: boolean) =>
      sized({ type: "image/webp", ext: "webp", width, height, animated });
    if (ascii(12, "VP8X")) return webp(u24le(24) + 1, u24le(27) + 1, (b[20] & 0x02) !== 0);
    if (ascii(12, "VP8 ")) {
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return webp(u16le(26) & 0x3fff, u16le(28) & 0x3fff, false);
    }
    if (ascii(12, "VP8L")) {
      if (b[20] !== 0x2f) return null;
      const bits = u32le(21);
      return webp((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, false);
    }
  }
  return null;
}

/** Why an image can't be stored, or null if it can. */
export function uploadProblem(b: Uint8Array, maxBytes: number): string | null {
  if (b.length === 0) return "The file is empty.";
  if (b.length > maxBytes) return `The image is larger than ${Math.round(maxBytes / 1000)} kB.`;
  const info = imageInfo(b);
  if (!info) return "Only WebP, JPEG and PNG images can be uploaded.";
  if (info.animated) return "Animated images can't be uploaded.";
  if (info.width > MAX_SIDE || info.height > MAX_SIDE) return `The image is larger than ${MAX_SIDE} pixels on a side.`;
  return null;
}

/**
 * Why a file can't be kept as the source of a permanent copy, or null if it
 * can. Unlike a dream's image it keeps its full size in pixels: it only has
 * to be a PNG or JPEG inside the chain's storage profile (lib/fileProfile.ts),
 * which is what an operator will accept.
 */
export function copySourceProblem(b: Uint8Array, maxBytes: number): string | null {
  if (b.length === 0) return "The file is empty.";
  if (b.length > maxBytes) return `The file is larger than ${(maxBytes / (1024 * 1024)).toFixed(1)} MiB.`;
  const info = imageInfo(b);
  if (!info || info.type === "image/webp") return "A permanent copy is made from a PNG or JPEG.";
  const outside = fileProfileProblem(info.type, b);
  return outside ? `The file is outside the storage profile: ${outside}.` : null;
}
