import { test } from "node:test";
import assert from "node:assert/strict";
import { arweaveNodeOf, copiesAfforded, formatAr, operatorWallets } from "./storageFunds";

const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64");
const A = "a".repeat(43);
const B = "JNC6vBhjHY1EPwV3pEeNmrsgFMxH5d38_LHsZ7jful8";

test("operator wallets are read only from well-formed metadata for the same backend", () => {
  assert.deepEqual(operatorWallets(b64({ v: 1, backend: "arweave", wallets: [A, B, A] }), "arweave"), [A, B]);
  assert.deepEqual(operatorWallets(b64({ v: 1, backend: "aurora", wallets: [A] }), "arweave"), []);
  assert.deepEqual(operatorWallets(b64({ v: 2, backend: "arweave", wallets: [A] }), "arweave"), []);
  assert.deepEqual(operatorWallets(b64({ v: 1, backend: "arweave", wallets: ["short", 7, `${A}x`, B] }), "arweave"), [B]);
  assert.deepEqual(operatorWallets(b64({ v: 1, backend: "arweave", wallets: A }), "arweave"), []);
  assert.deepEqual(operatorWallets(b64("not json"), "arweave"), []);
  assert.deepEqual(operatorWallets("%%%", "arweave"), []);
  assert.deepEqual(operatorWallets(undefined, "arweave"), []);
  // No more than five are shown, however many are listed.
  const many = Array.from({ length: 9 }, (_, i) => `${i}`.repeat(43));
  assert.equal(operatorWallets(b64({ v: 1, backend: "arweave", wallets: many }), "arweave").length, 5);
});

test("AR amounts, copies afforded and the node of a gateway", () => {
  assert.equal(formatAr("0"), "0");
  assert.equal(formatAr("1000000000000"), "1");
  assert.equal(formatAr("31200000000"), "0.0312");
  assert.equal(formatAr("2500000000000"), "2.5");
  assert.equal(formatAr("99"), "less than 0.0001");
  assert.equal(formatAr("abc"), "?");
  assert.equal(copiesAfforded("1000", "300"), 3);
  assert.equal(copiesAfforded("100", "300"), 0);
  assert.equal(copiesAfforded(null, "300"), null);
  assert.equal(copiesAfforded("1000", "0"), null);
  assert.equal(arweaveNodeOf("https://arweave.net/{id}"), "https://arweave.net");
  assert.equal(arweaveNodeOf("https://gw.phoenix.example/raw/{id}"), "https://gw.phoenix.example");
  assert.equal(arweaveNodeOf("nonsense"), "https://arweave.net");
});
