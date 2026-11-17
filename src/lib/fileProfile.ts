// The x/storage file profile: which files the chain's operators keep a
// permanent copy of. A port of tools/fileprofile/fileprofile.go in the chain
// repo (docs/x-storage-spec.md, "The file profile"), tested against the same
// vectors (fileProfile.test.ts). Scanners and storage operators judge a file
// with the Go rule, so this must refuse whatever it refuses: a file this port
// accepted and an operator declines as a mismatch closes the request.
//
// The profile is narrow on purpose: one still image, no metadata, no colour
// management, no transparency. Everything here is pure (no DOM), so it runs
// in the browser and under node's test runner alike.

/** What a PNG may inflate to, as in the Go rule. */
const MAX_PROFILE_PIXEL_BYTES = 256 * 1024 * 1024;
const MAX_JPEG_SCANS = 64;

export const PROFILE_TYPES = ["image/png", "image/jpeg"] as const;

/**
 * Why `data` is outside the profile of `contentType`, or null when it is
 * inside. A content type with no profile is refused.
 */
export function fileProfileProblem(contentType: string, data: Uint8Array): string | null {
  switch (contentType) {
    case "image/png":
      return pngProfile(data);
    case "image/jpeg":
      return jpegProfile(data);
    default:
      return `no profile for content type "${contentType}"`;
  }
}

// --- checksums ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array, start = 0, end = data.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; ) {
    // 5552 is the most bytes that cannot overflow 32 bits before the modulo.
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(data: Uint8Array, at: number): number {
  return ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
}

function ascii(data: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(data[i]);
  return s;
}

// --- PNG ---------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Accepts: the signature; IHDR with bit depth 8, colour type 0, 2 or 3 and no
// interlace; an optional sRGB; PLTE for colour type 3 only; consecutive IDAT
// chunks whose zlib stream ends exactly at the end of the last one and
// inflates to exactly the bytes the header needs; IEND. Every chunk has a
// valid CRC and nothing follows IEND.
function pngProfile(data: Uint8Array): string | null {
  if (data.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => data[i] !== b)) return "not a PNG";
  let pos = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colourType = 0;
  let seenIHDR = false;
  let seenPLTE = false;
  let seenSRGB = false;
  let seenIDAT = false;
  let idatDone = false;
  const idat: Uint8Array[] = [];
  let idatLen = 0;
  for (;;) {
    if (data.length - pos < 12) return "truncated chunk";
    const n = u32(data, pos);
    if (n > data.length - pos - 12) return "chunk runs past the end of the file";
    const typ = ascii(data, pos + 4, pos + 8);
    const bodyAt = pos + 8;
    if (crc32(data, pos + 4, bodyAt + n) !== u32(data, bodyAt + n)) return `${typ} chunk has a bad CRC`;
    pos = bodyAt + n + 4;
    if (!seenIHDR && typ !== "IHDR") return `first chunk is ${typ}, not IHDR`;
    if (seenIDAT && typ !== "IDAT") idatDone = true;
    switch (typ) {
      case "IHDR": {
        if (seenIHDR || n !== 13) return "bad IHDR";
        seenIHDR = true;
        width = u32(data, bodyAt);
        height = u32(data, bodyAt + 4);
        const depth = data[bodyAt + 8];
        colourType = data[bodyAt + 9];
        if (width === 0 || height === 0) return "zero width or height";
        if (depth !== 8) return `bit depth ${depth} (only 8 is kept)`;
        if (colourType !== 0 && colourType !== 2 && colourType !== 3) {
          return `colour type ${colourType} (transparency is not kept)`;
        }
        if (data[bodyAt + 10] !== 0 || data[bodyAt + 11] !== 0) return "unknown compression or filter method";
        if (data[bodyAt + 12] !== 0) return "interlaced";
        break;
      }
      case "sRGB":
        if (seenSRGB || seenPLTE || seenIDAT || n !== 1) return "misplaced or repeated sRGB";
        seenSRGB = true;
        break;
      case "PLTE":
        if (seenPLTE || seenIDAT || colourType !== 3) return "PLTE where the image does not use one";
        if (n === 0 || n % 3 !== 0 || n > 768) return "bad PLTE length";
        seenPLTE = true;
        break;
      case "IDAT":
        if (idatDone) return "IDAT chunks are not consecutive";
        if (colourType === 3 && !seenPLTE) return "palette image without a PLTE";
        seenIDAT = true;
        idat.push(data.subarray(bodyAt, bodyAt + n));
        idatLen += n;
        break;
      case "IEND": {
        if (n !== 0 || !seenIDAT) return "bad IEND";
        if (pos !== data.length) return `${data.length - pos} bytes after IEND`;
        const stream = new Uint8Array(idatLen);
        let at = 0;
        for (const part of idat) {
          stream.set(part, at);
          at += part.length;
        }
        return pngPixels(stream, width, height, colourType);
      }
      default:
        return `${typ} chunk is not kept`;
    }
  }
}

