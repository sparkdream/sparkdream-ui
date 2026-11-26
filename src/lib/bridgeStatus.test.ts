import { test } from "node:test";
import assert from "node:assert/strict";
import { assessBridges, type BridgeInput } from "./bridgeStatus";
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
    last_submission_at: String(NOW / 1000 - 3 * DAY),
    suspended: false,
    ...over,
  } as BridgeBinding;
}

function operator(over: Partial<Operator> = {}): Operator {
  return { address: "op", service_type: "federation-bridge-activitypub", status: OperatorStatus.ACTIVE, ...over } as Operator;
}

function input(over: Partial<BridgeInput> = {}): BridgeInput {
  return {
    bindings: [binding()],
    peers: { "mstdn.test": "PEER_STATUS_ACTIVE" },
    operators: [operator()],
    inactivitySeconds: 50 * DAY,
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

test("many bridges are summarised by the counts alone", () => {
  const bindings = Array.from({ length: 6 }, (_, i) => binding({ peer_id: `p${i}` }));
  const got = assessBridges(input({ bindings, peers: {} }));
  assert.deepEqual(got.facts.map((f) => f.label), ["Bridges", "Posts brought in"]);
  assert.equal(got.facts[1].value, "72");
});
