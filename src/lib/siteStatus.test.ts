import { test } from "node:test";
import assert from "node:assert/strict";
import { assessScanners, checkArchive, checkArchiver, checkArweave, checkPage, checkStorage, type ScannerMeta } from "./siteStatus";

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

test("archiver: the chain's checkpoint and the gateway's index make one report", async () => {
  const wallet = "10tJ9DsLQ97USrpb7xKYTW0jwXJ9IGhmjqqce6mcEP0";
  const metadata = Buffer.from(JSON.stringify({ v: 1, backend: "arweave", wallets: [wallet] })).toString("base64");
  const seen: string[] = [];
  const answer = (url: string) => {
    seen.push(url);
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (url.includes("/service_type/")) return json({ config: { enabled: true, checkpoint_max_lag_blocks: "34560" } });
    if (url.includes("/operators_by_service_type/")) {
      return json({ operators: [{ address: "op", status: "OPERATOR_STATUS_ACTIVE", metadata, registered_at: "1" }] });
    }
    if (url.includes("/checkpoints_by_service_type/")) {
      return json({ checkpoints: [{ operator: "op", height: "230000", root: "uo94t4K0yA6mknk28GwNmOrM/FexblhPbxNdgeTw24g=" }] });
    }
    if (url.includes("/blocks/latest")) return json({ block: { header: { height: "236000" } } });
    if (url === "https://gw.test/graphql") {
      return json({
        data: {
          transaction: {
            owner: { address: wallet },
            block: { timestamp: 1_795_583_418 },
            tags: [
              { name: "App-Name", value: "sparkdream-block-archive" },
              { name: "Chain-ID", value: "sparkdream-test-1" },
              { name: "Archive-Kind", value: "blocks" },
              { name: "Archive-Format", value: "1" },
              { name: "Block-Range-From", value: "220001" },
              { name: "Block-Range-To", value: "230000" },
            ],
          },
        },
      });
    }
    return new Response("", { status: 404 });
  };
  const got = await withFetch(answer, () => checkArchiver("https://lcd.test/", "sparkdream-test-1", "https://gw.test/{id}"));
  assert.equal(got.state, "ok", got.issues.join(" "));
  assert.ok(seen.includes("https://lcd.test/sparkdream/service/v1/service_type/chain-archiver"));
  assert.ok(seen.includes("https://gw.test/graphql"));
  assert.equal(got.facts.find((f) => f.label === "Archived through block")?.value, "230,000");

  // A chain without the service type is off, and the gateway is never asked.
  seen.length = 0;
  const off = await withFetch(
    (url) => {
      seen.push(url);
      return new Response("{}", { status: 404 });
    },
    () => checkArchiver("https://lcd.test", "sparkdream-test-1", "https://gw.test/{id}")
  );
  assert.equal(off.state, "off");
  assert.ok(!seen.includes("https://gw.test/graphql"));

  const down = await withFetch(() => new Response("", { status: 502 }), () => checkArchiver("https://lcd.test", "c", "https://gw.test/{id}"));
  assert.equal(down.state, "unreachable");
});

test("storage: the chain's lists and the wallet's balance make one report", async () => {
  const wallet = "10tJ9DsLQ97USrpb7xKYTW0jwXJ9IGhmjqqce6mcEP0";
  const metadata = Buffer.from(JSON.stringify({ v: 1, backend: "arweave", wallets: [wallet] })).toString("base64");
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const answer = (url: string) => {
    if (url.endsWith("/storage/v1/params")) return json({ params: { enabled: true } });
    if (url.endsWith("/storage/v1/backends")) {
      return json({ backends: [{ name: "arweave", service_type: "storage-arweave", enabled: true, types: [{ content_type: "image/png", scanned: true, max_size: "1" }] }] });
    }
    if (url.includes("/operators_by_service_type/storage-arweave")) {
      return json({ operators: [{ address: "op", status: "OPERATOR_STATUS_ACTIVE", metadata }] });
    }
    if (url.includes("/approved_operators/arweave")) return json({ operators: [{ backend: "arweave", operator: "op", controller: "c" }] });
    if (url.includes("/operators_by_service_type/content-scanner")) return json({ operators: [{ address: "scan", status: "OPERATOR_STATUS_ACTIVE" }] });
    if (url.includes("/approved_scanners")) return json({ scanners: [{ scanner: "scan", controller: "c" }] });
    if (url.includes("/service_type/content-scanner")) return json({ config: { enabled: true, attestation_quorum: 1 } });
    if (url.includes("/requests_by_status/arweave/REQUEST_STATUS_PENDING")) return json({ requests: [], pagination: { total: "3" } });
    if (url.includes("/requests_by_status/arweave/REQUEST_STATUS_CLAIMED")) return json({ requests: [], pagination: { total: "0" } });
    if (url === `https://gw.test/wallet/${wallet}/balance`) return new Response("250000000000");
    return new Response("", { status: 404 });
  };
  const got = await withFetch(answer, () => checkStorage("https://lcd.test/", "https://gw.test/{id}", {} as NodeJS.ProcessEnv));
  assert.equal(got.state, "ok", got.issues.join(" "));
  assert.deepEqual(got.facts, [
    { label: "Storage operators", value: "1 ready" },
    { label: "Approved scanners", value: "1, 1 must agree" },
    { label: "Waiting for an operator", value: "3" },
    { label: "Being copied", value: "0" },
    { label: "Operator funds", value: "0.25 AR" },
  ]);

  const off = await withFetch(() => new Response("{}", { status: 501 }), () => checkStorage("https://lcd.test", "https://gw.test/{id}", {} as NodeJS.ProcessEnv));
  assert.equal(off.state, "off");
  const down = await withFetch(() => new Response("", { status: 502 }), () => checkStorage("https://lcd.test", "https://gw.test/{id}", {} as NodeJS.ProcessEnv));
  assert.equal(down.state, "unreachable");
});
