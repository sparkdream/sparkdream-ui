import { test } from "node:test";
import assert from "node:assert/strict";
import { assessGov, type GovInput, type GovProposal } from "./govStatus";

const NOW = Date.parse("2026-11-26T06:00:00Z");
const HOUR = 3_600_000;

function proposal(over: Partial<GovProposal> = {}): GovProposal {
  return {
    id: "7",
    status: "PROPOSAL_STATUS_VOTING_PERIOD",
    votingStart: NOW - 2 * HOUR,
    votingEnd: NOW + 4 * HOUR,
    turnout: 1,
    ...over,
  };
}

function input(over: Partial<GovInput> = {}): GovInput {
  return {
    voting: [proposal()],
    inDeposit: 0,
    failed: [],
    quorum: 0.334,
    upgrade: null,
    latestHeight: 246_000,
    latestBlockAt: NOW - 5_000,
    now: NOW,
    ...over,
  };
}

const fact = (r: { facts: { label: string; value: string }[] }, label: string) =>
  r.facts.find((f) => f.label === label)?.value;

test("with nothing needing action the card carries a count, not the Governance page's list", () => {
  const got = assessGov(input());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.facts, [{ label: "In voting", value: "1" }]);
  const quiet = assessGov(input({ voting: [] }));
  assert.equal(quiet.state, "ok");
  assert.deepEqual(quiet.facts, [{ label: "In voting", value: "0" }]);
  assert.equal(fact(assessGov(input({ inDeposit: 2 })), "Collecting a deposit"), "2");
});

test("a chain without governance is off", () => {
  assert.equal(assessGov(input({ voting: null })).state, "off");
});

test("a proposal late in its voting period without quorum needs votes", () => {
  // A 6h period with 1h left and 10% voted.
  const late = assessGov(input({ voting: [proposal({ votingStart: NOW - 5 * HOUR, votingEnd: NOW + HOUR, turnout: 0.1 })] }));
  assert.equal(late.state, "degraded");
  assert.equal(late.issues[0], "Proposal #7 ends in 60m with 10% of the voting power voted. It needs 33.4%, or it fails.");
  // Early in its period the same turnout is just how voting begins.
  assert.equal(assessGov(input({ voting: [proposal({ turnout: 0 })] })).state, "ok");
  // Late with quorum reached, or with the turnout unread: nothing to say.
  assert.equal(assessGov(input({ voting: [proposal({ votingStart: NOW - 5 * HOUR, votingEnd: NOW + HOUR, turnout: 0.4 })] })).state, "ok");
  const unread = assessGov(input({ voting: [proposal({ votingStart: NOW - 5 * HOUR, votingEnd: NOW + HOUR, turnout: null })] }));
  assert.equal(unread.state, "ok");
});

test("every proposal short of quorum late in its period is named, however many are in voting", () => {
  const voting = [1, 2, 3, 4, 5].map((i) =>
    proposal({ id: String(10 + i), votingStart: NOW - 5 * HOUR, votingEnd: NOW + HOUR, turnout: i === 3 ? 0.5 : 0.1 })
  );
  const got = assessGov(input({ voting }));
  assert.equal(fact(got, "In voting"), "5");
  assert.equal(got.facts.length, 1);
  assert.equal(got.issues.length, 4);
});

test("a proposal that failed when carried out is a problem for a week, whatever was decided after it", () => {
  const failed = (id: string, hours: number) => proposal({ id, status: "PROPOSAL_STATUS_FAILED", votingEnd: NOW - hours * HOUR });
  const got = assessGov(input({ failed: [failed("9", 5)] }));
  assert.equal(got.state, "degraded");
  assert.match(got.issues[0], /^Proposal #9 passed its vote but failed when the chain carried it out/);
  // Two this week are both said; one from before is history.
  const several = assessGov(input({ failed: [failed("9", 5), failed("8", 30), failed("3", 10 * 24)] }));
  assert.equal(several.issues.length, 2);
  assert.equal(assessGov(input({ failed: [failed("3", 10 * 24)] })).state, "ok");
});

test("a scheduled upgrade is shown, and a chain standing at its height is waiting for it", () => {
  const upgrade = { name: "forum-category-index", height: 250_000 };
  const ahead = assessGov(input({ upgrade }));
  assert.equal(ahead.state, "ok");
  assert.equal(fact(ahead, "Scheduled upgrade"), "forum-category-index at block 250,000, in 4,000 blocks");

  // The last block before the upgrade height, and none since.
  const halted = assessGov(input({ upgrade, latestHeight: 249_999, latestBlockAt: NOW - 10 * 60_000 }));
  assert.equal(halted.state, "degraded");
  assert.match(halted.issues[0], /^The chain has stopped at block 250,000 for the upgrade "forum-category-index"/);
  // Still making blocks right up to it is not a halt, and a stall elsewhere is the Chain section's to report.
  assert.equal(assessGov(input({ upgrade, latestHeight: 249_999, latestBlockAt: NOW - 5_000 })).state, "ok");
  assert.equal(assessGov(input({ upgrade, latestHeight: 246_000, latestBlockAt: NOW - 10 * 60_000 })).state, "ok");
  assert.equal(fact(assessGov(input({ upgrade, latestHeight: null })), "Scheduled upgrade"), "forum-category-index at block 250,000");
});
