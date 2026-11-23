import { test } from "node:test";
import assert from "node:assert/strict";
import { assessScanners, checkArchive, checkArweave, checkPage, type ScannerMeta } from "./siteStatus";

function meta(over: Partial<ScannerMeta> = {}): ScannerMeta {
  return {
    workers: ["a", "b", "c"],
    quorum: 2,
    heights: { a: 9_900, b: 9_800, c: 0 },
    latestHeight: 10_000,
    maxLagBlocks: 1_800,
    errors: {},
    imagesDisabled: false,
    ...over,
  };
}

test("scanners: a quorum within the freshness limit is ok, measured at the quorum's height", () => {
  const got = assessScanners(meta());
  assert.equal(got.state, "ok");
  assert.deepEqual(got.issues, []);
  // Two must agree, so the second most advanced worker sets the lag.
  assert.match(got.facts[1].value, /^200 blocks/);
});

test("scanners: a chain without scanning is off, not a failure", () => {
  assert.equal(assessScanners(meta({ quorum: 0, workers: [] })).state, "off");
});

test("scanners: too few workers, a stale quorum, unread feeds and the image switch each degrade", () => {
  assert.match(assessScanners(meta({ workers: ["a"] })).issues[0], /Only 1 of the 2 scanners needed is active/);
  assert.match(assessScanners(meta({ heights: { a: 9_900, b: 5_000 } })).issues[0], /5,000 blocks behind/);
  assert.match(assessScanners(meta({ heights: { a: 9_900 } })).issues[0], /unknown/);
  assert.match(assessScanners(meta({ errors: { b: "404" } })).issues[0], /One scanner feed/);
  const off = assessScanners(meta({ imagesDisabled: true }));
  assert.equal(off.state, "degraded");
  assert.match(off.issues[0], /switched off/);
});

async function withFetch<T>(impl: (url: string) => Response | Promise<Response>, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => impl(String(input))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("a page: 200 is ok, a gateway error unreachable, its own error degraded", async () => {
  const at = (status: number) => withFetch(() => new Response("", { status }), () => checkPage("explorer", "https://e.test/x"));
  assert.equal((await at(200)).state, "ok");
  assert.equal((await at(522)).state, "unreachable");
  assert.equal((await at(500)).state, "degraded");
  const down = await withFetch(() => {
    throw new TypeError("fetch failed");
  }, () => checkPage("explorer", "https://e.test/x"));
  assert.equal(down.state, "unreachable");
});

test("arweave: the gateway's origin is asked for /info and the height reported", async () => {
  const seen: string[] = [];
  const got = await withFetch((url) => {
    seen.push(url);
    return new Response(JSON.stringify({ height: 2048281 }), { status: 200 });
  }, () => checkArweave("https://gw.test/raw/{id}"));
  assert.deepEqual(seen, ["https://gw.test/info"]);
  assert.equal(got.state, "ok");
  assert.deepEqual(got.facts, [
    { label: "Gateway", value: "gw.test" },
    { label: "Arweave height", value: "2,048,281" },
  ]);
  // A gateway without /info is still up.
  const plain = await withFetch(() => new Response("nope", { status: 404 }), () => checkArweave("https://gw.test/{id}"));
  assert.equal(plain.state, "ok");
});

test("archive: the snapshot list must be readable", async () => {
  const ok = await withFetch(() => new Response(JSON.stringify({ snapshots: [{}, {}] })), () => checkArchive("https://s.test/m.json"));
  assert.equal(ok.state, "ok");
  assert.equal(ok.facts[0].value, "2");
  const bad = await withFetch(() => new Response("<html>"), () => checkArchive("https://s.test/m.json"));
  assert.equal(bad.state, "degraded");
});