// The IDAT stream must be exactly one zlib stream holding exactly the
// scanlines the header calls for.
function pngPixels(stream: Uint8Array, width: number, height: number, colourType: number): string | null {
  const channels = colourType === 2 ? 3 : 1;
  // Each dimension is bounded first, as in the Go rule. (The product cannot
  // wrap here: both factors are far below 2^53 after this check.)
  if (width > MAX_PROFILE_PIXEL_BYTES || height > MAX_PROFILE_PIXEL_BYTES) return "image is too large to check";
  const rowBytes = width * channels + 1; // one filter byte per scanline
  const want = rowBytes * height;
  if (want > MAX_PROFILE_PIXEL_BYTES) return "image is too large to check";
  const res = zlibInflateExact(stream, want);
  if (typeof res === "string") return res;
  for (let y = 0; y < height; y++) {
    if (res[y * rowBytes] > 4) return "unknown scanline filter";
  }
  return null;
}

// --- zlib --------------------------------------------------------------------
//
// A small inflate written for this check instead of the browser's
// DecompressionStream: the rule needs to know that the stream ends exactly at
// the last input byte and inflates to exactly `want` bytes, and engines differ
// on bytes that follow a stream. Malformed streams are refused the way Go's
// compress/flate refuses them (code tables must be complete, except a single
// one-bit code; an unused table may be empty).

class Corrupt extends Error {}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const MAX_BITS = 15;

interface Huffman {
  /** count[n]: codes of length n. */
  count: Uint16Array;
  /** Symbols ordered by code. */
  symbol: Uint16Array;
}

function buildHuffman(lengths: ArrayLike<number>, n: number, strict = true): Huffman {
  const count = new Uint16Array(MAX_BITS + 1);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  const symbol = new Uint16Array(n);
  let used = 0;
  let max = 0;
  for (let len = 1; len <= MAX_BITS; len++) {
    if (count[len]) {
      used += count[len];
      max = len;
    }
  }
  if (used > 0) {
    // Codes left over after each length; negative means over-subscribed.
    let left = 1;
    for (let len = 1; len <= max; len++) {
      left = left * 2 - count[len];
      if (left < 0) throw new Corrupt();
    }
    if (strict && left !== 0 && !(used === 1 && max === 1)) throw new Corrupt();
  }
  const offs = new Uint16Array(MAX_BITS + 2);
  for (let len = 1; len <= MAX_BITS; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) {
    if (lengths[i] !== 0) symbol[offs[lengths[i]]++] = i;
  }
  return { count, symbol };
}

const FIXED_LIT = (() => {
  const l = new Uint8Array(288);
  l.fill(8, 0, 144);
  l.fill(9, 144, 256);
  l.fill(7, 256, 280);
  l.fill(8, 280, 288);
  return buildHuffman(l, 288);
})();
// The fixed distance code has 30 five-bit codes: incomplete by design.
const FIXED_DIST = buildHuffman(new Uint8Array(30).fill(5), 30, false);

/**
 * Inflates a zlib stream that must end exactly at the end of `src` with a
 * valid checksum and hold exactly `want` bytes. Returns the bytes, or the
 * reason as a string.
 */
