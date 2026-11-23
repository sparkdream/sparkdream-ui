import { test } from "node:test";
import assert from "node:assert/strict";
import { assessNode, checkChain, type NodeFacts } from "./serviceStatus";
import { isChainDown } from "./chainStatus";

const NOW = Date.parse("2026-11-23T14:00:00Z");

function facts(over: Partial<NodeFacts> = {}): NodeFacts {
  return {
    chainId: "sparkdream-test-1",
    moniker: "sentry-0",
    appVersion: "v1.1.1",
    cometVersion: "0.38.19",
    height: "1000",
    blockTime: NOW - 6_000,
    syncing: false,
    ...over,
  };
}

test("a node on the right chain with a fresh block is ok", () => {
  const got = assessNode(facts(), "sparkdream-test-1", NOW);
  assert.equal(got.state, "ok");
  assert.deepEqual(got.issues, []);
  assert.equal(got.blockAgeMs, 6_000);
});

test("a stalled, syncing or wrong-chain node is degraded, with a reason for each", () => {
  const got = assessNode(
    facts({ chainId: "sparkdream-dev-1", syncing: true, blockTime: NOW - 10 * 60_000 }),
    "sparkdream-test-1",
    NOW
  );
  assert.equal(got.state, "degraded");
  assert.equal(got.issues.length, 3);
  assert.match(got.issues[0], /sparkdream-dev-1/);
  assert.match(got.issues[2], /10m old/);
});

// A stub of both endpoints. `lcdHeight`/`rpcHeight` null means that endpoint
// refuses the connection.
function stubFetch(opts: { lcdHeight: string | null; rpcHeight: string | null; lcdStatus?: number }) {
  const time = new Date(NOW - 5_000).toISOString();
  const headers = { date: new Date(NOW).toUTCString() };
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers });
    if (url.startsWith("/api/lcd")) {
      if (opts.lcdHeight === null) throw new TypeError("fetch failed");
      if (opts.lcdStatus) return new Response("{}", { status: opts.lcdStatus, headers });
      if (url.endsWith("/node_info")) {
        return json({
          default_node_info: { network: "sparkdream-test-1", moniker: "sentry-0", version: "0.38.19" },
          application_version: { version: "v1.1.1" },
        });
      }
      if (url.endsWith("/blocks/latest")) return json({ block: { header: { height: opts.lcdHeight, time } } });
      if (url.endsWith("/syncing")) return json({ syncing: false });
    }
    if (url === "https://rpc.test/status") {
      if (opts.rpcHeight === null) throw new TypeError("fetch failed");
      return json({
        result: {
          node_info: { network: "sparkdream-test-1", moniker: "sentry-0", version: "0.38.19" },
          sync_info: { latest_block_height: opts.rpcHeight, latest_block_time: time, catching_up: false },
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

const input = { lcdBase: "/api/lcd", rpcEndpoint: "https://rpc.test/", chainId: "sparkdream-test-1", clock: () => NOW };

test("both endpoints healthy: facts are read from each and the banner is cleared", async () => {
  const got = await checkChain({ ...input, fetchImpl: stubFetch({ lcdHeight: "1000", rpcHeight: "1001" }) });
  assert.equal(got.lcd.state, "ok");
  assert.equal(got.rpc.state, "ok");
  assert.equal(got.lcd.facts?.appVersion, "v1.1.1");
  assert.equal(got.rpc.facts?.height, "1001");
  assert.equal(got.lcd.blockAgeMs, 5_000);
  assert.equal(isChainDown(), false);
});

test("an unreachable LCD raises the banner while the RPC is still reported", async () => {
  const got = await checkChain({ ...input, fetchImpl: stubFetch({ lcdHeight: null, rpcHeight: "1001" }) });
  assert.equal(got.lcd.state, "unreachable");
  assert.equal(got.lcd.facts, null);
  assert.equal(got.rpc.state, "ok");
  assert.equal(isChainDown(), true);
});

test("a gateway error is unreachable, an error from the node itself is degraded", async () => {
  const gateway = await checkChain({ ...input, fetchImpl: stubFetch({ lcdHeight: "1", rpcHeight: "1", lcdStatus: 503 }) });
  assert.equal(gateway.lcd.state, "unreachable");
  const node = await checkChain({ ...input, fetchImpl: stubFetch({ lcdHeight: "1", rpcHeight: "1", lcdStatus: 500 }) });
  assert.equal(node.lcd.state, "degraded");
  assert.match(node.lcd.issues[0], /HTTP 500/);
});

test("the endpoint that is many blocks behind the other is flagged", async () => {
  const got = await checkChain({ ...input, fetchImpl: stubFetch({ lcdHeight: "900", rpcHeight: "1000" }) });
  assert.equal(got.lcd.state, "degraded");
  assert.match(got.lcd.issues[0], /100 blocks behind the RPC/);
  assert.equal(got.rpc.state, "ok");
});
