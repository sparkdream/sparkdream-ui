import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSignText, normalizeSignValue } from "./signText";

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

test("line and paragraph separators become line breaks", () => {
  assert.equal(normalizeSignText(`a${LS}b${PS}c`), "a\nb\n\nc");
  assert.equal(normalizeSignText("plain é — text"), "plain é — text");
});

test("message values are normalized in depth and otherwise left alone", () => {
  const bytes = new Uint8Array([0xe2, 0x80, 0xa8]);
  const when = new Date(0);
  const clean = { creator: "a", tags: ["x"], n: BigInt(1), bytes, when, inner: { body: "ok" } };
  assert.equal(normalizeSignValue(clean), clean, "an unaffected value is the same object");

  const dirty = { ...clean, tags: [`x${LS}y`], inner: { body: `p${PS}q` } };
  const out = normalizeSignValue(dirty);
  assert.deepEqual(out.tags, ["x\ny"]);
  assert.equal(out.inner.body, "p\n\nq");
  assert.equal(out.bytes, bytes, "bytes are not touched");
  assert.equal(out.when, when);
  assert.equal(out.n, BigInt(1));
});
