// Field checks and builders for the x/storage council proposals.
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { toBech32 } from "@cosmjs/encoding";
import {
  StorageCouncilMsgTypeUrls,
  addressProblem,
  displayAmountToMicro,
  packStorageCouncilMsg,
  parseHashes,
  pricesProblem,
  reasonProblem,
  requestIdProblem,
  unflagRemovedMsg,
  updateStoragePricesMsg,
  voidCompletionMsg,
} from "./storageCouncilMsgs";
import type { StorageBackendWithBounds } from "../types/storage";

const PREFIX = "sprkdrm";
const addr = (n: number, prefix = PREFIX, len = 20) => toBech32(prefix, new Uint8Array(len).fill(n));
const H1 = "ab".repeat(32);
const H2 = "cd".repeat(32);

// The launch backend's prices and bounds (x/storage DefaultArweaveBackend).
const ARWEAVE: StorageBackendWithBounds = {
  name: "arweave",
  service_type: "storage-arweave",
  kind: "BACKEND_KIND_PERMANENT",
  locator_format: "LOCATOR_FORMAT_ARWEAVE_TX",
  enabled: true,
  price_per_byte: "10",
  min_fee: "1000000",
  min_price_per_byte: "1",
  max_price_per_byte: "1000000",
  min_min_fee: "100000",
  max_min_fee: "1000000000",
  types: [],
};

test("addresses must be bech32 with the chain prefix", () => {
  assert.equal(addressProblem(addr(1), PREFIX, "operator"), null);
  assert.equal(addressProblem(addr(1, PREFIX, 32), PREFIX, "operator"), null);
  assert.match(addressProblem("", PREFIX, "operator") ?? "", /Enter the operator's address/);
  assert.match(addressProblem(addr(1, "aurora"), PREFIX, "scanner") ?? "", /must start with sprkdrm1/);
  assert.match(addressProblem("sprkdrm1notanaddress", PREFIX, "scanner") ?? "", /not a valid address/);
  assert.match(addressProblem(addr(1, PREFIX, 8), PREFIX, "scanner") ?? "", /not a valid address/);
});

test("request numbers are whole numbers from 1", () => {
  assert.equal(requestIdProblem("1"), null);
  assert.equal(requestIdProblem("18446744073709551615"), null);
  for (const bad of ["", "0", "00", "-1", "1.5", "7a", " 7", "18446744073709551616"]) {
    assert.notEqual(requestIdProblem(bad), null, bad);
  }
});

test("the reason is required and counted in bytes", () => {
  assert.equal(reasonProblem("the copy is missing", 256), null);
  assert.notEqual(reasonProblem("   ", 256), null);
  assert.equal(reasonProblem("a".repeat(256), 256), null);
  assert.match(reasonProblem("a".repeat(257), 256) ?? "", /at most 256/);
  // 100 two-byte characters are 200 bytes.
  assert.match(reasonProblem("é".repeat(100), 150) ?? "", /200 bytes/);
  // Surrounding spaces are trimmed before the message is built.
  assert.equal(reasonProblem(` ${"a".repeat(256)} `, 256), null);
});

test("hashes are parsed from pasted text and checked as the chain does", () => {
  assert.deepEqual(parseHashes(`${H1}\n${H2}`, 50), { hashes: [H1, H2], problem: null });
  assert.deepEqual(parseHashes(` ${H1}, ${H2.toUpperCase()} `, 50).hashes, [H1, H2]);
  assert.match(parseHashes("", 50).problem ?? "", /at least one/);
  assert.match(parseHashes(H1.slice(1), 50).problem ?? "", /not a file hash/);
  assert.match(parseHashes(`${H1} ${"zz".repeat(32)}`, 50).problem ?? "", /not a file hash/);
  assert.match(parseHashes(`${H1} ${H1.toUpperCase()}`, 50).problem ?? "", /listed twice/);
  assert.match(parseHashes(`${H1} ${H2}`, 1).problem ?? "", /at most 1/);
});

test("typed amounts convert to base units without losing digits", () => {
  assert.equal(displayAmountToMicro("1"), "1000000");
  assert.equal(displayAmountToMicro("0.00001"), "10");
  assert.equal(displayAmountToMicro(".5"), "500000");
  assert.equal(displayAmountToMicro("2."), "2000000");
  assert.equal(displayAmountToMicro("0"), "0");
  for (const bad of ["", ".", "0.0000001", "1e3", "-1", "1,5", "abc"]) {
    assert.equal(displayAmountToMicro(bad), null, bad);
  }
});

test("prices must sit inside the backend's bounds", () => {
  assert.equal(pricesProblem(ARWEAVE, "10", "1000000", "SPARK"), null);
  assert.equal(pricesProblem(ARWEAVE, "1", "100000", "SPARK"), null);
  assert.equal(pricesProblem(ARWEAVE, "1000000", "1000000000", "SPARK"), null);
  assert.match(pricesProblem(ARWEAVE, "0", "1000000", "SPARK") ?? "", /price per byte must be between 0\.000001 and 1 SPARK/);
  assert.match(pricesProblem(ARWEAVE, "1000001", "1000000", "SPARK") ?? "", /price per byte/);
  assert.match(pricesProblem(ARWEAVE, "10", "99999", "SPARK") ?? "", /minimum fee must be between 0\.1 and 1,000 SPARK/);
  assert.match(pricesProblem(ARWEAVE, "10", "1000000001", "SPARK") ?? "", /minimum fee/);
  assert.match(pricesProblem(ARWEAVE, null, "1000000", "SPARK") ?? "", /price per byte/);
  assert.match(pricesProblem(ARWEAVE, "10", null, "SPARK") ?? "", /minimum fee/);
});

test("built messages pack and decode back to what was built", async () => {
  const tx = await import("@sparkdreamnft/sparkdreamjs/sparkdream/storage/v1/tx");
  const policy = addr(9);

  const voided = await packStorageCouncilMsg(voidCompletionMsg(policy, "7", "missing"));
  assert.equal(voided.typeUrl, StorageCouncilMsgTypeUrls.VoidCompletion);
  assert.deepEqual(tx.MsgVoidCompletion.decode(voided.value), { authority: policy, requestId: BigInt(7), reason: "missing" });

  const lifted = await packStorageCouncilMsg(unflagRemovedMsg(policy, [H1, H2]));
  assert.deepEqual(tx.MsgUnflagRemoved.decode(lifted.value), { authority: policy, hashes: [H1, H2] });

  const prices = await packStorageCouncilMsg(updateStoragePricesMsg(policy, "arweave", "10", "1000000"));
  assert.deepEqual(tx.MsgUpdateOperationalParams.decode(prices.value), {
    authority: policy, backend: "arweave", pricePerByte: "10", minFee: "1000000",
  });

  await assert.rejects(packStorageCouncilMsg({ typeUrl: "/sparkdream.storage.v1.MsgCancelRequest", value: {} }));
});
