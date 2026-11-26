import { test } from "node:test";
import assert from "node:assert/strict";
import { assessStorage, checkpointWallet, readyOperators, type StorageInput } from "./storageStatus";
import { OperatorStatus, type Operator } from "@/types/service";
import type { StorageBackend } from "@/types/storage";

const WALLET = "10tJ9DsLQ97USrpb7xKYTW0jwXJ9IGhmjqqce6mcEP0";
const meta = (wallets: string[]) => Buffer.from(JSON.stringify({ v: 1, backend: "arweave", wallets })).toString("base64");

function operator(over: Partial<Operator> = {}): Operator {
  return {
    address: "op",
    service_type: "storage-arweave",
    controller: "council",
    bond_amount: "1000000000",
    metadata: meta([WALLET]),
    status: OperatorStatus.ACTIVE,
    underfunded_since: "0",
    unbond_complete_at: "0",
    tier1_slashed_in_window: "0",
    tier1_window_start: "0",
    tier1_window_start_bond: "0",
    registered_at: "1",
    retired_at: "0",
    total_lifetime_bond_blocks: "0",
    last_bond_block_update_at: "0",
    ...over,
  };
}

const backend = {
  name: "arweave",
  service_type: "storage-arweave",
  enabled: true,
  types: [{ content_type: "image/png", scanned: true, max_size: "10485760" }],
} as StorageBackend;

function input(over: Partial<StorageInput> = {}): StorageInput {
  return {
    enabled: true,
    backend,
    operators: [operator()],
    approvedOperators: [{ backend: "arweave", operator: "op", controller: "council" }],
    scanners: [operator({ address: "scan", service_type: "content-scanner" })],
    approvedScanners: [{ scanner: "scan", controller: "council" }],
    scannerQuorum: 1,
    pending: 2,
    claimed: 1,
    balances: { [WALLET]: "1500000000000" },
    siteOffers: true,
    ...over,
  };
}

const fact = (r: { facts: { label: string; value: string }[] }, label: string) =>
  r.facts.find((f) => f.label === label)?.value;

test("an approved, active, funded operator with a scanner quorum is ok", () => {
  const got = assessStorage(input());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.issues, []);
  assert.equal(fact(got, "Storage operators"), "1 ready");
  assert.equal(fact(got, "Approved scanners"), "1, 1 must agree");
  assert.equal(fact(got, "Waiting for an operator"), "2");
  assert.equal(fact(got, "Being copied"), "1");
  assert.equal(fact(got, "Operator funds"), "1.5 AR");
});

test("no x/storage, a switched-off module or backend, or no operator at all is off", () => {
  assert.equal(assessStorage(input({ enabled: null, backend: null })).state, "off");
  assert.equal(assessStorage(input({ enabled: false })).state, "off");
  assert.equal(assessStorage(input({ backend: { ...backend, enabled: false } })).state, "off");
  const none = assessStorage(input({ operators: [], approvedOperators: [] }));
  assert.equal(none.state, "off");
  assert.match(none.issues[0], /No storage operator is registered/);
  assert.equal(assessStorage(input({ operators: [operator({ status: OperatorStatus.RETIRED })] })).state, "off");
});

test("an operator that is unapproved, stale or inactive is not ready", () => {
  const unapproved = assessStorage(input({ approvedOperators: [] }));
  assert.equal(unapproved.state, "degraded");
  assert.match(unapproved.issues[0], /No storage operator is approved for the arweave backend/);
  const stale = assessStorage(input({ approvedOperators: [{ backend: "arweave", operator: "op", controller: "old", stale: true }] }));
  assert.match(stale.issues[0], /approved/);
  const inactive = assessStorage(input({ operators: [operator({ status: OperatorStatus.UNDERFUNDED })] }));
  assert.match(inactive.issues[0], /No storage operator is active \(underfunded\)/);
  assert.equal(fact(inactive, "Operator funds"), undefined);
  assert.deepEqual(readyOperators([operator(), operator({ address: "b" })], [{ backend: "arweave", operator: "op", controller: "c" }]).map((o) => o.address), ["op"]);
});

