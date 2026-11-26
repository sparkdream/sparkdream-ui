import { test } from "node:test";
import assert from "node:assert/strict";
import { assessMirror, type MirrorInput, type MirrorRebuild, type MirrorSync } from "./mirrorStatus";

const NOW = Date.parse("2026-11-26T03:20:00Z");

// What the testnet mirror wrote on 2026-11-26, as archive-mirror.sh shapes it.
const sync: MirrorSync = {
  finished_at: "2026-11-26T03:06:44Z",
  chain_id: "sparkdream-test-1",
  chain_height: 244466,
  complete_to: 240000,
  tip: 244466,
  lag_blocks: 0,
  archiver_ok: true,
  vault_ok: true,
};
const rebuild: MirrorRebuild = {
  finished_at: "2026-11-23T19:59:12Z",
  ok: true,
  mode: "checkpoint",
  rebuilt_height: 208931,
  network_check: "match",
};

const input = (over: Partial<MirrorInput> = {}): MirrorInput => ({ chainId: "sparkdream-test-1", sync, rebuild, now: NOW, ...over });
const fact = (r: { facts: { label: string; value: string }[] }, label: string) =>
  r.facts.find((f) => f.label === label)?.value;

test("a recent clean sync and a passed rebuild check are working", () => {
  const got = assessMirror(input());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.facts, [
    { label: "Last sync", value: "13m ago" },
    { label: "Mirrored through block", value: "244,466" },
    { label: "Complete ranges through", value: "240,000" },
    { label: "Behind the chain", value: "0 blocks at the last sync" },
    { label: "Rebuild check", value: "Passed 2d ago, through block 208,931" },
    { label: "Rebuilt state", value: "Matches the chain" },
  ]);
});

test("a sync that is old, failed to fetch, or found the vault damaged degrades", () => {
  const stale = assessMirror(input({ now: NOW + 5 * 3_600_000 }));
  assert.equal(stale.state, "degraded");
  assert.match(stale.issues[0], /hasn't finished a sync for 5h/);
  assert.match(assessMirror(input({ sync: { ...sync, archiver_ok: false } })).issues[0], /couldn't fetch/);
  assert.match(assessMirror(input({ sync: { ...sync, vault_ok: false } })).issues[0], /damaged or incomplete/);
  assert.match(assessMirror(input({ sync: { ...sync, finished_at: undefined } })).issues[0], /doesn't say when/);
  assert.match(assessMirror(input({ sync: { ...sync, chain_id: "sparkdream-1" } })).issues[0], /is for sparkdream-1, not sparkdream-test-1/);
});

test("a failed, mismatched or long-overdue rebuild check degrades; none yet does not", () => {
  const failed = assessMirror(input({ rebuild: { ...rebuild, ok: false, network_check: "" } }));
  assert.equal(failed.state, "degraded");
  assert.equal(fact(failed, "Rebuild check"), "Failed 2d ago");
  assert.equal(fact(failed, "Rebuilt state"), undefined);
  assert.match(failed.issues[0], /rebuild check failed/);
  assert.match(assessMirror(input({ rebuild: { ...rebuild, ok: false, network_check: "MISMATCH" } })).issues[0], /differs from the chain's/);
  const overdue = assessMirror(input({ rebuild: { ...rebuild, finished_at: "2026-10-20T00:00:00Z" } }));
  assert.match(overdue.issues[0], /No rebuild check has finished for 37d/);
  const unavailable = assessMirror(input({ rebuild: { ...rebuild, network_check: "unavailable" } }));
  assert.equal(unavailable.state, "ok");
  assert.equal(fact(unavailable, "Rebuilt state"), "Not compared with the chain");
  const none = assessMirror(input({ rebuild: null }));
  assert.equal(none.state, "ok");
  assert.equal(fact(none, "Rebuild check"), "Not run yet");
});

test("free text in the documents is never shown", () => {
  const got = assessMirror(
    input({
      sync: { ...sync, rpc: "https://private.test" } as MirrorSync,
      rebuild: { ...rebuild, ok: false, error: "work dir kept at /home/secret", log: "/home/secret/log.gz" } as MirrorRebuild,
    })
  );
  assert.ok(!JSON.stringify(got).includes("secret"));
  assert.ok(!JSON.stringify(got).includes("private.test"));
});

test("a run that failed without a result after the one shown degrades; an earlier failure does not", () => {
  const got = assessMirror(input({ sync: { ...sync, last_failed_at: "2026-11-26T03:15:00Z" } }));
  assert.equal(got.state, "degraded");
  assert.equal(fact(got, "Last sync attempt"), "Failed 5m ago");
  assert.match(got.issues[0], /A sync failed 5m ago/);
  // A sync has finished since that failure.
  assert.equal(assessMirror(input({ sync: { ...sync, last_failed_at: "2026-11-26T02:00:00Z" } })).state, "ok");
  const check = assessMirror(input({ rebuild: { ...rebuild, last_failed_at: "2026-11-25T00:00:00Z" } }));
  assert.equal(check.state, "degraded");
  assert.equal(fact(check, "Last rebuild attempt"), "Failed 27h ago");
  assert.match(check.issues[0], /A rebuild check failed 27h ago/);
});
