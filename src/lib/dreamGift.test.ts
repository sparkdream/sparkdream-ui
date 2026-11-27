import { test } from "node:test";
import assert from "node:assert/strict";
import { giftTax, microParam, parseDreamAmount } from "./dreamGift";

test("parseDreamAmount is exact and refuses bad input", () => {
  assert.equal(parseDreamAmount("15"), BigInt(15_000_000));
  assert.equal(parseDreamAmount(" 0.5 "), BigInt(500_000));
  assert.equal(parseDreamAmount(".000001"), BigInt(1));
  assert.equal(parseDreamAmount("14.55"), BigInt(14_550_000));
  for (const bad of ["", ".", "0", "0.0", "-1", "1.0000001", "1e3", "abc", "1,5"]) {
    assert.equal(parseDreamAmount(bad), null, bad);
  }
});

test("giftTax truncates like the chain", () => {
  assert.equal(giftTax(BigInt(15_000_000), "0.030000000000000000"), BigInt(450_000));
  assert.equal(giftTax(BigInt(33), "0.030000000000000000"), BigInt(0));
  assert.equal(giftTax(BigInt(15_000_000), "0"), BigInt(0));
  assert.equal(giftTax(BigInt(15_000_000), undefined), BigInt(0));
});

test("microParam reads integer strings only", () => {
  assert.equal(microParam("500000000"), BigInt(500_000_000));
  assert.equal(microParam("1.5"), null);
  assert.equal(microParam(5), null);
});
