import { test } from "node:test";
import assert from "node:assert/strict";
import { assessScanners, checkArchive, checkArchiver, checkBridges, checkIbc, checkMirror, checkArweave, checkPage, checkStorage, scannerKeys, type ScannerMeta } from "./siteStatus";

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

test("scanners: feeds, uncounted registrations and the onchain checkpoint are reported", () => {
  const got = assessScanners(
    meta({
      feedHosts: ["scan.test"],
      checkpoints: { a: 9_700, b: 9_400 },
      checkpointMaxLag: 500,
      notCounted: ["underfunded", "underfunded", "metadata unreadable"],
    })
  );
  const fact = (label: string) => got.facts.find((f) => f.label === label)?.value;
  assert.equal(fact("Verdict feed"), "scan.test");
  assert.equal(fact("Registered, not counted"), "3 (underfunded, metadata unreadable)");
  // The newest checkpoint is shown; b's is past the limit and c has none.
  assert.equal(fact("Last onchain checkpoint"), "300 blocks ago, limit 500");
  assert.equal(got.state, "degraded");
  assert.match(got.issues[0], /One scanner hasn't checkpointed on chain within the 500 blocks/);

  const fresh = assessScanners(meta({ checkpoints: {}, checkpointMaxLag: 500 }));
  assert.equal(fresh.facts.find((f) => f.label === "Last onchain checkpoint")?.value, "None yet");
  assert.equal(fresh.state, "ok");
  const untracked = assessScanners(meta({ checkpoints: { a: 1 }, checkpointMaxLag: 0 }));
  assert.equal(untracked.state, "ok");
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
  // Days left on the archive worker's session key.
  let keyDays = 20;
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
    if (url.includes("/session/v1/sessions_by_granter/op")) {
      return json({
        sessions: [
          {
            allowed_msg_types: ["/sparkdream.service.v1.MsgSubmitCheckpoint"],
            spend_limit: { amount: "5000000" },
            spent: { amount: "50000" },
            expiration: new Date(Date.now() + keyDays * 86_400_000).toISOString(),
            last_used_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
            exec_count: "10",
            max_exec_count: "1000",
          },
        ],
      });
    }
    if (url.includes("/blocks/latest")) return json({ block: { header: { height: "236000" } } });
    if (url === `https://gw.test/wallet/${wallet}/balance`) return new Response("2000000000000");
    if (url === "https://gw.test/price/5356871") return new Response("40000000000");
    if (url === "https://gw.test/graphql") {
      return json({
        data: {
          // Both queries are answered at once: the checkpoint's transaction and the wallet's newest range.
          transactions: {
            edges: [
              {
                node: {
                  tags: [{ name: "Block-Range-From", value: "230001" }, { name: "Block-Range-To", value: "240000" }],
                  block: { timestamp: 1_795_641_217 },
                  data: { size: "5356871" },
                },
              },
            ],
          },
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
  assert.match(got.facts.find((f) => f.label === "Newest upload")?.value ?? "", /^Blocks 230,001 to 240,000, /);
  assert.equal(got.facts.find((f) => f.label === "Worker funds")?.value, "2 AR, about 50 more ranges");
  // The archive worker's session key is the card's last row.
  assert.deepEqual(got.facts.at(-1), {
    label: "Session key",
    value: "Expires in 20d, last used 2h ago, 99% of its fee budget and 99% of its uses left",
  });
  // A key about to expire is said so while the archive itself is fine.
  keyDays = 1;
  const soon = await withFetch(answer, () => checkArchiver("https://lcd.test/", "sparkdream-test-1", "https://gw.test/{id}"));
  assert.equal(soon.state, "degraded");
  assert.deepEqual(soon.issues, ["The archiver's session key expires in 24h. Its operator needs to grant a new one."]);

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
    if (url.includes("/requests_by_status/arweave/REQUEST_STATUS_PENDING")) {
      return json({ requests: [{ opened_at: "960" }, { opened_at: "990" }, { opened_at: "995" }], pagination: { total: "3" } });
    }
    if (url.includes("/requests_by_operator/op")) return json({ requests: [{ claimed_at: "970", completed_at: "985" }, { claimed_at: "900" }] });
    if (url.includes("/operator_standing/arweave/op")) return json({ lapses: { count: "0" } });
    if (url.includes("/session/v1/sessions_by_granter/op")) {
      const storage = ["MsgClaimRequest", "MsgExtendClaim", "MsgCompleteRequest", "MsgDeclineRequest"].map((m) => `/sparkdream.storage.v1.${m}`);
      return json({
        sessions: [
          {
            allowed_msg_types: storage,
            spend_limit: { amount: "100" },
            spent: { amount: "50" },
            expiration: new Date(Date.now() + 10 * 86_400_000).toISOString(),
            last_used_at: new Date(Date.now() - 3 * 60_000).toISOString(),
            exec_count: "5",
            max_exec_count: "100",
          },
        ],
      });
    }
    if (url.includes("/checkpoints_by_service_type/storage-arweave")) {
      return json({ checkpoints: [{ operator: "op", height: "900", root: "10tJ9DsLQ97USrpb7xKYTW0jwXJ9IGhmjqqce6mcEP0=" }, { operator: "other", height: "999", root: "" }] });
    }
    if (url.includes("/service_type/storage-arweave")) return json({ config: { enabled: true, checkpoint_max_lag_blocks: "0" } });
    if (url.includes("/blocks/latest")) return json({ block: { header: { height: "1000" } } });
    if (url.includes("/requests_by_status/arweave/REQUEST_STATUS_CLAIMED")) return json({ requests: [], pagination: { total: "0" } });
    if (url === `https://gw.test/wallet/${wallet}/balance`) return new Response("250000000000");
    if (url === "https://gw.test/price/1") return new Response("1000000000");
    return new Response("", { status: 404 });
  };
  const got = await withFetch(answer, () => checkStorage("https://lcd.test/", "https://gw.test/{id}", {} as NodeJS.ProcessEnv));
  assert.equal(got.state, "ok", got.issues.join(" "));
  assert.deepEqual(got.facts, [
    { label: "Storage operators", value: "1 ready" },
    { label: "Approved scanners", value: "1, 1 must agree" },
    { label: "Waiting for an operator", value: "3" },
    { label: "Being copied", value: "0" },
    { label: "Operator funds", value: "0.25 AR, about 250 copies of the largest file (1 KiB)" },
    { label: "Worker last checked in", value: "100 blocks ago, limit 1,800" },
    { label: "Worker last acted", value: "15 blocks ago" },
    { label: "Longest wait", value: "40 blocks" },
    {
      label: "Session key",
      value: "Expires in 10d, last used 3m ago, 50% of its fee budget and 95% of its uses left, doesn't cover MsgSubmitCheckpoint",
    },
  ]);

  const off = await withFetch(() => new Response("{}", { status: 501 }), () => checkStorage("https://lcd.test", "https://gw.test/{id}", {} as NodeJS.ProcessEnv));
  assert.equal(off.state, "off");
  const down = await withFetch(() => new Response("", { status: 502 }), () => checkStorage("https://lcd.test", "https://gw.test/{id}", {} as NodeJS.ProcessEnv));
  assert.equal(down.state, "unreachable");
});

test("bridges: bindings, peers, operators and the chain's inactivity limit make one report", async () => {
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const last = Math.floor(Date.now() / 1000) - 3_600;
  // The verifier's overturn cooldown, unix seconds: none to begin with.
  let cooldownUntil = 0;
  const answer = (url: string) => {
    if (url.includes("/list_bridge_bindings")) {
      return json({ bridge_bindings: [{ address: "op", peer_id: "mstdn.test", protocol: "activitypub", endpoint: "https://mstdn.test/x", content_submitted: "4", last_submission_at: String(last), suspended: false }] });
    }
    if (url.includes("/list_peers")) return json({ peers: [{ id: "mstdn.test", status: "PEER_STATUS_ACTIVE" }] });
    if (url.endsWith("/federation/v1/params")) return json({ params: { rate_limit_window: "43200s", bridge_inactivity_threshold: "100" } });
    if (url.includes("/service/v1/reports_by_operator/op/federation-bridge-activitypub")) {
      // The chain returns the reports in the status asked for: one pending, one escalated, others closed.
      const status = new URL(url).searchParams.get("status_filter");
      const open = ["REPORT_STATUS_PENDING", "REPORT_STATUS_ESCALATED"];
      return json({ reports: status && open.includes(status) ? [{ status }] : [{ status: "REPORT_STATUS_AUTO_DISMISSED" }] });
    }
    if (url.includes("/rep/v1/bonded_roles_by_type/ROLE_TYPE_FEDERATION_VERIFIER")) {
      return json({ bonded_roles: [{ address: "ver", bond_status: "BONDED_ROLE_STATUS_NORMAL" }] });
    }
    if (url.endsWith("/federation/v1/verifier_activity/ver")) return json({ activity: { total_verifications: "3" } });
    if (url.endsWith("/rep/v1/role_activity/ROLE_TYPE_FEDERATION_VERIFIER/ver")) {
      return json({ role_activity: { overturn_cooldown_until: String(cooldownUntil) } });
    }
    if (url.includes("/list_federated_content?status=FEDERATED_CONTENT_STATUS_PENDING_VERIFICATION")) {
      return json({ content: [{ received_at: String(Math.floor(Date.now() / 1000) - 120) }], pagination: { total: "2" } });
    }
    if (url.endsWith("/session/v1/sessions_by_granter/ver?pagination.limit=100")) {
      return json({
        sessions: [
          {
            allowed_msg_types: ["/sparkdream.federation.v1.MsgVerifyContent"],
            spend_limit: { amount: "100" },
            spent: { amount: "0" },
            expiration: new Date(Date.now() + 14 * 86_400_000).toISOString(),
            last_used_at: "0001-01-01T00:00:00Z",
            exec_count: "0",
            max_exec_count: "100",
          },
        ],
      });
    }
    if (url.endsWith("/session/v1/sessions_by_granter/op?pagination.limit=100")) {
      return json({
        sessions: [
          {
            allowed_msg_types: ["/sparkdream.federation.v1.MsgSubmitFederatedContent"],
            spend_limit: { amount: "100" },
            spent: { amount: "10" },
            expiration: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            last_used_at: new Date(Date.now() - 3_600_000).toISOString(),
            exec_count: "1",
            max_exec_count: "100",
          },
        ],
      });
    }
    if (url.includes("/service/v1/operators")) {
      return json({
        operators: [
          { address: "op", service_type: "federation-bridge-activitypub", status: "OPERATOR_STATUS_ACTIVE", bond_amount: "1000000000" },
          { address: "op", service_type: "content-scanner", status: "OPERATOR_STATUS_UNBONDING" },
        ],
      });
    }
    return new Response("", { status: 404 });
  };
  const probed: string[] = [];
  const up = async (endpoint: string) => {
    probed.push(endpoint);
    return true;
  };
  const got = await withFetch(answer, () => checkBridges("https://lcd.test/", up));
  assert.deepEqual(probed, ["https://mstdn.test/x"]);
  assert.equal(got.state, "ok", got.issues.join(" "));
  assert.equal(got.facts[0].value, "1 of 1 working");
  assert.equal(got.facts[1].value, "activitypub, last post 60m ago");
  assert.deepEqual(got.facts[2], { label: "mstdn.test endpoint", value: "Answering" });
  const byLabel = (label: string) => got.facts.find((f) => f.label === label)?.value;
  assert.equal(byLabel("Bridge session key"), "Expires in 30d, last used 60m ago, 90% of its fee budget and 99% of its uses left");
  // One pending and one escalated report: both still open.
  assert.match(byLabel("mstdn.test operator") ?? "", /^Active, 1,000 \S+ bonded, 2 open reports$/);
  assert.equal(byLabel("mstdn.test posts"), "0 verified, 0 rejected, 0 unverified");
  assert.equal(byLabel("Verifiers"), "1 in good standing");
  assert.equal(byLabel("Posts verified"), "3");
  assert.equal(byLabel("Waiting for verification"), "2, the oldest for 2m");
  assert.equal(byLabel("Verifier session key"), "Expires in 14d, never used, 100% of its fee budget and 100% of its uses left");
  assert.equal(byLabel("Overturn cooldown"), undefined);

  // A cooldown that has passed is no lockout; one still running locks the only verifier out.
  cooldownUntil = Math.floor(Date.now() / 1000) - 60;
  assert.equal((await withFetch(answer, () => checkBridges("https://lcd.test/", up))).state, "ok");
  cooldownUntil = Math.floor(Date.now() / 1000) + 2 * 3_600;
  const locked = await withFetch(answer, () => checkBridges("https://lcd.test/", up));
  assert.equal(locked.state, "degraded");
  assert.match(locked.issues[0], /^The verifier is locked out after overturned verifications for another (2h|120m|119m)/);
  assert.match(locked.facts.find((f) => f.label === "Overturn cooldown")?.value ?? "", /^1 verifier locked out, the first free in /);
  cooldownUntil = 0;

  // An endpoint this server won't contact is left unchecked; one that fails is not answering.
  const unchecked = await withFetch(answer, () => checkBridges("https://lcd.test/", async () => null));
  assert.equal(unchecked.state, "ok");
  assert.equal(unchecked.facts[2].value, "Not checked");
  const dead = await withFetch(answer, () => checkBridges("https://lcd.test/", async () => false));
  assert.equal(dead.state, "degraded");
  assert.match(dead.issues[0], /mstdn.test isn't answering/);
  const broken = await withFetch(answer, () => checkBridges("https://lcd.test/", async () => Promise.reject(new Error("boom"))));
  assert.equal(broken.facts[2].value, "Not answering");

  const off = await withFetch(() => new Response("{}", { status: 501 }), () => checkBridges("https://lcd.test"));
  assert.equal(off.state, "off");
  const down = await withFetch(() => new Response("", { status: 502 }), () => checkBridges("https://lcd.test"));
  assert.equal(down.state, "unreachable");
});

test("relayer: the peer's channels, their client and waiting packets make one report", async () => {
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const updated = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const seen: string[] = [];
  const answer = (url: string) => {
    seen.push(url);
    if (url.includes("/list_peers")) {
      return json({
        peers: [
          { id: "sparkdream-dev-1", display_name: "Devnet", status: "PEER_STATUS_ACTIVE", ibc_channel_id: "channel-0", ibc_transfer_channel_id: "channel-1" },
          { id: "mstdn.test", status: "PEER_STATUS_ACTIVE", ibc_channel_id: "" },
          { id: "gone-1", status: "PEER_STATUS_REMOVED", ibc_channel_id: "channel-9" },
        ],
      });
    }
    if (url.endsWith("/federation/v1/params")) return json({ params: { ibc_port: "federation" } });
    if (url.endsWith("/client_state")) {
      return json({
        identified_client_state: {
          client_id: "07-tendermint-0",
          client_state: { latest_height: { revision_number: "1", revision_height: "622608" }, trusting_period: "1209600s" },
        },
      });
    }
    if (url.includes("/packet_commitments")) return json({ commitments: [], pagination: { total: "0" } });
    if (/\/channels\/channel-\d\/ports\/\w+$/.test(url)) return json({ channel: { state: "STATE_OPEN" } });
    if (url.endsWith("/client_status/07-tendermint-0")) return json({ status: "Active" });
    if (url.endsWith("/consensus_states/07-tendermint-0/revision/1/height/622608")) return json({ consensus_state: { timestamp: updated } });
    return new Response("", { status: 404 });
  };
  const got = await withFetch(answer, () => checkIbc("https://lcd.test/"));
  assert.equal(got.state, "ok", got.issues.join(" "));
  assert.deepEqual(got.facts.slice(0, 3), [
    { label: "Peer chain", value: "Devnet" },
    { label: "Channels", value: "federation channel-0, transfer channel-1" },
    { label: "Light client", value: "Active, updated 2h ago" },
  ]);
  // Removed peers and peers without a channel are not asked about.
  assert.ok(!seen.some((u) => u.includes("channel-9")));

  const off = await withFetch(() => new Response("{}", { status: 501 }), () => checkIbc("https://lcd.test"));
  assert.equal(off.state, "off");
  const down = await withFetch(() => new Response("", { status: 502 }), () => checkIbc("https://lcd.test"));
  assert.equal(down.state, "unreachable");
});

test("mirror: status.json and the rebuild document beside it make one report", async () => {
  const at = new Date(Date.now() - 600_000).toISOString();
  const seen: string[] = [];
  const answer = (url: string) => {
    seen.push(url);
    if (url.endsWith("/mirror/status.json")) {
      return new Response(JSON.stringify({ finished_at: at, chain_id: "c-1", tip: 100, complete_to: 90, lag_blocks: 2, archiver_ok: true, vault_ok: true }));
    }
    if (url.endsWith("/mirror/rebuild-status.json")) {
      return new Response(JSON.stringify({ finished_at: at, ok: true, rebuilt_height: 90, network_check: "match" }));
    }
    return new Response("", { status: 404 });
  };
  const got = await withFetch(answer, () => checkMirror("https://b.test/mirror/status.json", "c-1"));
  assert.equal(got.state, "ok", got.issues.join(" "));
  assert.deepEqual(seen.sort(), ["https://b.test/mirror/rebuild-status.json", "https://b.test/mirror/status.json"]);
  assert.equal(got.facts.find((f) => f.label === "Rebuild check")?.value, "Passed 10m ago, through block 90");

  // No rebuild document yet is not a failure; no status document is.
  const first = await withFetch((url) => (url.includes("rebuild") ? new Response("", { status: 404 }) : answer(url)), () => checkMirror("https://b.test/mirror/status.json", "c-1"));
  assert.equal(first.state, "ok");
  assert.equal(first.facts.find((f) => f.label === "Rebuild check")?.value, "Not run yet");
  const gone = await withFetch(() => new Response("", { status: 404 }), () => checkMirror("https://b.test/mirror/status.json", "c-1"));
  assert.equal(gone.state, "unreachable");
  const html = await withFetch(() => new Response("<html>"), () => checkMirror("https://b.test/mirror/status.json", "c-1"));
  assert.equal(html.state, "unreachable");
  assert.equal((await checkMirror("not a url", "c-1")).state, "degraded");
});

test("scanners: each worker's key is judged, and one approved for storage must also cover flagging", async () => {
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const key = (types: string[]) => ({
    sessions: [
      {
        allowed_msg_types: types,
        spend_limit: { amount: "100" },
        spent: { amount: "10" },
        expiration: new Date(Date.now() + 20 * 86_400_000).toISOString(),
        last_used_at: new Date(Date.now() - 600_000).toISOString(),
        exec_count: "1",
        max_exec_count: "100",
      },
    ],
  });
  const CHECKPOINT = "/sparkdream.service.v1.MsgSubmitCheckpoint";
  const FLAG = "/sparkdream.storage.v1.MsgFlagRemoved";
  let approved = ["scan-b"];
  let bTypes = [CHECKPOINT, FLAG];
  const answer = (url: string) => {
    if (url.includes("/storage/v1/approved_scanners")) {
      return json({ scanners: [...approved.map((scanner) => ({ scanner })), { scanner: "scan-a", stale: true }] });
    }
    if (url.includes("/sessions_by_granter/scan-a")) return json(key([CHECKPOINT]));
    if (url.includes("/sessions_by_granter/scan-b")) return json(key(bTypes));
    return new Response("", { status: 404 });
  };
  // scan-a isn't counted for storage (its approval is stale), so checkpointing is all its key needs.
  let got = await withFetch(answer, () => scannerKeys("https://lcd.test/", ["scan-a", "scan-b"]));
  assert.deepEqual(got.map((n) => n.state), ["ok", "ok"]);
  assert.doesNotMatch(got[0].value, /cover/);

  bTypes = [CHECKPOINT];
  got = await withFetch(answer, () => scannerKeys("https://lcd.test/", ["scan-a", "scan-b"]));
  assert.deepEqual(got.map((n) => n.state), ["ok", "soon"]);
  assert.equal(got[1].issue, "A scanner's session key doesn't cover MsgFlagRemoved, so the chain refuses that message from its worker.");

  // Not approved for storage, or a chain without x/storage: nothing more is asked of the key.
  approved = [];
  got = await withFetch(answer, () => scannerKeys("https://lcd.test/", ["scan-b"]));
  assert.equal(got[0].state, "ok");
  const bare = await withFetch((url) => (url.includes("approved_scanners") ? new Response("", { status: 501 }) : answer(url)), () => scannerKeys("https://lcd.test/", ["scan-b"]));
  assert.equal(bare[0].state, "ok");
  assert.deepEqual(await scannerKeys("https://lcd.test/", []), []);
});
