import { test } from "node:test";
import assert from "node:assert/strict";
import { assessValidators, type ActiveValidator, type ValidatorInput } from "./validatorStatus";

const v = (moniker: string, power: number, over: Partial<ActiveValidator> = {}): ActiveValidator => ({
  moniker,
  power,
  signed: true,
  missed: 0,
  ...over,
});

function input(over: Partial<ValidatorInput> = {}): ValidatorInput {
  return {
    active: [v("alpha", 40), v("beta", 30), v("gamma", 20), v("delta", 10)],
    jailed: [],
    maxValidators: 100,
    window: 100,
    maxMissed: 50,
    ...over,
  };
}

const fact = (r: { facts: { label: string; value: string }[] }, label: string) =>
  r.facts.find((f) => f.label === label)?.value;

test("a full set that signed the last block is working, and the spread of power is shown", () => {
  const got = assessValidators(input());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.facts, [
    { label: "Active validators", value: "4, of at most 100" },
    { label: "Signed the last block", value: "4 of 4, 100% of the voting power" },
    { label: "Largest validator", value: "alpha, 40% of the voting power" },
    { label: "Enough to stop the chain", value: "1 validator (over a third of the voting power)" },
  ]);
  // Three equal validators: one holds exactly a third, which is not more than a third.
  const even = assessValidators(input({ active: [v("a", 10), v("b", 10), v("c", 10)] }));
  assert.equal(fact(even, "Enough to stop the chain"), "2 validators (over a third of the voting power)");
});

test("a single validator holding everything is how the network is set up, not a fault", () => {
  const got = assessValidators(input({ active: [v("solo", 1_800_000)] }));
  assert.equal(got.state, "ok");
  assert.equal(fact(got, "Largest validator"), "solo, 100% of the voting power");
});

test("too little of the voting power signing the last block is close to a halt", () => {
  // beta (30%) missed it: 70% signed, above two thirds but thin.
  const thin = assessValidators(input({ active: [v("alpha", 40), v("beta", 30, { signed: false }), v("gamma", 20), v("delta", 10)] }));
  assert.equal(thin.state, "degraded");
  assert.equal(fact(thin, "Signed the last block"), "3 of 4, 70% of the voting power");
  assert.match(thin.issues[0], /Only 70% of the voting power signed the last block/);
  // A small validator missing one block is routine.
  const one = assessValidators(input({ active: [v("alpha", 40), v("beta", 30), v("gamma", 20), v("delta", 10, { signed: false })] }));
  assert.equal(one.state, "ok");
  assert.equal(fact(one, "Signed the last block"), "3 of 4, 90% of the voting power");
  // The last commit unread: no row, nothing concluded.
  const blind = assessValidators(input({ active: [v("alpha", 60, { signed: null }), v("beta", 40, { signed: null })] }));
  assert.equal(blind.state, "ok");
  assert.equal(fact(blind, "Signed the last block"), undefined);
});

test("a validator using up its allowed misses is on its way to jail", () => {
  const got = assessValidators(input({ active: [v("alpha", 40), v("beta", 30, { missed: 30 }), v("gamma", 20, { missed: 10 }), v("delta", 10)] }));
  assert.equal(got.state, "degraded");
  assert.deepEqual(got.issues, ["beta has missed 30 of the last 100 blocks and is jailed past 50."]);
  // Many at once are summed up after the first three.
  const many = assessValidators(input({ active: ["a", "b", "c", "d", "e"].map((m) => v(m, 20, { missed: 40 })) }));
  assert.equal(many.issues.length, 4);
  assert.equal(many.issues[3], "2 validators more are missing blocks at that rate.");
  // Missed blocks unread, or the slashing window unknown: nothing concluded.
  assert.equal(assessValidators(input({ active: [v("alpha", 100, { missed: null })] })).state, "ok");
  assert.equal(assessValidators(input({ window: 0, maxMissed: 0, active: [v("alpha", 100, { missed: 99 })] })).state, "ok");
});

test("jailed validators are shown, with those barred for good, and are not a fault of the set", () => {
  const got = assessValidators(input({ jailed: [{ moniker: "x", tombstoned: false }, { moniker: "y", tombstoned: true }] }));
  assert.equal(got.state, "ok");
  assert.equal(fact(got, "Jailed"), "2, 1 for good after signing twice");
  assert.equal(fact(assessValidators(input({ jailed: [{ moniker: "x", tombstoned: false }] })), "Jailed"), "1");
  assert.equal(fact(assessValidators(input()), "Jailed"), undefined);
});

test("no readable set is unreachable", () => {
  assert.equal(assessValidators(input({ active: [] })).state, "unreachable");
  assert.equal(assessValidators(input({ active: [v("a", 0)] })).state, "unreachable");
  assert.equal(fact(assessValidators(input({ maxValidators: 0 })), "Active validators"), "4");
});
