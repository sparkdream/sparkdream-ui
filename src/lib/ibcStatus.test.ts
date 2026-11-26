import { test } from "node:test";
import assert from "node:assert/strict";
import { assessIbc, type IbcInput, type IbcLink } from "./ibcStatus";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function link(over: Partial<IbcLink> = {}): IbcLink {
  return {
    peer: "Spark Dream Devnet",
    channels: [
      { port: "federation", id: "channel-0", state: "STATE_OPEN", pending: 0 },
      { port: "transfer", id: "channel-1", state: "STATE_OPEN", pending: 0 },
    ],
    clientStatus: "Active",
    updatedAt: NOW - 3 * HOUR,
    trustingSeconds: 14 * 86_400,
    ...over,
  };
}

const input = (over: Partial<IbcInput> = {}): IbcInput => ({ links: [link()], now: NOW, ...over });
const fact = (r: { facts: { label: string; value: string }[] }, label: string) =>
  r.facts.find((f) => f.label === label)?.value;

test("open channels and a recently updated active client are working", () => {
  const got = assessIbc(input());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.facts, [
    { label: "Peer chain", value: "Spark Dream Devnet" },
    { label: "Channels", value: "federation channel-0, transfer channel-1" },
    { label: "Light client", value: "Active, updated 3h ago" },
    { label: "Client expires", value: "In 14d unless updated" },
    { label: "Packets waiting", value: "0" },
  ]);
});

test("no federation module and no linked peer are off", () => {
  assert.equal(assessIbc(input({ links: null })).state, "off");
  assert.equal(assessIbc(input({ links: [] })).state, "off");
});

