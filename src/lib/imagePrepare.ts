// Prepares an image for a permanent copy (x/storage): re-encodes it into the
// file profile (lib/fileProfile.ts) before its hash is computed, as the
// chain's spec asks of clients (docs/x-storage-spec.md §9). A file already
// inside the profile is used byte for byte, so its hash matches the copy the
// member may already host.
//
// encodeRgbPng and sha256Hex are pure and run under node's test runner;
// prepareImage needs a browser (canvas, createImageBitmap).

import { crc32, fileProfileProblem, stripJpegSegments } from "./fileProfile";

export type ProfileType = "image/png" | "image/jpeg";

export interface PreparedImage {
  bytes: Uint8Array;
  contentType: ProfileType;
  sha256: string;
  width: number;
  height: number;
  /** What was changed to fit the profile, for the member to read. Empty when the file was used as it is. */
  changes: string[];
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The profile type a file's first bytes announce, or null. */
export function sniffProfileType(data: Uint8Array): ProfileType | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) return "image/jpeg";
  return null;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" is the zlib container (RFC 1950), which is what IDAT holds.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

/**
 * Encodes RGBA pixels as an 8-bit truecolour PNG with no alpha channel and no
 * ancillary chunks: the alpha bytes are ignored, so flatten transparency
 * first. Each scanline takes the filter with the smallest absolute sum.
 */
export async function encodeRgbPng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const tries = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    for (let x = 0, s = y * width * 4; x < stride; x += 3, s += 4) {
      cur[x] = rgba[s];
      cur[x + 1] = rgba[s + 1];
      cur[x + 2] = rgba[s + 2];
    }
    const sums = [0, 0, 0, 0, 0];
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? cur[x - 3] : 0;
      const b = prev[x];
      const c = x >= 3 ? prev[x - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const v = cur[x];
      const f1 = (v - a) & 0xff;
      const f2 = (v - b) & 0xff;
      const f3 = (v - ((a + b) >> 1)) & 0xff;
      const f4 = (v - paeth) & 0xff;
      tries[0][x] = v;
      tries[1][x] = f1;
      tries[2][x] = f2;
      tries[3][x] = f3;
      tries[4][x] = f4;
      sums[0] += v < 128 ? v : 256 - v;
      sums[1] += f1 < 128 ? f1 : 256 - f1;
      sums[2] += f2 < 128 ? f2 : 256 - f2;
      sums[3] += f3 < 128 ? f3 : 256 - f3;
      sums[4] += f4 < 128 ? f4 : 256 - f4;
    }
    let best = 0;
    for (let k = 1; k < 5; k++) if (sums[k] < sums[best]) best = k;
    const at = y * (stride + 1);
    raw[at] = best;
    raw.set(tries[best], at + 1);
    prev.set(cur);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlibDeflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const TYPE_NAMES: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "image/avif": "AVIF",
  "image/bmp": "BMP",
  "image/svg+xml": "SVG",
};

export interface PrepareOptions {
  /** The type to produce. */
  target: ProfileType;
  /** JPEG quality, 0 to 1. */
  quality?: number;
  /** Longest side, in pixels, of the result. A larger image is scaled down. */
  maxSide?: number;
  /** Re-encode even a file that is already inside the profile (to make it smaller). */
  reencode?: boolean;
}

/**
 * Turns a picked file into one inside the profile of `target`. Used as it is
 * when it already fits; otherwise decoded by the browser and re-encoded with
 * transparency flattened onto white, in sRGB, without metadata. Throws with a
 * message for the member when the browser cannot read the image or the
 * result still does not fit.
 */
