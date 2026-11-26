import { test } from "node:test";
import assert from "node:assert/strict";
import { assessShield, type ShieldInput } from "./shieldStatus";

const SPARK = BigInt(1_000_000);

function input(over: Partial<ShieldInput> = {}): ShieldInput {
  return {
    enabled: true,
    balance: BigInt(100) * SPARK,
    minReserve: BigInt(100) * SPARK,
    maxFeePerExec: BigInt(50_000),
    fundingLeftToday: BigInt(200) * SPARK,
    communityPool: BigInt(5_000) * SPARK,
    hasVerificationKey: true,
    prover: { version: "v1.1.1", problem: null },
    batches: { enabled: false, hasKey: false, pending: 0 },
    symbol: "SPARK",
    ...over,
  };
}

const fact = (r: { facts: { label: string; value: string }[] }, label: string) =>
  r.facts.find((f) => f.label === label)?.value;

test("a full reserve, a verification key and published prover files are working", () => {
  const got = assessShield(input());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.facts, [
    { label: "Gas reserve", value: "100 SPARK, kept at 100" },
    { label: "Prover files", value: "v1.1.1, published" },
  ]);
});

test("a chain without the module, or with it switched off, is off", () => {
  assert.equal(assessShield(input({ enabled: null })).state, "off");
  assert.equal(assessShield(input({ enabled: false })).state, "off");
});

test("no verification key means every action is refused", () => {
  const got = assessShield(input({ hasVerificationKey: false }));
  assert.equal(got.state, "degraded");
  assert.match(got.issues[0], /no verification key/);
  assert.equal(assessShield(input({ hasVerificationKey: null })).state, "ok");
});

test("a reserve below its minimum is fine while it can be refilled", () => {
  const got = assessShield(input({ balance: BigInt(60) * SPARK }));
  assert.equal(got.state, "ok");
  assert.equal(fact(got, "Gas reserve"), "60 SPARK, kept at 100");
});

test("a reserve that can't be refilled is a problem before it is empty", () => {
  // The community pool is empty: the testnet's case once the reserve dips.
  const dry = assessShield(input({ balance: BigInt(60) * SPARK, communityPool: BigInt(0) }));
  assert.equal(dry.state, "degraded");
  assert.equal(dry.issues[0], "The gas reserve is below its minimum and isn't being refilled: the community pool it is refilled from can't cover it.");
  const capped = assessShield(input({ balance: BigInt(60) * SPARK, fundingLeftToday: BigInt(0) }));
  assert.match(capped.issues[0], /today's refill limit is used up/);
  // Nearly out: said in actions left.
  const low = assessShield(input({ balance: BigInt(1) * SPARK, communityPool: BigInt(0) }));
  assert.equal(low.issues[0], "The gas reserve pays for about 20 more anonymous actions, and the community pool it is refilled from can't cover it.");
  // The pool only has to cover what today's limit still allows.
  const partial = assessShield(input({ balance: BigInt(60) * SPARK, fundingLeftToday: BigInt(10) * SPARK, communityPool: BigInt(15) * SPARK }));
  assert.equal(partial.state, "ok");
});

test("an empty reserve refuses everything", () => {
  const empty = assessShield(input({ balance: BigInt(0), communityPool: BigInt(0) }));
  assert.equal(empty.state, "degraded");
  assert.equal(empty.issues[0], "The gas reserve is empty, so anonymous actions are refused, and the community pool it is refilled from can't cover it.");
  // Less than one action's fee is as good as empty.
  assert.match(assessShield(input({ balance: BigInt(40_000) })).issues[0], /^The gas reserve is empty, so anonymous actions are refused\.$/);
  // An unread balance says nothing.
  const blind = assessShield(input({ balance: null }));
  assert.equal(blind.state, "ok");
  assert.equal(fact(blind, "Gas reserve"), undefined);
});

test("prover files that aren't usable fail in the browser, and the card says so", () => {
  const got = assessShield(input({ prover: { version: "v1.2.0", problem: "The prover files for v1.2.0 aren't published." } }));
  assert.equal(got.state, "degraded");
  assert.equal(fact(got, "Prover files"), "v1.2.0, not usable");
  assert.equal(got.issues[0], "The prover files for v1.2.0 aren't published. Anonymous actions fail in the browser until they are published.");
  assert.equal(fact(assessShield(input({ prover: null })), "Prover files"), undefined);
});

test("encrypted batches are judged only where they are switched on", () => {
  assert.equal(assessShield(input({ batches: { enabled: false, hasKey: false, pending: 4 } })).facts.length, 2);
  const keyless = assessShield(input({ batches: { enabled: true, hasKey: false, pending: 4 } }));
  assert.equal(keyless.state, "degraded");
  assert.equal(fact(keyless, "Waiting in an encrypted batch"), "4");
  assert.match(keyless.issues[0], /validators have no shared key yet/);
  assert.equal(assessShield(input({ batches: { enabled: true, hasKey: true, pending: 0 } })).state, "ok");
});
