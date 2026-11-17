import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileProfileProblem, stripJpegSegments } from "./fileProfile";
import { encodeRgbPng } from "./imagePrepare";

// The vectors the chain's Go rule is tested against, exported by
//   FILEPROFILE_VECTORS_OUT=<this fixture> go test ./tools/fileprofile -count=1
// in the chain repo (delete the fixture first: the test appends). This port
// must give the same answer for every one.
interface Vector {
  content_type: string;
  name: string;
  hex: string;
  ok: boolean;
}

const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "__fixtures__", "file-profile-vectors.jsonl");
const vectors: Vector[] = fs
  .readFileSync(fixture, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

test("the file profile agrees with the chain's vectors", () => {
  assert.ok(vectors.length >= 40, "fixture is missing vectors");
  for (const v of vectors) {
    const problem = fileProfileProblem(v.content_type, bytes(v.hex));
    assert.equal(problem === null, v.ok, `${v.content_type} "${v.name}": ${problem ?? "accepted"}`);
  }
});

test("a type with no profile is refused", () => {
  for (const ct of ["image/gif", "image/webp", "text/plain", ""]) {
    assert.notEqual(fileProfileProblem(ct, new TextEncoder().encode("anything")), null);
  }
});

test("stripping drops the segments the profile refuses and nothing else", () => {
  const good = vectors.find((v) => v.content_type === "image/jpeg" && v.name === "colour baseline")!;
  const want = bytes(good.hex);
  for (const name of ["EXIF", "ICC profile", "Adobe APP14", "comment", "JFIF thumbnail", "JFXX extension", "APP0 not first"]) {
    const v = vectors.find((x) => x.content_type === "image/jpeg" && x.name === name)!;
    const stripped = stripJpegSegments(bytes(v.hex));
    assert.deepEqual(stripped, want, name);
  }
  const jfif = bytes(vectors.find((v) => v.name === "with a plain JFIF header")!.hex);
  assert.deepEqual(stripJpegSegments(jfif), jfif, "a plain JFIF header is kept");
  // A file that cannot be walked comes back as it was.
  const cut = bytes(vectors.find((v) => v.content_type === "image/jpeg" && v.name === "truncated")!.hex);
  assert.deepEqual(stripJpegSegments(cut), cut);
});

test("the PNG encoder writes files inside the profile", async () => {
  for (const [w, h] of [[1, 1], [7, 5], [64, 33], [300, 200]]) {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 31 + (i >> 3) * 7) & 0xff;
    const png = await encodeRgbPng(rgba, w, h);
    assert.equal(fileProfileProblem("image/png", png), null, `${w}x${h}`);
    // One changed byte in the pixel stream no longer checks out.
    const bad = png.slice();
    bad[bad.length - 20] ^= 0x01;
    assert.notEqual(fileProfileProblem("image/png", bad), null);
  }
});

// Reads a PNG the plain way (inflate, undo each scanline's filter) and
// returns its RGB bytes: the encoder's filters must decode to the pixels it
// was given, or a permanent copy would hold a different picture.
function decodeRgbPng(png: Uint8Array): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  const idat: Uint8Array[] = [];
  for (let pos = 8; pos < png.length; ) {
    const n = view.getUint32(pos);
    if (String.fromCharCode(...png.subarray(pos + 4, pos + 8)) === "IDAT") idat.push(png.subarray(pos + 8, pos + 8 + n));
    pos += 12 + n;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 3;
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 3 ? out[y * stride + x - 3] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 3 && y > 0 ? out[(y - 1) * stride + x - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][filter];
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return out;
}

test("the PNG encoder's output decodes to the pixels it was given", async () => {
  const used = new Set<number>();
  // Flat, gradient, vertical-stripe and noise images, to exercise every filter.
  const paint: Array<(x: number, y: number) => [number, number, number]> = [
    () => [200, 10, 90],
    (x, y) => [x & 255, y & 255, (x + y) & 255],
    (x, y) => [(y * 37) & 255, (y * 91) & 255, x % 2 ? 255 : 0],
    (x, y) => [(x * 2654435761 + y * 40503) >>> 24, (x * 97 + y * 1009) & 255, ((x ^ (y * 31)) * 73) & 255],
  ];
  for (const f of paint) {
    const [w, h] = [97, 61];
    const rgba = new Uint8Array(w * h * 4);
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      rgba.set([r, g, b, 7], (y * w + x) * 4); // the alpha byte is ignored
      rgb.set([r, g, b], (y * w + x) * 3);
    }
    const png = await encodeRgbPng(rgba, w, h);
    assert.equal(fileProfileProblem("image/png", png), null);
    assert.deepEqual(decodeRgbPng(png), rgb);
    const raw = zlib.inflateSync(Buffer.concat([png.subarray(8 + 25 + 8, png.length - 12 - 4)]));
    for (let y = 0; y < h; y++) used.add(raw[y * (w * 3 + 1)]);
  }
  assert.ok(used.size >= 3, `only filters ${[...used]} were used`);
});