test("too few approved scanners degrade, and only for scanned types", () => {
  const few = assessStorage(input({ approvedScanners: [] }));
  assert.equal(few.state, "degraded");
  assert.match(few.issues[0], /Only 0 of the 1 content scanners needed are approved/);
  assert.match(assessStorage(input({ scannerQuorum: 0 })).issues[0], /scanning isn't set up/);
  const inactive = assessStorage(input({ scanners: [operator({ address: "scan", status: OperatorStatus.UNBONDING })] }));
  assert.equal(inactive.state, "degraded");
  const unscanned = assessStorage(
    input({ approvedScanners: [], backend: { ...backend, types: [{ content_type: "image/png", max_size: "1" }] } })
  );
  assert.equal(unscanned.state, "ok");
  assert.equal(fact(unscanned, "Approved scanners"), undefined);
});

test("empty or unlisted wallets degrade; an unanswered balance does not", () => {
  assert.match(assessStorage(input({ balances: { [WALLET]: "0" } })).issues[0], /wallets are empty/);
  assert.match(assessStorage(input({ operators: [operator({ metadata: "" })] })).issues[0], /lists an Arweave wallet/);
  const unknown = assessStorage(input({ balances: { [WALLET]: null } }));
  assert.equal(unknown.state, "ok");
  assert.match(fact(unknown, "Operator funds") ?? "", /Not checked/);
});

test("the site's switch degrades, and unread request counts are left out", () => {
  const off = assessStorage(input({ siteOffers: false }));
  assert.equal(off.state, "degraded");
  assert.match(off.issues[0], /switched off by the site operator/);
  assert.equal(fact(assessStorage(input({ pending: null })), "Waiting for an operator"), undefined);
});

const worker = (over: Partial<NonNullable<StorageInput["worker"]>> = {}) => ({
  latestHeight: 10_000,
  lastActedAt: 9_900,
  lapses: 0,
  oldestWaitingSince: 9_950,
  stuckAfterBlocks: 1_440,
  checkpoint: null,
  checkpointMaxLag: 0,
  ...over,
});

test("the worker's last action and the longest wait are shown", () => {
  const got = assessStorage(input({ worker: worker() }));
  assert.equal(got.state, "ok");
  assert.equal(fact(got, "Worker last acted"), "100 blocks ago");
  assert.equal(fact(got, "Worker last checked in"), "Never");
  assert.equal(fact(got, "Longest wait"), "50 blocks");
  const idle = assessStorage(input({ worker: worker({ lastActedAt: null, oldestWaitingSince: null }) }));
  assert.equal(idle.state, "ok");
  assert.equal(fact(idle, "Worker last acted"), "No claim or copy on record");
  assert.equal(fact(idle, "Longest wait"), undefined);
});

test("a long wait with no operator acting since may be a stopped worker; a worker that acted since is not", () => {
  const stuck = assessStorage(input({ worker: worker({ oldestWaitingSince: 8_000, lastActedAt: 7_000 }) }));
  assert.equal(stuck.state, "degraded");
  assert.match(stuck.issues[0], /waited 2,000 blocks and no operator has acted since it was opened. The worker may be stopped/);
  assert.equal(assessStorage(input({ worker: worker({ oldestWaitingSince: 8_000, lastActedAt: null }) })).state, "degraded");
  // It took another request after this one opened: it is running and left this one alone.
  assert.equal(assessStorage(input({ worker: worker({ oldestWaitingSince: 8_000, lastActedAt: 9_000 }) })).state, "ok");
  // Within one claim window nothing is concluded.
  assert.equal(assessStorage(input({ worker: worker({ oldestWaitingSince: 9_000, lastActedAt: null }) })).state, "ok");
});

test("lapsed claims degrade, and worker evidence is left out without a ready operator", () => {
  const lapsed = assessStorage(input({ worker: worker({ lapses: 2 }) }));
  assert.equal(lapsed.state, "degraded");
  assert.equal(fact(lapsed, "Lapsed claims"), "2");
  assert.match(lapsed.issues[0], /2 claims were left to lapse/);
  const none = assessStorage(input({ approvedOperators: [], worker: worker({ lapses: 2 }) }));
  assert.equal(fact(none, "Worker last acted"), undefined);
  assert.equal(none.issues.length, 1);
});

test("a worker that checks in is running; one that stopped checking in has stopped", () => {
  const live = assessStorage(input({ worker: worker({ checkpoint: { height: 9_700, wallet: WALLET } }) }));
  assert.equal(live.state, "ok");
  assert.equal(fact(live, "Worker last checked in"), "300 blocks ago, limit 1,800");
  const stopped = assessStorage(input({ worker: worker({ checkpoint: { height: 7_000, wallet: WALLET } }) }));
  assert.equal(stopped.state, "degraded");
  assert.match(stopped.issues[0], /last checked in 3,000 blocks ago, so it has probably stopped/);
  // The chain's own limit, when the type has one, replaces the default.
  const strict = assessStorage(input({ worker: worker({ checkpoint: { height: 9_700, wallet: WALLET }, checkpointMaxLag: 200 }) }));
  assert.equal(strict.state, "degraded");
  assert.equal(fact(strict, "Worker last checked in"), "300 blocks ago, limit 200");
});

test("a worker that checks in is not suspected over a long wait, and its wallet must be a listed one", () => {
  const waiting = assessStorage(
    input({ worker: worker({ oldestWaitingSince: 8_000, lastActedAt: null, checkpoint: { height: 9_900, wallet: WALLET } }) })
  );
  assert.equal(waiting.state, "ok");
  const other = assessStorage(input({ worker: worker({ checkpoint: { height: 9_900, wallet: "x".repeat(43) } }) }));
  assert.equal(other.state, "degraded");
  assert.match(other.issues[0], /wallet its operator doesn't list/);
});

test("a checkpoint root is the wallet address it encodes", () => {
  assert.equal(checkpointWallet("10tJ9DsLQ97USrpb7xKYTW0jwXJ9IGhmjqqce6mcEP0="), WALLET);
  assert.equal(checkpointWallet("uo94t4K0yA6mknk28GwNmOrM/FexblhPbxNdgeTw24g="), "uo94t4K0yA6mknk28GwNmOrM_FexblhPbxNdgeTw24g");
  assert.equal(checkpointWallet("AAAA"), "");
});