function zlibInflateExact(src: Uint8Array, want: number): Uint8Array | string {
  const notZlib = "IDAT is not a zlib stream";
  if (src.length < 2) return notZlib;
  const cmf = src[0];
  const flg = src[1];
  // Deflate with a window of at most 32 KiB, a valid header check, no preset dictionary.
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || ((cmf << 8) | flg) % 31 !== 0 || flg & 0x20) return notZlib;

  const out = new Uint8Array(want);
  let outPos = 0;
  let pos = 2;
  let bitBuf = 0;
  let bitCnt = 0;

  const bits = (need: number): number => {
    while (bitCnt < need) {
      if (pos >= src.length) throw new Corrupt("short");
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << need) - 1);
    bitBuf >>>= need;
    bitCnt -= need;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Corrupt();
  };
  const put = (b: number) => {
    if (outPos >= want) throw new Corrupt("long");
    out[outPos++] = b;
  };

  try {
    for (let last = false; !last; ) {
      last = bits(1) === 1;
      const type = bits(2);
      if (type === 0) {
        bitBuf = 0;
        bitCnt = 0;
        if (pos + 4 > src.length) throw new Corrupt("short");
        const len = src[pos] | (src[pos + 1] << 8);
        const nlen = src[pos + 2] | (src[pos + 3] << 8);
        pos += 4;
        if (len !== (~nlen & 0xffff)) throw new Corrupt();
        if (pos + len > src.length) throw new Corrupt("short");
        if (outPos + len > want) throw new Corrupt("long");
        out.set(src.subarray(pos, pos + len), outPos);
        outPos += len;
        pos += len;
        continue;
      }
      if (type === 3) throw new Corrupt();
      let lit = FIXED_LIT;
      let dist = FIXED_DIST;
      if (type === 2) {
        const nlit = bits(5) + 257;
        const ndist = bits(5) + 1;
        const ncode = bits(4) + 4;
        if (nlit > 286 || ndist > 30) throw new Corrupt();
        const lengths = new Uint8Array(316);
        for (let i = 0; i < ncode; i++) lengths[CODE_ORDER[i]] = bits(3);
        const codeLen = buildHuffman(lengths.subarray(0, 19), 19);
        const all = new Uint8Array(nlit + ndist);
        for (let i = 0; i < nlit + ndist; ) {
          const sym = decode(codeLen);
          if (sym < 16) {
            all[i++] = sym;
            continue;
          }
          let rep: number;
          let val = 0;
          if (sym === 16) {
            if (i === 0) throw new Corrupt();
            val = all[i - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) {
            rep = 3 + bits(3);
          } else {
            rep = 11 + bits(7);
          }
          if (i + rep > nlit + ndist) throw new Corrupt();
          while (rep--) all[i++] = val;
        }
        lit = buildHuffman(all.subarray(0, nlit), nlit);
        dist = buildHuffman(all.subarray(nlit), ndist);
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) {
          put(sym);
          continue;
        }
        if (sym === 256) break;
        const li = sym - 257;
        if (li >= 29) throw new Corrupt();
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        if (di >= 30) throw new Corrupt();
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (d > outPos) throw new Corrupt();
        if (outPos + len > want) throw new Corrupt("long");
        for (let i = 0; i < len; i++, outPos++) out[outPos] = out[outPos - d];
      }
    }
  } catch (err) {
    if (!(err instanceof Corrupt)) throw err;
    if (err.message === "long") return "IDAT holds more bytes than the image needs";
    return "IDAT holds fewer bytes than the image needs";
  }
  if (outPos !== want) return "IDAT holds fewer bytes than the image needs";
  // The checksum follows the last block on a byte boundary; nothing follows it.
  if (pos + 4 > src.length || u32(src, pos) !== adler32(out)) return "IDAT holds more bytes than the image needs";
  if (pos + 4 !== src.length) return `${src.length - pos - 4} bytes after the zlib stream ends`;
  return out;
}

// --- JPEG --------------------------------------------------------------------

const M_SOF0 = 0xc0;
const M_SOF2 = 0xc2;
const M_DHT = 0xc4;
const M_RST0 = 0xd0;
const M_RST7 = 0xd7;
const M_SOI = 0xd8;
const M_EOI = 0xd9;
const M_SOS = 0xda;
const M_DQT = 0xdb;
const M_DRI = 0xdd;
const M_APP0 = 0xe0;

function isJfif(data: Uint8Array, at: number): boolean {
  return data[at] === 0x4a && data[at + 1] === 0x46 && data[at + 2] === 0x49 && data[at + 3] === 0x46 && data[at + 4] === 0;
}

/** Where a scan's entropy-coded data ends (the next real marker), or -1. */
function scanEnd(data: Uint8Array, from: number): number {
  let pos = from;
  for (;;) {
    const i = data.indexOf(0xff, pos);
    if (i < 0 || i + 1 >= data.length) return -1;
    const next = data[i + 1];
    if (next === 0x00 || (next >= M_RST0 && next <= M_RST7)) {
      pos = i + 2;
      continue;
    }
    return i;
  }
}

