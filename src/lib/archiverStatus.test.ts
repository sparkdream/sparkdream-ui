import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessArchiver,
  checkpointTxId,
  leadingArchiver,
  parseArweaveTx,
  type ArchiverInput,
  type ArweaveTx,
} from "./archiverStatus";
import { archiverMetadataBytes, buildArchiverMetadata } from "./chainArchiver";
import { OperatorStatus, type Checkpoint, type Operator } from "@/types/service";

const WALLET = "10tJ9DsLQ97USrpb7xKYTW0jwXJ9IGhmjqqce6mcEP0";
const TX_ID = "uo94t4K0yA6mknk28GwNmOrM_FexblhPbxNdgeTw24g";
// The same 32 bytes as the chain's JSON carries them.
const ROOT = "uo94t4K0yA6mknk28GwNmOrM/FexblhPbxNdgeTw24g=";
const NOW = 1_800_000_000_000;

function operator(over: Partial<Operator> = {}): Operator {
  return {
    address: "sprkdrm1archiver",
    service_type: "chain-archiver",
    controller: "sprkdrm1council",
    bond_amount: "100000000",
    metadata: Buffer.from(archiverMetadataBytes(buildArchiverMetadata([WALLET]))).toString("base64"),
    status: OperatorStatus.ACTIVE,
    underfunded_since: "0",
    unbond_complete_at: "0",
    tier1_slashed_in_window: "0",
    tier1_window_start: "0",
    tier1_window_start_bond: "0",
    registered_at: "200000",
    retired_at: "0",
    total_lifetime_bond_blocks: "0",
    last_bond_block_update_at: "0",
    ...over,
  };
}

function checkpoint(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    operator: "sprkdrm1archiver",
    service_type: "chain-archiver",
    height: "230000",
    root: ROOT,
    submitted_at: "231000",
    ...over,
  };
}

function tx(over: Partial<ArweaveTx> = {}, tags: Record<string, string> = {}): ArweaveTx {
  return {
    owner: WALLET,
    minedAt: NOW - 3 * 3_600_000,
    tags: {
      "App-Name": "sparkdream-block-archive",
      "Chain-ID": "sparkdream-test-1",
      "Archive-Kind": "blocks",
      "Archive-Format": "1",
      "Block-Range-From": "220001",
      "Block-Range-To": "230000",
      ...tags,
    },
    ...over,
  };
}

function input(over: Partial<ArchiverInput> = {}): ArchiverInput {
  return {
    chainId: "sparkdream-test-1",
    maxLagBlocks: 34_560,
    operators: [operator()],
    checkpoints: [checkpoint()],
    latestHeight: 236_000,
    tx: tx(),
    now: NOW,
    ...over,
  };
}

const fact = (r: { facts: { label: string; value: string }[] }, label: string) =>
  r.facts.find((f) => f.label === label)?.value;

test("a checkpoint root is the Arweave id in base64url, and only if it is 32 bytes", () => {
  assert.equal(checkpointTxId(ROOT), TX_ID);
  assert.equal(checkpointTxId(""), "");
  assert.equal(checkpointTxId("AAAA"), "");
});

test("a recent checkpoint whose range is on Arweave under the listed wallet is ok", () => {
  const got = assessArchiver(input());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.issues, []);
  assert.equal(fact(got, "Archivers"), "1 active");
  assert.equal(fact(got, "Archived through block"), "230,000");
  assert.equal(fact(got, "Behind the chain"), "6,000 blocks, limit 34,560");
  assert.equal(fact(got, "Newest range"), "Blocks 220,001 to 230,000");
  assert.equal(fact(got, "Arweave transaction"), TX_ID);
  assert.equal(fact(got, "Signed by wallet"), WALLET);
  assert.equal(fact(got, "Stored on Arweave"), "3h ago");
});

test("no service type, or no archiver registered, is off and not a failure", () => {
  assert.equal(assessArchiver(input({ maxLagBlocks: null })).state, "off");
  const none = assessArchiver(input({ operators: [], checkpoints: [] }));
  assert.equal(none.state, "off");
  assert.match(none.issues[0], /No archiver is registered/);
  const retired = assessArchiver(input({ operators: [operator({ status: OperatorStatus.RETIRED })] }));
  assert.equal(retired.state, "off");
});

