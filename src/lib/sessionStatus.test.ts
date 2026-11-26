import { test } from "node:test";
import assert from "node:assert/strict";
import { assessSession, rememberExpiry, withSessions, type ExpiryMemory, type SessionNote } from "./sessionStatus";
import type { ServiceReport } from "./serviceStatus";
import type { Session } from "@/types/session";

const NOW = Date.parse("2026-11-26T04:00:00Z");
const MSG = "/sparkdream.service.v1.MsgSubmitCheckpoint";

// The testnet scanner's session on 2026-11-26.
function session(over: Partial<Session> = {}): Session {
  return {
    granter: "op",
    grantee: "key",
    allowed_msg_types: [MSG],
    spend_limit: { denom: "uspark", amount: "25000000" },
    spent: { denom: "uspark", amount: "1070000" },
    expiration: "2026-12-21T23:06:46Z",
    created_at: "2026-11-21T23:16:48Z",
    last_used_at: "2026-11-26T03:40:33Z",
    exec_count: "107",
    max_exec_count: "10000",
    ...over,
  };
}

const judge = (over: Partial<Session> = {}) => assessSession([session(over)], MSG, "The scanner's", NOW);

test("a session with time, budget and uses left is ok and says what is left", () => {
  const got = judge();
  assert.equal(got.state, "ok");
  assert.equal(got.issue, null);
  assert.equal(got.value, "Expires in 26d, last used 19m ago, 95% of its fee budget and 98% of its uses left");
  assert.match(judge({ last_used_at: "0001-01-01T00:00:00Z" }).value, /never used/);
});

test("an expired, spent or used-up session is dead", () => {
  const expired = judge({ expiration: "2026-11-24T04:00:00Z" });
  assert.equal(expired.state, "dead");
  assert.match(expired.issue ?? "", /The scanner's session key expired 2d ago/);
  assert.match(expired.value, /^Expired 2d ago/);
  assert.match(judge({ spent: { denom: "uspark", amount: "25000000" } }).issue ?? "", /spent its fee budget/);
  assert.match(judge({ exec_count: "10000" }).issue ?? "", /used up its uses/);
});

test("a session near its end is flagged while it still works", () => {
  const soon = judge({ expiration: "2026-11-27T04:00:00Z" });
  assert.equal(soon.state, "soon");
  assert.match(soon.issue ?? "", /expires in 24h/);
  assert.match(judge({ spent: { denom: "uspark", amount: "24500000" } }).issue ?? "", /2% of its fee budget left/);
  assert.match(judge({ exec_count: "9900" }).issue ?? "", /1% of its uses left/);
  assert.equal(judge({ expiration: "2026-11-30T04:00:00Z" }).state, "ok");
});

test("only sessions covering the worker's message count, and the best of several is judged", () => {
  const other = assessSession([session({ allowed_msg_types: ["/other.Msg"] })], MSG, "The scanner's", NOW);
  assert.equal(other.state, "none");
  assert.equal(other.issue, null);
  assert.equal(assessSession([], MSG, "The scanner's", NOW).state, "none");
  // An expired key beside its replacement is not a problem.
  const renewed = assessSession([session({ expiration: "2026-11-01T00:00:00Z" }), session()], MSG, "The scanner's", NOW);
  assert.equal(renewed.state, "ok");
});

const report = (state: ServiceReport["state"] = "ok"): ServiceReport => ({
  id: "x",
  state,
  issues: state === "ok" ? [] : ["already"],
  latency_ms: null,
  facts: [{ label: "A", value: "1" }],
});
const note = (state: SessionNote["state"], value: string = state): SessionNote => ({
  state,
  value,
  issue: state === "dead" || state === "soon" ? `${state} key` : null,
});

test("a card gains one row, and an issue for a key that is dead or nearly so", () => {
  const ok = withSessions(report(), [note("ok", "Expires in 26d")]);
  assert.equal(ok.state, "ok");
  assert.deepEqual(ok.facts[1], { label: "Session key", value: "Expires in 26d" });
  const dead = withSessions(report(), [note("dead")]);
  assert.equal(dead.state, "degraded");
  assert.deepEqual(dead.issues, ["dead key"]);
  // A missing session is shown and is not a failure: the operator may sign itself.
  const none = withSessions(report(), [note("none", "None for its messages")]);
  assert.equal(none.state, "ok");
  assert.equal(none.facts[1].value, "None for its messages");
  assert.equal(assessSession([], MSG, "The scanner's", NOW).value, "None on chain for its messages");
});

test("several keys are counted, the row describes the one nearest its end, and other states are kept", () => {
  const got = withSessions(report(), [note("ok", "Expires in 26d"), note("soon", "Expires in 2d"), note("none")]);
  assert.equal(got.facts[1].label, "Session keys");
  assert.equal(got.facts[1].value, "2 of 2 usable. Nearest its end: expires in 2d");
  assert.deepEqual(got.issues, ["soon key"]);
  assert.equal(withSessions(report("unreachable"), [note("dead")]).issues.length, 1);
  assert.equal(withSessions(report("off"), [note("dead")]).facts.length, 1);
  assert.equal(withSessions(report("degraded"), [note("dead")]).issues.length, 2);
  assert.equal(withSessions(report(), []).facts.length, 1);
});

test("a key the chain removed at its expiry is reported as expired if it was seen before", () => {
  const memory: ExpiryMemory = new Map();
  const check = (sessions: Session[], now: number) =>
    rememberExpiry(memory, "op|" + MSG, sessions, MSG, assessSession(sessions, MSG, "The scanner's", now), "The scanner's", now);
  const expiry = Date.parse("2026-12-21T23:06:46Z");

  // Never seen: absent is all that can be said.
  assert.equal(check([], NOW).state, "none");
  assert.equal(check([session()], NOW).state, "ok");
  // The chain removes it in the block it expires.
  const gone = check([], expiry + 2 * 3_600_000);
  assert.equal(gone.state, "dead");
  assert.equal(gone.value, "Expired 2h ago");
  assert.match(gone.issue ?? "", /The scanner's session key expired 2h ago/);
  // It stays reported until a new key is granted.
  assert.equal(check([], expiry + 30 * 3_600_000).state, "dead");
  assert.equal(check([session({ expiration: "2027-02-01T00:00:00Z" })], expiry + 31 * 3_600_000).state, "ok");
});

test("a key that vanished before its expiry was revoked or replaced: absent, and forgotten", () => {
  const memory: ExpiryMemory = new Map();
  const none = assessSession([], MSG, "The scanner's", NOW);
  rememberExpiry(memory, "k", [session()], MSG, assessSession([session()], MSG, "The scanner's", NOW), "The scanner's", NOW);
  assert.equal(rememberExpiry(memory, "k", [], MSG, none, "The scanner's", NOW + 1000).state, "none");
  assert.equal(memory.has("k"), false);
});
