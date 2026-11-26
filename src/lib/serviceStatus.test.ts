import { test } from "node:test";
import assert from "node:assert/strict";
import { assessNode, checkChain, type NodeFacts,
  describeLive,
  probeLive,
  rpcWebsocketUrl,
} from "./serviceStatus";
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

// A websocket as the probe drives it. `script` plays the server's part.
function fakeSocket(script: (s: { open(): void; message(data: unknown): void; error(): void; close(): void }) => void) {
  const sent: string[] = [];
  let closed = 0;
  const create = (url: string) => {
    const socket = {
      url,
      onopen: null as ((ev: unknown) => void) | null,
      onmessage: null as ((ev: { data: unknown }) => void) | null,
      onerror: null as ((ev: unknown) => void) | null,
      onclose: null as ((ev: unknown) => void) | null,
      send: (data: string) => void sent.push(data),
      close: () => void closed++,
    };
    queueMicrotask(() =>
      script({
        open: () => socket.onopen?.({}),
        message: (data) => socket.onmessage?.({ data }),
        error: () => socket.onerror?.({}),
        close: () => socket.onclose?.({}),
      })
    );
    return socket as never;
  };
  return { create, sent, closes: () => closed };
}

test("the live connection: the ticker's address, its subscription, and a block arriving", async () => {
  assert.equal(rpcWebsocketUrl("https://rpc.test/"), "wss://rpc.test/websocket");
  assert.equal(rpcWebsocketUrl("http://127.0.0.1:26657"), "ws://127.0.0.1:26657/websocket");
  const block = JSON.stringify({ result: { data: { value: { block: { header: { height: "42" } } } } } });
  const fake = fakeSocket((s) => {
    s.open();
    s.message(JSON.stringify({ jsonrpc: "2.0", id: 0, result: {} })); // the subscription's acknowledgement
    s.message("not json");
    s.message(block);
  });
  const got = await probeLive("https://rpc.test", { create: fake.create, timeoutMs: 1000 });
  assert.equal(got.state, "blocks");
  assert.ok(got.ms !== null);
  assert.match(fake.sent[0], /"method":"subscribe".*tm\.event='NewBlock'/);
  assert.equal(fake.closes(), 1);
  assert.match(describeLive(got).value, /^Connected, new blocks arriving/);
  assert.equal(describeLive(got).issue, null);
});

test("the live connection: open but silent, and not opening at all", async () => {
  const silent = await probeLive("https://rpc.test", { create: fakeSocket((s) => s.open()).create, timeoutMs: 30 });
  assert.equal(silent.state, "silent");
  assert.match(describeLive(silent).issue ?? "", /opened but delivered no block/);
  // Closed from the other end before a block: said as that, not as twenty silent seconds.
  const dropped = await probeLive("https://rpc.test", { create: fakeSocket((s) => (s.open(), s.close())).create, timeoutMs: 1000 });
  assert.equal(dropped.state, "dropped");
  assert.equal(describeLive(dropped).value, "Connected, then closed");
  assert.match(describeLive(dropped).issue ?? "", /closed from the other end before a block arrived/);

  // Leaving the page stops a check that is still waiting, and closes its socket.
  const leaving = new AbortController();
  const waiting = fakeSocket((s) => s.open());
  const pending = probeLive("https://rpc.test", { create: waiting.create, timeoutMs: 60_000, signal: leaving.signal });
  await new Promise((r) => setTimeout(r, 5));
  leaving.abort();
  assert.equal((await pending).state, "closed");
  assert.equal(waiting.closes(), 1);
  const gone = new AbortController();
  gone.abort();
  assert.equal((await probeLive("https://rpc.test", { create: fakeSocket(() => {}).create, signal: gone.signal })).state, "closed");

  // An error before opening is a failure at once, with or without a close after it.
  const refused = await probeLive("https://rpc.test", { create: fakeSocket((s) => s.error()).create, timeoutMs: 5000 });
  assert.equal(refused.state, "closed");
  assert.match(describeLive(refused).issue ?? "", /can't be opened/);
  const never = await probeLive("https://rpc.test", { create: fakeSocket(() => {}).create, timeoutMs: 30 });
  assert.equal(never.state, "closed");
  const throws = await probeLive("https://rpc.test", { create: () => { throw new Error("blocked"); }, timeoutMs: 1000 });
  assert.equal(throws.state, "closed");
  assert.equal(describeLive(null).value, "Checking");
});