// Accepts: SOI; one optional 16-byte JFIF APP0 with no thumbnail, directly
// after SOI; DQT, DHT and DRI; exactly one SOF0 (baseline) or SOF2
// (progressive) frame with 8-bit samples and 1 or 3 components; its scans;
// EOI. Each segment starts where the last ended and nothing follows EOI.
function jpegProfile(data: Uint8Array): string | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== M_SOI) return "not a JPEG";
  let pos = 2;
  let first = true;
  let seenFrame = false;
  let scans = 0;
  for (;;) {
    if (pos + 2 > data.length) return "truncated before EOI";
    if (data[pos] !== 0xff) return `bytes between segments at offset ${pos}`;
    const marker = data[pos + 1];
    pos += 2;
    if (marker === M_EOI) {
      if (scans === 0) return "no image data";
      if (pos !== data.length) return `${data.length - pos} bytes after EOI`;
      return null;
    }
    if (pos + 2 > data.length) return "truncated segment";
    const segLen = (data[pos] << 8) | data[pos + 1];
    if (segLen < 2 || pos + segLen > data.length) return "segment runs past the end of the file";
    const body = pos + 2;
    const bodyLen = segLen - 2;
    switch (marker) {
      case M_APP0:
        if (!first) return "APP0 is not directly after SOI";
        if (bodyLen !== 14 || !isJfif(data, body)) return "APP0 is not a plain JFIF header";
        if (data[body + 12] !== 0 || data[body + 13] !== 0) return "JFIF thumbnail";
        break;
      case M_DQT:
      case M_DHT:
        if (bodyLen === 0) return "empty table segment";
        break;
      case M_DRI:
        if (bodyLen !== 2) return "bad DRI";
        break;
      case M_SOF0:
      case M_SOF2: {
        if (seenFrame) return "a second frame";
        if (bodyLen < 6) return "bad frame header";
        const precision = data[body];
        const components = data[body + 5];
        const h = (data[body + 1] << 8) | data[body + 2];
        const w = (data[body + 3] << 8) | data[body + 4];
        if (precision !== 8) return `${precision}-bit samples (only 8 is kept)`;
        if (w === 0 || h === 0) return "zero width or height";
        if (components !== 1 && components !== 3) {
          return `${components} components (only grey and three-colour are kept)`;
        }
        if (bodyLen !== 6 + 3 * components) return "bad frame header";
        seenFrame = true;
        break;
      }
      case M_SOS: {
        if (!seenFrame) return "scan before the frame header";
        scans++;
        if (scans > MAX_JPEG_SCANS) return "too many scans";
        const end = scanEnd(data, pos + segLen);
        if (end < 0) return "truncated scan";
        pos = end;
        first = false;
        continue;
      }
      default:
        return `segment FF${marker.toString(16).toUpperCase().padStart(2, "0")} is not kept`;
    }
    first = false;
    pos += segLen;
  }
}

/**
 * Drops the JPEG segments the profile does not keep (application and comment
 * segments, and a JFIF header that is not the plain one) without touching the
 * image data. Returns the input unchanged when it cannot be walked; the
 * profile check then says why.
 */
export function stripJpegSegments(data: Uint8Array): Uint8Array {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== M_SOI) return data;
  const keep: Uint8Array[] = [data.subarray(0, 2)];
  let pos = 2;
  let first = true;
  for (;;) {
    if (pos + 2 > data.length || data[pos] !== 0xff) return data;
    const marker = data[pos + 1];
    if (marker === M_EOI) {
      keep.push(data.subarray(pos, pos + 2));
      break;
    }
    if (pos + 4 > data.length) return data;
    const segLen = (data[pos + 2] << 8) | data[pos + 3];
    if (segLen < 2 || pos + 2 + segLen > data.length) return data;
    let end = pos + 2 + segLen;
    const plainJfif =
      marker === M_APP0 && first && segLen === 16 && isJfif(data, pos + 4) && data[pos + 16] === 0 && data[pos + 17] === 0;
    const metadata = (marker >= M_APP0 && marker <= 0xef) || marker === 0xfe;
    if (marker === M_SOS) {
      end = scanEnd(data, end);
      if (end < 0) return data;
    }
    if (!metadata || plainJfif) {
      keep.push(data.subarray(pos, end));
      first = false;
    }
    pos = end;
  }
  const out = new Uint8Array(keep.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of keep) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
