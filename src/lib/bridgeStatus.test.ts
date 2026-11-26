import { test } from "node:test";
import assert from "node:assert/strict";
import { assessBridges, canVerify, type BridgeInput, type VerifierInput } from "./bridgeStatus";
import { OperatorStatus, type Operator } from "@/types/service";
import type { BridgeBinding } from "@/types/federation";

const NOW = 1_800_000_000_000;
const DAY = 86_400;

function binding(over: Partial<BridgeBinding> = {}): BridgeBinding {
  return {
    address: "op",
    peer_id: "mstdn.test",
    protocol: "activitypub",
    endpoint: "https://mstdn.test",
    registered_at: "1",
    content_submitted: "12",
    content_verified: "9",
    content_rejected: "0",
    content_unverified: "3",
    epoch_rejected: "0",
    last_submission_at: String(NOW / 1000 - 3 * DAY),
    suspended: false,
    ...over,
  } as BridgeBinding;
}

function operator(over: Partial<Operator> = {}): Operator {
  return {
    address: "op",
    service_type: "federation-bridge-activitypub",
    status: OperatorStatus.ACTIVE,
    bond_amount: "1000000000",
    ...over,
  } as Operator;
}

function input(over: Partial<BridgeInput> = {}): BridgeInput {
  return {
    bindings: [binding()],
    peers: { "mstdn.test": "PEER_STATUS_ACTIVE" },
    operators: [operator()],
    inactivitySeconds: 50 * DAY,
    bondSymbol: "SPARK",
    now: NOW,
    ...over,
  };
}

test("an unsuspended bridge with an active operator and peer is working", () => {
  const got = assessBridges(input());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.facts, [
    { label: "Bridges", value: "1 of 1 working" },
    { label: "mstdn.test", value: "activitypub, last post 3d ago" },
    { label: "mstdn.test endpoint", value: "Not checked" },
    { label: "mstdn.test operator", value: "Active, 1,000 SPARK bonded" },
    { label: "mstdn.test posts", value: "9 verified, 0 rejected, 3 unverified" },
    { label: "Posts brought in", value: "12" },
  ]);
});

test("no x/federation and no bridges are off", () => {
  assert.equal(assessBridges(input({ bindings: null })).state, "off");
  const none = assessBridges(input({ bindings: [] }));
  assert.equal(none.state, "off");
  assert.match(none.issues[0], /No federation bridge is registered/);
});

test("a suspended binding, an inactive or missing operator and an inactive peer each degrade", () => {
  assert.match(assessBridges(input({ bindings: [binding({ suspended: true })] })).issues[0], /suspended/);
  assert.match(
    assessBridges(input({ operators: [operator({ status: OperatorStatus.UNBONDING })] })).issues[0],
    /no active operator \(unbonding\)/
  );
  assert.match(assessBridges(input({ operators: [] })).issues[0], /no active operator \(not registered\)/);
  const peer = assessBridges(input({ peers: { "mstdn.test": "PEER_STATUS_SUSPENDED" } }));
  assert.equal(peer.state, "degraded");
  assert.match(peer.issues[0], /peer mstdn.test is not active/);
  assert.equal(peer.facts[0].value, "0 of 1 working");
});