test("an expired, frozen or unreadable client degrades", () => {
  const expired = assessIbc(input({ links: [link({ clientStatus: "Expired", updatedAt: NOW - 20 * DAY })] }));
  assert.equal(expired.state, "degraded");
  assert.match(expired.issues[0], /has expired/);
  assert.equal(fact(expired, "Light client"), "Expired, updated 20d ago");
  assert.equal(fact(expired, "Client expires"), undefined);
  assert.match(assessIbc(input({ links: [link({ clientStatus: "Frozen" })] })).issues[0], /frozen/);
  assert.match(assessIbc(input({ links: [link({ clientStatus: null, updatedAt: null })] })).issues[0], /couldn't be read/);
});

test("a client left past two thirds of its trusting period means the relayer has stopped", () => {
  assert.equal(assessIbc(input({ links: [link({ updatedAt: NOW - 9 * DAY })] })).state, "ok");
  const late = assessIbc(input({ links: [link({ updatedAt: NOW - 10 * DAY })] }));
  assert.equal(late.state, "degraded");
  assert.match(late.issues[0], /hasn't updated the light client of Spark Dream Devnet for 10d. It expires in 4d/);
});

test("packets waiting while the client stands still are stuck; fresh ones are not", () => {
  const waiting = (pending: number, age: number) =>
    assessIbc(
      input({
        links: [link({ updatedAt: NOW - age, channels: [{ port: "transfer", id: "channel-1", state: "STATE_OPEN", pending }] })],
      })
    );
  assert.equal(waiting(2, 10 * 60_000).state, "ok");
  const stuck = waiting(2, 2 * HOUR);
  assert.equal(stuck.state, "degraded");
  assert.match(stuck.issues[0], /2 packets to Spark Dream Devnet are waiting and the relayer has delivered nothing for 2h/);
  assert.equal(fact(stuck, "Packets waiting"), "2");
  assert.match(waiting(1, 2 * HOUR).issues[0], /1 packet to Spark Dream Devnet is waiting/);
});

test("a channel that isn't open degrades and is named", () => {
  const got = assessIbc(
    input({ links: [link({ channels: [{ port: "transfer", id: "channel-1", state: "STATE_CLOSED", pending: null }] })] })
  );
  assert.equal(got.state, "degraded");
  assert.match(got.issues[0], /transfer channel to Spark Dream Devnet \(channel-1\) is closed/);
  assert.equal(fact(got, "Channels"), "transfer channel-1 (closed)");
  assert.equal(fact(got, "Packets waiting"), undefined);
});

test("several peers are counted and their rows named", () => {
  const got = assessIbc(input({ links: [link(), link({ peer: "Other", clientStatus: "Expired" })] }));
  assert.equal(fact(got, "Peer chains"), "1 of 2 working");
  assert.equal(fact(got, "Other: light client"), "Expired, updated 3h ago");
  assert.equal(fact(got, "Peer chain"), undefined);
});

const relayer = (balance: string | null, lastFee: string | null = "8404") => ({
  address: "sprkdrm1relayer",
  denom: "uspark",
  balance,
  lastFee,
});
const fee = { denom: "uspark", symbol: "SPARK" };

test("the relayer's account and what it can still pay for are shown", () => {
  const got = assessIbc(input({ fee, links: [link({ relayer: relayer("9856694") })] }));
  assert.equal(got.state, "ok");
  assert.equal(fact(got, "Relayer"), "sprkdrm1relayer");
  assert.equal(fact(got, "Relayer funds"), "9.85 SPARK, about 1,172 more transactions");
  // An unknown fee leaves the balance alone; an unread balance leaves the row out.
  assert.equal(fact(assessIbc(input({ fee, links: [link({ relayer: relayer("12000000", null) })] })), "Relayer funds"), "12 SPARK");
  const unread = assessIbc(input({ links: [link({ relayer: relayer(null) })] }));
  assert.equal(fact(unread, "Relayer"), "sprkdrm1relayer");
  assert.equal(fact(unread, "Relayer funds"), undefined);
  assert.match(fact(assessIbc(input({ links: [link({ relayer: relayer("900000000000", "1") })] })), "Relayer funds") ?? "", /over 10,000 more transactions/);
  // A relayer paying in some other denomination has its amounts shown as they are.
  const other = assessIbc(input({ fee, links: [link({ relayer: { ...relayer("9856694"), denom: "ibc/ABC" } })] }));
  assert.equal(fact(other, "Relayer funds"), "9,856,694 ibc/ABC, about 1,172 more transactions");
  assert.equal(fact(assessIbc(input({ links: [link({ relayer: relayer("9856694") })] })), "Relayer funds"), "9,856,694 uspark, about 1,172 more transactions");
  // No relayer found (no update in the node's index): no rows.
  assert.equal(fact(assessIbc(input({ links: [link({ relayer: null })] })), "Relayer"), undefined);
});

test("a relayer running out of fees is said ahead of time; one that can't pay is not working", () => {
  const low = assessIbc(input({ links: [link({ relayer: relayer("100000") })] }));
  assert.equal(low.state, "degraded");
  assert.match(low.issues[0], /has fees for about 11 more transactions. It needs funding/);
  const empty = assessIbc(input({ links: [link({ relayer: relayer("5000") })] }));
  assert.equal(empty.state, "degraded");
  assert.match(empty.issues[0], /can't pay for a transaction, so nothing is relayed until it is funded/);
  assert.match(assessIbc(input({ links: [link({ relayer: relayer("0", null) })] })).issues[0], /can't pay/);
  // Counted as not working once, with or without another problem.
  const two = assessIbc(input({ links: [link(), link({ peer: "Other", relayer: relayer("0") })] }));
  assert.equal(fact(two, "Peer chains"), "1 of 2 working");
  const both = assessIbc(input({ links: [link(), link({ peer: "Other", clientStatus: "Expired", relayer: relayer("0") })] }));
  assert.equal(fact(both, "Peer chains"), "1 of 2 working");
});

test("the relayer's account on the peer chain is shown beside the one here, in the peer's own denomination", () => {
  const peerFee = { denom: "usparz", symbol: "SPARZ" };
  const there = { address: "sprkdrm1relayer", denom: "usparz", balance: "25000000", lastFee: "0" };
  const got = assessIbc(input({ fee, links: [link({ relayer: relayer("9856694"), peerRelayer: there, peerFee })] }));
  assert.equal(got.state, "ok");
  assert.equal(fact(got, "Relayer funds"), "9.85 SPARK, about 1,172 more transactions");
  assert.equal(fact(got, "Relayer on the peer"), "sprkdrm1relayer");
  // A chain that charged no fee gives no count of transactions.
  assert.equal(fact(got, "Its funds there"), "25 SPARZ");

  const empty = assessIbc(input({ fee, links: [link({ relayer: relayer("9856694"), peerRelayer: { ...there, balance: "0" }, peerFee })] }));
  assert.equal(empty.state, "degraded");
  assert.equal(empty.issues[0], "The relayer's account on Spark Dream Devnet can't pay for a transaction, so nothing is delivered there until it is funded.");
  const low = assessIbc(input({ fee, links: [link({ peerRelayer: { ...there, balance: "50000", lastFee: "5000" }, peerFee })] }));
  assert.match(low.issues[0], /account on Spark Dream Devnet has fees for about 10 more transactions/);
  // Both accounts short: the link is counted out once.
  const both = assessIbc(input({ fee, links: [link(), link({ peer: "Other", relayer: relayer("0"), peerRelayer: { ...there, balance: "0" }, peerFee })] }));
  assert.equal(fact(both, "Peer chains"), "1 of 2 working");
  assert.equal(both.issues.length, 2);
  // Where the peer's API isn't known, nothing is said of its side.
  assert.equal(fact(assessIbc(input({ links: [link({ peerRelayer: null })] })), "Relayer on the peer"), undefined);
});

test("a peer chain behind what the light client has seen of it was reset: the link is dead", () => {
  const got = assessIbc(input({ links: [link({ clientHeight: 622_608, peerHeight: 211_334 })] }));
  assert.equal(got.state, "degraded");
  assert.equal(got.issues.length, 1);
  assert.match(got.issues[0], /^Spark Dream Devnet is at block 211,334, behind block 622,608 .* was reset since, .* a new connection is needed\.$/);
  assert.equal(fact(got, "Peer chain height"), "211,334, the light client has seen 622,608");
  // The client still reads Active for days after a reset: that is not reported as well.
  const stale = assessIbc(input({ links: [link({ clientHeight: 622_608, peerHeight: 211_334, updatedAt: NOW - 12 * DAY })] }));
  assert.equal(stale.issues.length, 1);

  // A node a few blocks behind the one the relayer reads is not a reset.
  assert.equal(assessIbc(input({ links: [link({ clientHeight: 622_608, peerHeight: 622_600 })] })).state, "ok");
  assert.equal(assessIbc(input({ links: [link({ clientHeight: 622_608, peerHeight: 622_000 })] })).state, "ok");
  assert.equal(assessIbc(input({ links: [link({ clientHeight: 622_608, peerHeight: 620_000 })] })).state, "degraded");

  // A peer ahead of the client is the ordinary case; an unread height says nothing.
  const ahead = assessIbc(input({ links: [link({ clientHeight: 622_608, peerHeight: 700_000 })] }));
  assert.equal(ahead.state, "ok");
  assert.equal(fact(ahead, "Peer chain height"), "700,000, the light client has seen 622,608");
  const unread = assessIbc(input({ links: [link({ clientHeight: 622_608, peerHeight: null })] }));
  assert.equal(unread.state, "ok");
  assert.equal(fact(unread, "Peer chain height"), undefined);
});

test("the peer's light client of this chain is shown and judged like the one here", () => {
  const client = (over = {}) => ({ status: "Active", updatedAt: NOW - 2 * HOUR, trustingSeconds: 14 * 86_400, ...over });
  const got = assessIbc(input({ links: [link({ peerClient: client() })] }));
  assert.equal(got.state, "ok");
  assert.equal(fact(got, "Peer's light client"), "Active, updated 2h ago");
  assert.equal(fact(got, "Peer's client expires"), "In 14d unless updated");

  const expired = assessIbc(input({ links: [link({ peerClient: client({ status: "Expired", updatedAt: NOW - 20 * DAY }) })] }));
  assert.equal(expired.state, "degraded");
  assert.match(expired.issues[0], /^Spark Dream Devnet's light client of this chain has expired/);
  assert.equal(fact(expired, "Peer's light client"), "Expired, updated 20d ago");
  assert.equal(fact(expired, "Peer's client expires"), undefined);
  assert.match(assessIbc(input({ links: [link({ peerClient: client({ status: "Frozen" }) })] })).issues[0], /is frozen/);

  const late = assessIbc(input({ links: [link({ peerClient: client({ updatedAt: NOW - 10 * DAY }) })] }));
  assert.equal(late.state, "degraded");
  assert.match(late.issues[0], /hasn't updated Spark Dream Devnet's light client of this chain for 10d. It expires in 4d/);
  // Both halves stale: two problems, and the link counted out once.
  const both = assessIbc(input({ links: [link(), link({ peer: "Other", updatedAt: NOW - 10 * DAY, peerClient: client({ updatedAt: NOW - 10 * DAY }) })] }));
  assert.equal(both.issues.length, 2);
  assert.equal(fact(both, "Peer chains"), "1 of 2 working");

  // Unreadable, or no such client on the peer: shown, not judged.
  const missing = assessIbc(input({ links: [link({ peerClient: client({ status: "Unknown", updatedAt: null }) })] }));
  assert.equal(missing.state, "ok");
  assert.equal(fact(missing, "Peer's light client"), "Not found on the peer");
  assert.equal(fact(assessIbc(input({ links: [link({ peerClient: client({ status: null, updatedAt: null }) })] })), "Peer's light client"), "Unreadable");
  assert.equal(fact(assessIbc(input({ links: [link({ peerClient: null })] })), "Peer's light client"), undefined);
});

test("after a reset the peer's missing client is explained by the reset, not reported again", () => {
  const got = assessIbc(
    input({ links: [link({ clientHeight: 622_608, peerHeight: 211_334, peerClient: { status: "Expired", updatedAt: null, trustingSeconds: 0 } })] })
  );
  assert.equal(got.issues.length, 1);
  assert.match(got.issues[0], /was reset since/);
});

test("this chain behind what the peer's light client has seen of it was reset itself", () => {
  const seen = (height: number | null) => ({ status: "Active", updatedAt: NOW - 12 * DAY, trustingSeconds: 14 * 86_400, height });
  const got = assessIbc(input({ thisHeight: 40_000, links: [link({ peerClient: seen(300_000) })] }));
  assert.equal(got.state, "degraded");
  // One problem: the peer's stale client is a consequence, not a second fault.
  assert.equal(got.issues.length, 1);
  assert.match(got.issues[0], /^This chain is at block 40,000, behind block 300,000 that Spark Dream Devnet's light client has already seen of it\. This chain was reset since/);
  assert.equal(fact(got, "This chain's height"), "40,000, the peer's light client has seen 300,000");

  // Ahead of the peer's client is the ordinary case, and a few blocks behind is one node lagging another.
  const fresh = { status: "Active", updatedAt: NOW - HOUR, trustingSeconds: 14 * 86_400 };
  assert.equal(assessIbc(input({ thisHeight: 300_500, links: [link({ peerClient: { ...fresh, height: 300_000 } })] })).state, "ok");
  assert.equal(assessIbc(input({ thisHeight: 299_990, links: [link({ peerClient: { ...fresh, height: 300_000 } })] })).state, "ok");
  // Unread on either side: nothing is concluded and no row is shown.
  for (const [thisHeight, height] of [[null, 300_000], [40_000, null]] as const) {
    const blind = assessIbc(input({ thisHeight, links: [link({ peerClient: { ...fresh, height } })] }));
    assert.equal(blind.state, "ok");
    assert.equal(fact(blind, "This chain's height"), undefined);
  }
  // A reset of the peer is said as that, not as both.
  const peerReset = assessIbc(
    input({ thisHeight: 40_000, links: [link({ clientHeight: 622_608, peerHeight: 211_334, peerClient: { ...fresh, height: 300_000 } })] })
  );
  assert.equal(peerReset.issues.length, 1);
  assert.match(peerReset.issues[0], /^Spark Dream Devnet is at block/);
});
