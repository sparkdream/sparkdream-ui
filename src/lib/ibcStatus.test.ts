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