test("silence past the chain's limit degrades; a bridge that never submitted does not", () => {
  const quiet = assessBridges(input({ bindings: [binding({ last_submission_at: String(NOW / 1000 - 60 * DAY) })] }));
  assert.equal(quiet.state, "degraded");
  assert.match(quiet.issues[0], /brought nothing in for 60d, past the chain's inactivity limit/);
  assert.equal(assessBridges(input({ inactivitySeconds: 0, bindings: [binding({ last_submission_at: "1" })] })).state, "ok");
  const fresh = assessBridges(input({ bindings: [binding({ last_submission_at: "0", content_submitted: "0" })] }));
  assert.equal(fresh.state, "ok");
  assert.equal(fresh.facts[1].value, "activitypub, nothing brought in yet");
});

test("an endpoint that doesn't answer degrades; an unchecked one does not", () => {
  const up = assessBridges(input({ reachable: { "https://mstdn.test": true } }));
  assert.equal(up.state, "ok");
  assert.equal(up.facts[2].value, "Answering");
  const down = assessBridges(input({ reachable: { "https://mstdn.test": false } }));
  assert.equal(down.state, "degraded");
  assert.equal(down.facts[0].value, "0 of 1 working");
  assert.equal(down.facts[2].value, "Not answering");
  assert.match(down.issues[0], /mstdn.test isn't answering, so the bridge to mstdn.test has nothing to bring in/);
  assert.equal(assessBridges(input({ reachable: { "https://mstdn.test": null } })).state, "ok");
});

test("an address bridging under two types counts as active if either record is", () => {
  const got = assessBridges(
    input({ operators: [operator(), operator({ service_type: "federation-bridge-nostr", status: OperatorStatus.UNBONDING })] })
  );
  assert.equal(got.state, "ok");
});

test("with many broken bridges the verifiers' problem is still said", () => {
  const bindings = Array.from({ length: 8 }, (_, i) => binding({ peer_id: `p${i}`, suspended: true }));
  const got = assessBridges(input({ bindings, peers: {}, verifiers: verifiers({ holders: 0, able: 0 }) }));
  assert.equal(got.issues.length, 6);
  assert.match(got.issues[5], /No federation verifier/);
});

test("many bridges are summarised by the counts alone", () => {
  const bindings = Array.from({ length: 6 }, (_, i) => binding({ peer_id: `p${i}` }));
  const got = assessBridges(input({ bindings, peers: {} }));
  assert.deepEqual(got.facts.map((f) => f.label), ["Bridges", "Posts brought in"]);
  assert.equal(got.facts[1].value, "72");
});

const verifiers = (over: Partial<VerifierInput> = {}): VerifierInput => ({
  holders: 1,
  able: 1,
  verified: 7,
  pending: 0,
  oldestPendingAt: null,
  ...over,
});
const row = (r: { facts: { label: string; value: string }[] }, label: string) =>
  r.facts.find((f) => f.label === label)?.value;

test("a verifier in good standing with nothing waiting is working", () => {
  const got = assessBridges(input({ verifiers: verifiers() }));
  assert.equal(got.state, "ok");
  assert.equal(row(got, "Verifiers"), "1 in good standing");
  assert.equal(row(got, "Posts verified"), "7");
  assert.equal(row(got, "Waiting for verification"), "0");
  // Without the verifiers' side read, the card says nothing of it.
  assert.equal(row(assessBridges(input()), "Verifiers"), undefined);
});

test("no verifier the chain lets verify degrades", () => {
  const none = assessBridges(input({ verifiers: verifiers({ holders: 0, able: 0 }) }));
  assert.equal(none.state, "degraded");
  assert.match(none.issues[0], /No federation verifier is bonded and in good standing/);
  assert.equal(row(none, "Verifiers"), "0 in good standing");
  const unable = assessBridges(input({ verifiers: verifiers({ holders: 2, able: 0 }) }));
  assert.equal(unable.state, "degraded");
  assert.equal(row(unable, "Verifiers"), "0 of 2 in good standing");
  const mixed = assessBridges(input({ verifiers: verifiers({ holders: 2, able: 1 }) }));
  assert.equal(mixed.state, "ok");
  assert.equal(row(mixed, "Verifiers"), "1 of 2 in good standing");
});

test("who may verify follows the chain: normal, recovery, and unbonding while the staying bond covers the minimum", () => {
  const min = "500000000";
  assert.equal(canVerify({ bond_status: "BONDED_ROLE_STATUS_NORMAL" }, min), true);
  assert.equal(canVerify({ bond_status: "BONDED_ROLE_STATUS_RECOVERY", current_bond: "1" }, min), true);
  assert.equal(canVerify({ bond_status: "BONDED_ROLE_STATUS_DEMOTED", current_bond: "900000000" }, min), false);
  // A partial withdrawal keeps the verifier working; a full exit does not.
  const unbonding = { bond_status: "BONDED_ROLE_STATUS_UNBONDING", current_bond: "800000000" };
  assert.equal(canVerify({ ...unbonding, pending_unbond_amount: "300000000" }, min), true);
  assert.equal(canVerify({ ...unbonding, pending_unbond_amount: "800000000" }, min), false);
  assert.equal(canVerify({ ...unbonding, pending_unbond_amount: "" }, min), true);
  assert.equal(canVerify({}, min), false);
});

test("posts left waiting past an hour mean the verifier has probably stopped", () => {
  const fresh = assessBridges(input({ verifiers: verifiers({ pending: 2, oldestPendingAt: NOW - 10 * 60_000 }) }));
  assert.equal(fresh.state, "ok");
  assert.equal(row(fresh, "Waiting for verification"), "2, the oldest for 10m");
  const stuck = assessBridges(input({ verifiers: verifiers({ pending: 2, oldestPendingAt: NOW - 3 * 3_600_000 }) }));
  assert.equal(stuck.state, "degraded");
  assert.match(stuck.issues[0], /2 bridged posts have waited up to 3h for verification, so the verifier has probably stopped/);
  assert.match(
    assessBridges(input({ verifiers: verifiers({ pending: 1, oldestPendingAt: NOW - 3 * 3_600_000 }) })).issues[0],
    /A bridged post has waited/
  );
  // Unread counts add no row and no problem.
  const blind = assessBridges(input({ verifiers: verifiers({ pending: null, verified: null }) }));
  assert.equal(blind.state, "ok");
  assert.equal(row(blind, "Waiting for verification"), undefined);
  assert.equal(row(blind, "Posts verified"), undefined);
});

test("a verifier locked out by the overturn cooldown is shown; all of them locked out degrades", () => {
  const some = assessBridges(input({ verifiers: verifiers({ holders: 2, able: 2, cooling: 1, coolingEndsAt: NOW + 5 * 3_600_000 }) }));
  assert.equal(some.state, "ok");
  assert.equal(row(some, "Overturn cooldown"), "1 verifier locked out, the first free in 5h");

  const all = assessBridges(input({ verifiers: verifiers({ cooling: 1, coolingEndsAt: NOW + 5 * 3_600_000 }) }));
  assert.equal(all.state, "degraded");
  assert.equal(all.issues[0], "The verifier is locked out after overturned verifications for another 5h, so what the bridges bring in waits unverified.");
  assert.match(
    assessBridges(input({ verifiers: verifiers({ holders: 3, able: 2, cooling: 2, coolingEndsAt: null }) })).issues[0],
    /^Every verifier is locked out after overturned verifications, so/
  );
  // Posts waiting are explained by the lockout, not put down to a stopped daemon.
  const waiting = assessBridges(
    input({ verifiers: verifiers({ cooling: 1, coolingEndsAt: NOW + 3_600_000, pending: 2, oldestPendingAt: NOW - 3 * 3_600_000 }) })
  );
  assert.equal(waiting.issues.length, 1);
  assert.match(waiting.issues[0], /locked out/);

  // None locked out, or the cooldowns unread: no row, no problem.
  for (const cooling of [0, null, undefined]) {
    const got = assessBridges(input({ verifiers: verifiers({ cooling }) }));
    assert.equal(got.state, "ok");
    assert.equal(row(got, "Overturn cooldown"), undefined);
  }
});

test("the operator behind a bridge: its standing, its bond, and reports nobody has resolved", () => {
  const reported = assessBridges(input({ openReports: { op: 2 } }));
  assert.equal(row(reported, "mstdn.test operator"), "Active, 1,000 SPARK bonded, 2 open reports");
  // A report is an allegation: shown, and the bridge still counts as working.
  assert.equal(reported.state, "ok");
  assert.equal(row(assessBridges(input({ openReports: { op: 1 } })), "mstdn.test operator"), "Active, 1,000 SPARK bonded, 1 open report");
  assert.equal(row(assessBridges(input({ openReports: { op: null } })), "mstdn.test operator"), "Active, 1,000 SPARK bonded");

  const unbonding = assessBridges(input({ operators: [operator({ status: OperatorStatus.UNBONDING, bond_amount: "1500500000" })] }));
  assert.equal(row(unbonding, "mstdn.test operator"), "Unbonding, 1,500 SPARK bonded");
  assert.equal(row(assessBridges(input({ operators: [] })), "mstdn.test operator"), "Not registered");
  assert.equal(row(assessBridges(input({ bondSymbol: undefined })), "mstdn.test operator"), "Active, 1,000 bonded");
});

test("a post rejected on verification in the current period degrades the bridge", () => {
  const got = assessBridges(input({ bindings: [binding({ content_rejected: "4", epoch_rejected: "2" })] }));
  assert.equal(got.state, "degraded");
  assert.equal(got.facts[0].value, "0 of 1 working");
  assert.equal(row(got, "mstdn.test posts"), "9 verified, 4 rejected, 3 unverified");
  assert.equal(got.issues[0], "2 posts from the bridge to mstdn.test were rejected on verification in the current reward period.");
  // Rejections of an earlier period are history: counted in the row, not a present fault.
  const past = assessBridges(input({ bindings: [binding({ content_rejected: "4" })] }));
  assert.equal(past.state, "ok");
  // A bridge already not working is not counted out twice.
  const both = assessBridges(input({ bindings: [binding({ suspended: true, epoch_rejected: "1" })] }));
  assert.equal(both.facts[0].value, "0 of 1 working");
  assert.equal(both.issues.length, 2);
  assert.match(both.issues[1], /^A post from the bridge to mstdn.test was rejected/);
});