export async function prepareImage(file: Blob, opts: PrepareOptions): Promise<PreparedImage> {
  const original = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffProfileType(original);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image", colorSpaceConversion: "default" });
  } catch {
    throw new Error("This browser cannot read that file as an image");
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = opts.maxSide && longest > opts.maxSide ? opts.maxSide / longest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    if (!opts.reencode && scale === 1 && sniffed === opts.target && fileProfileProblem(sniffed, original) === null) {
      return { bytes: original, contentType: sniffed, sha256: await sha256Hex(original), width, height, changes: [] };
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!ctx) throw new Error("This browser cannot prepare an image this large");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    let pixels: ImageData;
    try {
      pixels = ctx.getImageData(0, 0, width, height);
    } catch {
      throw new Error("This browser cannot prepare an image this large");
    }
    // Flatten onto white by hand: the same arithmetic for both targets, and
    // no dependence on how a canvas composites.
    const px = pixels.data;
    let transparent = false;
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i];
      if (a === 255) continue;
      transparent = true;
      px[i - 3] = Math.round((px[i - 3] * a + 255 * (255 - a)) / 255);
      px[i - 2] = Math.round((px[i - 2] * a + 255 * (255 - a)) / 255);
      px[i - 1] = Math.round((px[i - 1] * a + 255 * (255 - a)) / 255);
      px[i] = 255;
    }

    let bytes: Uint8Array;
    if (opts.target === "image/png") {
      bytes = await encodeRgbPng(px, width, height);
    } else {
      ctx.putImageData(pixels, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", opts.quality ?? 0.92));
      if (!blob) throw new Error("This browser could not encode the image as JPEG");
      // Browsers write a plain JFIF header; anything else they add is dropped.
      bytes = stripJpegSegments(new Uint8Array(await blob.arrayBuffer()));
    }
    const problem = fileProfileProblem(opts.target, bytes);
    if (problem) throw new Error(`The prepared image is still outside the storage profile: ${problem}`);

    const from = TYPE_NAMES[file.type] || (sniffed ? TYPE_NAMES[sniffed] : "") || "the original";
    const to = TYPE_NAMES[opts.target];
    const changes = [from === to ? `Re-encoded as ${to}` : `Converted from ${from} to ${to}`];
    if (scale < 1) changes.push(`Made smaller: ${bitmap.width} x ${bitmap.height} to ${width} x ${height}`);
    changes.push("Metadata and colour profile removed; colours converted to sRGB");
    if (transparent) changes.push("Transparent areas filled with white");
    if (file.type === "image/gif" || file.type === "image/webp" || file.type === "image/apng" || sniffed === "image/png") {
      changes.push("If the image was animated, only its first frame is kept");
    }
    if (opts.target === "image/jpeg") changes.push("JPEG is lossy: fine detail may differ slightly from the original");
    return { bytes, contentType: opts.target, sha256: await sha256Hex(bytes), width, height, changes };
  } finally {
    bitmap.close();
  }
}

// Longest side and JPEG quality, tried in order until the result fits. The
// first steps keep the picture at its full size, for a limit that allows it.
const FIT_STEPS: [side: number, quality: number][] = [
  [Infinity, 0.92],
  [Infinity, 0.85],
  [4096, 0.85],
  [3072, 0.85],
  [2048, 0.9],
  [1600, 0.85],
  [1600, 0.75],
  [1280, 0.75],
  [1024, 0.72],
  [800, 0.68],
  [640, 0.62],
];

/**
 * A file inside the storage profile that is also no larger than `maxBytes`
 * and `maxSide` (Infinity for no limit on its sides), for a site that stores
 * what it is given. A PNG stays a PNG
 * when it fits (drawings and screenshots lose nothing); otherwise the image
 * becomes a JPEG, made smaller in steps. `types` lists the content types the
 * storage network keeps. Throws with a message for the member.
 */
export async function fitImage(
  file: Blob,
  limits: { maxBytes: number; maxSide: number; types: ProfileType[] }
): Promise<PreparedImage> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (limits.types.includes("image/png") && sniffProfileType(head) === "image/png") {
    const png = await prepareImage(file, { target: "image/png", maxSide: limits.maxSide });
    if (png.bytes.length <= limits.maxBytes) return png;
  }
  if (!limits.types.includes("image/jpeg")) {
    throw new Error("The picture is too large to store here as a PNG, and JPEG copies are not kept.");
  }
  // A JPEG already inside the profile is used byte for byte when it fits.
  // When it doesn't, every step re-encodes it, so the quality steps apply
  // to it as they do to any other picture.
  let reencode = false;
  const tried = new Set<string>();
  for (const [side, quality] of FIT_STEPS) {
    // Steps above the limit all come down to the limit: each is tried once.
    const maxSide = Math.min(side, limits.maxSide);
    if (tried.has(`${maxSide}|${quality}`)) continue;
    tried.add(`${maxSide}|${quality}`);
    const opts: PrepareOptions = { target: "image/jpeg", quality, maxSide };
    let jpeg = await prepareImage(file, { ...opts, reencode });
    if (jpeg.bytes.length > limits.maxBytes && jpeg.changes.length === 0) {
      reencode = true;
      jpeg = await prepareImage(file, { ...opts, reencode });
    }
    if (jpeg.bytes.length <= limits.maxBytes) return jpeg;
  }
  throw new Error("The picture couldn't be made small enough to store here.");
}
