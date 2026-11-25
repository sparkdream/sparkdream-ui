// The chain-archiver operator metadata the registration panel publishes.
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archiverMetadataBytes,
  buildArchiverMetadata,
  parseArchiverMetadata,
  parseWallets,
  walletProblems,
} from "./chainArchiver";

const phoenix = "10tJ9DsLQ97USrpb7xKYTW0jwXJ9IGhmjqqce6mcEP0";
const aurora = "uo94t4K0yA6mknk28GwNmOrM_FexblhPbxNdgeTw24g";
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

test("the metadata is byte for byte what the worker's setup command writes", () => {
  // printf '{"v":1,"backend":"arweave","wallets":["%s"]}' (archival-strategy.md)
  const text = new TextDecoder().decode(archiverMetadataBytes(buildArchiverMetadata([phoenix])));
  assert.equal(text, `{"v":1,"backend":"arweave","wallets":["${phoenix}"]}`);
});

test("wallets are read from lines, commas and spaces, once each", () => {
  assert.deepEqual(parseWallets(` ${phoenix},\n${aurora}  ${phoenix}\n`), [phoenix, aurora]);
  assert.deepEqual(parseWallets("  \n"), []);
});

test("an empty list and anything that is not an Arweave address are refused", () => {
  assert.equal(walletProblems([]).length, 1);
  assert.deepEqual(walletProblems([phoenix, aurora]), []);
  for (const bad of [phoenix.slice(1), `${phoenix}A`, "sprkdrm1afyuna8gqe55t7jztxcg0aleg0k5txep72pfan", aurora.replace("_", "/")]) {
    assert.equal(walletProblems([phoenix, bad]).length, 1, bad);
  }
});

test("published metadata round-trips, and other operators' metadata is not taken for it", () => {
  const meta = buildArchiverMetadata([phoenix, aurora]);
  assert.deepEqual(parseArchiverMetadata(b64(archiverMetadataBytes(meta))), meta);
  const enc = (v: unknown) => b64(new TextEncoder().encode(JSON.stringify(v)));
  assert.equal(parseArchiverMetadata(""), null);
  assert.equal(parseArchiverMetadata("not base64 !"), null);
  assert.equal(parseArchiverMetadata(enc({ verdict_key: "x", feed_url: "https://scan.example.com/" })), null);
  assert.equal(parseArchiverMetadata(enc({ v: 1, backend: "arweave", wallets: [] })), null);
  assert.equal(parseArchiverMetadata(enc({ v: 1, backend: "arweave", wallets: [phoenix, 7] })), null);
  assert.equal(parseArchiverMetadata(enc({ v: 1, backend: "ipfs", wallets: [phoenix] })), null);
});