test("registered archivers that aren't active degrade", () => {
  const got = assessArchiver(input({ operators: [operator({ status: OperatorStatus.UNDERFUNDED })] }));
  assert.equal(got.state, "degraded");
  assert.match(got.issues[0], /No archiver is active \(underfunded\)/);
});

test("a checkpoint past the lag limit degrades; without a limit it is only reported", () => {
  const late = assessArchiver(input({ latestHeight: 270_000 }));
  assert.equal(late.state, "degraded");
  assert.match(late.issues[0], /40,000 blocks behind the chain, past the 34,560/);
  const untracked = assessArchiver(input({ latestHeight: 270_000, maxLagBlocks: 0 }));
  assert.equal(untracked.state, "ok");
  assert.equal(fact(untracked, "Behind the chain"), "40,000 blocks");
});

test("a new archiver has one lag window to make its first checkpoint", () => {
  const fresh = assessArchiver(input({ checkpoints: [], tx: undefined, latestHeight: 210_000 }));
  assert.equal(fresh.state, "ok");
  assert.equal(fact(fresh, "Archived through block"), "None yet");
  assert.equal(fact(fresh, "First checkpoint"), "Due within 24,560 blocks");
  const overdue = assessArchiver(input({ checkpoints: [], tx: undefined, latestHeight: 240_000 }));
  assert.equal(overdue.state, "degraded");
  assert.match(overdue.issues[0], /first checkpoint, due 5,440 blocks ago/);
});

test("a gateway that can't be asked leaves the chain's answer standing", () => {
  const got = assessArchiver(input({ tx: undefined }));
  assert.equal(got.state, "ok");
  assert.match(fact(got, "On Arweave") ?? "", /Not checked/);
});

test("a missing, mismatched, unlisted or pending transaction degrades", () => {
  assert.match(assessArchiver(input({ tx: null })).issues[0], /no record/);
  assert.match(assessArchiver(input({ tx: tx({}, { "Block-Range-To": "220000" }) })).issues[0], /isn't the block range/);
  assert.match(assessArchiver(input({ tx: tx({}, { "Chain-ID": "sparkdream-1" }) })).issues[0], /isn't the block range/);
  assert.match(assessArchiver(input({ tx: tx({ owner: "x".repeat(43) }) })).issues[0], /wallet the archiver doesn't list/);
  assert.match(assessArchiver(input({ operators: [operator({ metadata: "" })] })).issues[0], /doesn't list its Arweave wallets/);
  const pending = assessArchiver(input({ tx: tx({ minedAt: null }) }));
  assert.equal(pending.state, "degraded");
  assert.equal(fact(pending, "Stored on Arweave"), "Pending");
  assert.match(assessArchiver(input({ checkpoints: [checkpoint({ root: "" })] })).issues[0], /doesn't name an Arweave transaction/);
});

test("the leader is the active archiver whose checkpoint reaches furthest", () => {
  const ops = [
    operator({ address: "a" }),
    operator({ address: "b" }),
    operator({ address: "c", status: OperatorStatus.UNBONDING }),
  ];
  const cps = [
    checkpoint({ operator: "a", height: "210000" }),
    checkpoint({ operator: "b", height: "230000" }),
    checkpoint({ operator: "c", height: "250000" }),
  ];
  assert.equal(leadingArchiver(ops, cps)?.operator.address, "b");
  assert.equal(fact(assessArchiver(input({ operators: ops, checkpoints: cps })), "Archivers"), "2 active");
  assert.equal(leadingArchiver([], cps), null);
});

test("a gateway's GraphQL answer: found, absent, or not an answer", () => {
  const found = parseArweaveTx({
    data: {
      transaction: {
        owner: { address: WALLET },
        tags: [{ name: "Chain-ID", value: "sparkdream-test-1" }, { name: "Chain-ID", value: "other" }],
        block: { timestamp: 1_795_583_418 },
      },
    },
  });
  assert.deepEqual(found, { owner: WALLET, tags: { "Chain-ID": "sparkdream-test-1" }, minedAt: 1_795_583_418_000 });
  assert.equal(parseArweaveTx({ data: { transaction: null } }), null);
  assert.equal(parseArweaveTx({ errors: [{ message: "nope" }] }), undefined);
  assert.equal(parseArweaveTx("<html>"), undefined);
});
