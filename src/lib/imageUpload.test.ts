import { test } from "node:test";
import assert from "node:assert/strict";
import { Secp256k1Wallet } from "@cosmjs/amino";
import { adr36SignDoc, verifyUploadAuth } from "./imageUpload/auth";
import {
  AUTH_MAX_AGE_MS,
  imageInfo,
  parseUploadAuthMessage,
  quotaWeek,
  sessionAllowsUpload,
  uploadAuthMessage,
  uploadProblem,
  weeklyQuota,
} from "./imageUpload/policy";
import { signS3 } from "./imageUpload/s3";
import { imageKey, memberTag, publicPolicy, uploadConfig } from "./imageUpload/server";
import { encodeRgbPng } from "./imagePrepare";

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

function png(width: number, height: number, animated = false): Uint8Array {
  const chunk = (type: string, data: number[]) => [...be32(data.length), ...bytes(type), ...data, 0, 0, 0, 0];
  return bytes(
    "\x89PNG\r\n\x1a\n",
    chunk("IHDR", [...be32(width), ...be32(height), 8, 2, 0, 0, 0]),
    animated ? chunk("acTL", [...be32(2), ...be32(0)]) : [],
    chunk("IDAT", [0]),
    chunk("IEND", [])
  );
}

function jpeg(width: number, height: number): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, 0, 4, 0, 0], // APP0, skipped by its length
    [0xff, 0xc2, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 0, 0],
    [0xff, 0xd9]
  );
}

function webp(width: number, height: number, animated = false, size = 0): Uint8Array {
  const head = bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [animated ? 0x02 : 0, 0, 0, 0], le24(width - 1), le24(height - 1));
  if (size <= head.length) return head;
  // Padded with bytes that vary, to stand for a picture of a given size.
  const out = new Uint8Array(size).map((_, i) => (i * 31 + (i >> 8)) & 255);
  out.set(head);
  return out;
}

test("imageInfo reads type and size from PNG, JPEG and WebP headers", () => {
  assert.deepEqual(imageInfo(png(864, 1152)), { type: "image/png", ext: "png", width: 864, height: 1152, animated: false });
  assert.equal(imageInfo(png(10, 10, true))?.animated, true);
  assert.deepEqual(imageInfo(jpeg(1600, 900)), { type: "image/jpeg", ext: "jpg", width: 1600, height: 900, animated: false });
  assert.deepEqual(imageInfo(webp(1280, 720)), { type: "image/webp", ext: "webp", width: 1280, height: 720, animated: false });
  assert.equal(imageInfo(webp(8, 8, true))?.animated, true);
  // Lossy and lossless WebP without the extended header.
  assert.deepEqual(
    imageInfo(bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8 ", [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], [0x40, 0x01], [0xf0, 0x00]))
      ?.width,
    320
  );
  const lossless = imageInfo(bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8L", [0, 0, 0, 0], [0x2f], [0x3f, 0xc1, 0x1d, 0x00], [0, 0, 0, 0, 0, 0]));
  assert.deepEqual([lossless?.width, lossless?.height], [320, 120]);
});

test("imageInfo refuses anything else", () => {
  for (const b of [
    new Uint8Array(),
    bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0]),
    bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    bytes("BM", [0x36, 0, 0, 0]),
    bytes("\x89PNG\r\n\x1a\n"),
    png(0, 10),
    bytes([0xff, 0xd8, 0xff, 0xd9]),
    bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "),
  ]) {
    assert.equal(imageInfo(b), null);
  }
});

test("uploadProblem applies the size, format and animation limits", () => {
  assert.equal(uploadProblem(webp(1600, 1200), 300_000), null);
  assert.match(uploadProblem(new Uint8Array(), 300_000)!, /empty/);
  assert.match(uploadProblem(png(100, 100), 20)!, /larger than/);
  assert.match(uploadProblem(bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0]), 300_000)!, /WebP, JPEG and PNG/);
  assert.match(uploadProblem(webp(100, 100, true), 300_000)!, /Animated/);
  assert.match(uploadProblem(webp(4000, 100), 300_000)!, /2048 pixels/);
});

test("quotas rise with trust level and weeks are fixed spans", () => {
  assert.equal(weeklyQuota("TRUST_LEVEL_NEW"), 3);
  assert.ok(weeklyQuota("TRUST_LEVEL_CORE") > weeklyQuota("TRUST_LEVEL_ESTABLISHED"));
  assert.equal(weeklyQuota(undefined), 0);
  assert.equal(weeklyQuota("TRUST_LEVEL_UNSPECIFIED"), 0);
  const t = new Date("2026-11-14T12:00:00Z");
  assert.equal(quotaWeek(t), quotaWeek(new Date(t.getTime() + 60_000)));
  assert.equal(quotaWeek(new Date(t.getTime() + 7 * 86_400_000)), quotaWeek(t) + 1);
});

test("the upload message round-trips and nothing else parses", () => {
  const a = { chainId: "sparkdream-dev-1", address: "sprkdrm1zenith", expires: "2026-11-14T12:00:00.000Z" };
  const msg = uploadAuthMessage(a);
  assert.deepEqual(parseUploadAuthMessage(msg), a);
  assert.equal(parseUploadAuthMessage(msg + "\nAddress: sprkdrm1aurora"), null);
  assert.equal(parseUploadAuthMessage(msg.replace("image upload", "image upload!")), null);
  assert.equal(parseUploadAuthMessage(msg.replace("move any funds", "move all funds")), null);
  assert.equal(parseUploadAuthMessage(""), null);

  // Signed by a session key acting for the member.
  const viaKey = { ...a, sessionKey: "sprkdrm1phoenix" };
  const keyMsg = uploadAuthMessage(viaKey);
  assert.deepEqual(parseUploadAuthMessage(keyMsg), viaKey);
  assert.equal(parseUploadAuthMessage(keyMsg + "\nSession key: sprkdrm1aurora"), null);
  assert.equal(parseUploadAuthMessage(uploadAuthMessage({ ...a, sessionKey: a.address })), null);
  assert.equal(parseUploadAuthMessage(msg + "\nSession key: "), null);

  assert.ok(sessionAllowsUpload(["/sparkdream.blog.v1.MsgReact", "/sparkdream.blog.v1.MsgCreatePost"]));
  assert.ok(!sessionAllowsUpload(["/sparkdream.blog.v1.MsgReact", "/sparkdream.forum.v1.MsgCreatePost"]));
  assert.ok(!sessionAllowsUpload(undefined));
});

test("verifyUploadAuth accepts only this app's unexpired message signed by the address it names", async () => {
  const now = new Date("2026-11-14T12:00:00.000Z");
  const expected = { chainId: "sparkdream-dev-1", bech32Prefix: "sprkdrm", now };
  const wallet = await Secp256k1Wallet.fromKey(Uint8Array.from({ length: 32 }, (_, i) => i + 1), "sprkdrm");
  const other = await Secp256k1Wallet.fromKey(Uint8Array.from({ length: 32 }, (_, i) => i + 2), "sprkdrm");
  const [{ address }] = await wallet.getAccounts();
  const [{ address: otherAddress }] = await other.getAccounts();
  const sign = async (w: Secp256k1Wallet, signer: string, message: string) => ({
    message,
    signature: (await w.signAmino(signer, adr36SignDoc(signer, message))).signature,
  });
  const message = (over: Partial<Parameters<typeof uploadAuthMessage>[0]> = {}) =>
    uploadAuthMessage({
      chainId: "sparkdream-dev-1",
      address,
      expires: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      ...over,
    });

  const good = await sign(wallet, address, message());
  assert.deepEqual(await verifyUploadAuth(good, expected), { ok: true, address });

  const reason = async (auth: Parameters<typeof verifyUploadAuth>[0]) => {
    const res = await verifyUploadAuth(auth, expected);
    return res.ok ? "accepted" : res.reason;
  };
  assert.equal(await reason(await sign(wallet, address, message({ chainId: "sparkdream-1" }))), "signed for another chain");
  assert.equal(await reason(await sign(wallet, address, message({ expires: new Date(now.getTime() - 1000).toISOString() }))), "expired");
  assert.equal(
    await reason(await sign(wallet, address, message({ expires: new Date(now.getTime() + 2 * AUTH_MAX_AGE_MS).toISOString() }))),
    "expiry too far away"
  );
  // Another member's key signing a message that names this member.
  const forged = await sign(other, otherAddress, message());
  assert.equal(await reason(forged), "signed by another address");
  // A genuine signature moved onto a different message.
  assert.equal(await reason({ message: message({ expires: new Date(now.getTime() + 7200_000).toISOString() }), signature: good.signature }), "bad signature");
  assert.equal(await reason({ message: "hello", signature: good.signature }), "not an upload authorisation");
  assert.equal(await reason({ message: good.message, signature: { ...good.signature, signature: "AAAA" } }), "bad signature");

  // A session key signs a message naming itself and the member it acts for.
  // The result carries the key, so the caller knows to check the session.
  const viaKey = await sign(other, otherAddress, message({ sessionKey: otherAddress }));
  assert.deepEqual(await verifyUploadAuth(viaKey, expected), { ok: true, address, sessionKey: otherAddress });
  // The member's own signature doesn't stand in for the key's, nor a third key's.
  assert.equal(await reason(await sign(wallet, address, message({ sessionKey: otherAddress }))), "signed by another address");
  // The key's signature on the plain message is the forgery refused above.
  assert.equal(await reason({ message: message(), signature: viaKey.signature }), "signed by another address");
});

test("uploads are off unless the image bucket, its address and a pre-check are all set", () => {
  const full = {
    IMAGE_S3_BUCKET: "images",
    IMAGE_PUBLIC_BASE: "https://images.example/",
    IMAGE_PRECHECK_URL: "https://scan.example/precheck",
    IMAGE_PRECHECK_TOKEN: "t".repeat(40),
    S3_ENDPOINT: "https://endpoint.example",
    S3_ACCESS_KEY: "ak",
    S3_SECRET_KEY: "sk",
    S3_BUCKET: "archive",
  } as unknown as NodeJS.ProcessEnv;
  const cfg = uploadConfig(full)!;
  assert.equal(cfg.s3.bucket, "images");
  assert.equal(cfg.publicBase, "https://images.example");
  assert.equal(cfg.maxBytes, 300_000);
  assert.equal(cfg.copyMaxBytes, 4 * 1024 * 1024);
  assert.equal(publicPolicy(cfg, full).copy_max_bytes, 4 * 1024 * 1024);
  assert.equal(publicPolicy(cfg, { ...full, ARWEAVE_UPLOADS_DISABLED: "true" }).copy_max_bytes, 0);
  for (const k of ["IMAGE_S3_BUCKET", "IMAGE_PUBLIC_BASE", "IMAGE_PRECHECK_URL", "IMAGE_PRECHECK_TOKEN", "S3_SECRET_KEY"]) {
    assert.equal(uploadConfig({ ...full, [k]: "" }), null, k);
  }
  // The operator's switch for permanent copies, on unless set.
  assert.equal(publicPolicy(cfg, full).permanent_copies, true);
  assert.equal(publicPolicy(null, { ...full, ARWEAVE_UPLOADS_DISABLED: "true" }).permanent_copies, false);
  // The archive bucket is never a fallback for images.
  assert.equal(uploadConfig({ ...full, IMAGE_S3_BUCKET: undefined }), null);

  assert.equal(imageKey("ab12", "webp"), "img/ab12.webp");
  const tag = memberTag(cfg, "sprkdrm1zenith");
  assert.match(tag, /^[0-9a-f]{32}$/);
  assert.equal(tag, memberTag(cfg, "sprkdrm1zenith"));
  assert.notEqual(tag, memberTag(cfg, "sprkdrm1aurora"));
  assert.ok(!tag.includes("zenith"));
});

test("signS3 builds a path-style SigV4 request", () => {
  const cfg = { endpoint: "https://endpoint.example", region: "us-west-2", bucket: "images", accessKey: "AKID", secretKey: "secret" };
  const now = new Date("2026-11-14T12:00:00.000Z");
  const put = signS3(cfg, { method: "PUT", key: "img/a b.webp", body: bytes("hi"), headers: { "Content-Type": "image/webp" } }, now);
  assert.equal(put.url, "https://endpoint.example/images/img/a%20b.webp");
  assert.equal(put.headers["x-amz-date"], "20261114T120000Z");
  assert.equal(put.headers["x-amz-content-sha256"], "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4");
  assert.match(
    put.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKID\/20261114\/us-west-2\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
  );
  assert.ok(!("host" in put.headers));
  // Same inputs, same signature; a different secret, a different one.
  assert.equal(signS3(cfg, { method: "PUT", key: "img/a b.webp", body: bytes("hi"), headers: { "Content-Type": "image/webp" } }, now).headers.authorization, put.headers.authorization);
  assert.notEqual(signS3({ ...cfg, secretKey: "other" }, { method: "PUT", key: "img/a b.webp", body: bytes("hi"), headers: { "Content-Type": "image/webp" } }, now).headers.authorization, put.headers.authorization);
  const list = signS3(cfg, { method: "GET", query: { prefix: "quota/1/ab/", "list-type": "2" } }, now);
  assert.equal(list.url, "https://endpoint.example/images?list-type=2&prefix=quota%2F1%2Fab%2F");
});

// The whole accept path, with the chain, the bucket and the scanner stubbed
// at fetch.
test("acceptUpload stores an image only for an active member, within quota, after a clean pre-check", async () => {
  const { acceptUpload } = await import("./imageUpload/server");
  const now = new Date("2026-11-14T12:00:00.000Z");
  const cfg = uploadConfig({
    IMAGE_S3_ENDPOINT: "https://storage.test",
    IMAGE_S3_BUCKET: "images",
    IMAGE_S3_ACCESS_KEY: "ak",
    IMAGE_S3_SECRET_KEY: "sk",
    IMAGE_PUBLIC_BASE: "https://images.test",
    IMAGE_PRECHECK_URL: "https://scan.test/precheck",
    IMAGE_PRECHECK_TOKEN: "t".repeat(40),
    CHAIN_ID: "sparkdream-dev-1",
    BECH32_PREFIX: "sprkdrm",
  } as unknown as NodeJS.ProcessEnv)!;
  const wallet = await Secp256k1Wallet.fromKey(Uint8Array.from({ length: 32 }, (_, i) => i + 7), "sprkdrm");
  const [{ address }] = await wallet.getAccounts();
  const message = uploadAuthMessage({ chainId: cfg.chainId, address, expires: new Date(now.getTime() + 3600_000).toISOString() });
  const auth = { message, signature: (await wallet.signAmino(address, adr36SignDoc(address, message))).signature };

  const world = {
    member: { address, status: "MEMBER_STATUS_ACTIVE", trust_level: "TRUST_LEVEL_NEW" } as Record<string, string> | null,
    session: null as { granter: string; grantee: string; allowed_msg_types: string[]; expiration: string } | null,
    verdict: "clean",
    objects: new Map<string, Uint8Array>(),
    prechecks: 0,
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method || "GET";
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url.pathname.includes("/rep/v1/member/")) return world.member ? json(200, { member: world.member }) : json(404, { code: 5 });
    if (url.pathname.includes("/session/v1/session/")) {
      const [granter, grantee] = url.pathname.split("/").slice(-2);
      const s = world.session;
      return s && s.granter === granter && s.grantee === grantee ? json(200, { session: s }) : json(404, { code: 5 });
    }
    if (url.host === "scan.test") {
      world.prechecks++;
      assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${"t".repeat(40)}`);
      const { createHash } = await import("node:crypto");
      const sha256 = createHash("sha256").update(init!.body as Uint8Array).digest("hex");
      return json(200, { sha256, verdict: world.verdict });
    }
    if (url.host === "storage.test") {
      const key = decodeURIComponent(url.pathname.replace(/^\/images\/?/, ""));
      if (method === "PUT") {
        world.objects.set(key, new Uint8Array(init!.body as Uint8Array));
        return new Response(null, { status: 200 });
      }
      if (method === "DELETE") {
        world.objects.delete(key);
        return new Response(null, { status: 204 });
      }
      if (method === "HEAD") return new Response(null, { status: world.objects.has(key) ? 200 : 404 });
      const prefix = url.searchParams.get("prefix") || "";
      const keys = [...world.objects.keys()].filter((k) => k.startsWith(prefix));
      return new Response(`<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;

  try {
    const images = () => [...world.objects.keys()].filter((k) => k.startsWith("img/"));
    const picture = (n: number) => webp(100 + n, 80);

    const first = await acceptUpload(cfg, auth, picture(1), now);
    assert.ok(first.ok, JSON.stringify(first));
    assert.match(first.url, /^https:\/\/images\.test\/img\/[0-9a-f]{64}\.webp$/);
    assert.deepEqual([first.used, first.quota], [1, 3]);
    assert.ok(!first.url.includes(address) && !images()[0].includes(address));
    assert.equal(world.prechecks, 1);

    // The same image again: stored once, counted once, not re-checked.
    const again = await acceptUpload(cfg, auth, picture(1), now);
    assert.ok(again.ok && again.url === first.url && again.used === 1);
    assert.equal(images().length, 1);
    assert.equal(world.prechecks, 1);

    // An image the scanner doesn't clear is not stored and not counted.
    world.verdict = "held";
    const held = await acceptUpload(cfg, auth, picture(2), now);
    assert.ok(!held.ok && held.status === 422);
    assert.equal(images().length, 1);
    world.verdict = "clean";

    // Up to the weekly allowance, then no further.
    assert.ok((await acceptUpload(cfg, auth, picture(3), now)).ok);
    assert.ok((await acceptUpload(cfg, auth, picture(4), now)).ok);
    const over = await acceptUpload(cfg, auth, picture(5), now);
    assert.ok(!over.ok && over.status === 429, JSON.stringify(over));
    assert.equal(images().length, 3);
    // A new week starts a new allowance.
    assert.ok((await acceptUpload(cfg, auth, picture(5), new Date(now.getTime() + 20 * 60_000 + 0))).ok === false);
    const nextWeekAuth = async () => {
      const later = new Date(now.getTime() + 7 * 86_400_000);
      const m = uploadAuthMessage({ chainId: cfg.chainId, address, expires: new Date(later.getTime() + 3600_000).toISOString() });
      return { later, auth: { message: m, signature: (await wallet.signAmino(address, adr36SignDoc(address, m))).signature } };
    };
    const next = await nextWeekAuth();
    assert.ok((await acceptUpload(cfg, next.auth, picture(5), next.later)).ok);

    // Uploads sent at once still share one allowance: two places are left.
    const burst = await Promise.all([10, 11, 12, 13, 14, 15].map((n) => acceptUpload(cfg, next.auth, picture(n), next.later)));
    assert.equal(burst.filter((r) => r.ok).length, 2);
    assert.ok(burst.every((r) => r.ok || r.status === 429));
    assert.equal(images().length, 6);
    // A refused upload leaves no marker behind.
    assert.equal([...world.objects.keys()].filter((k) => k.startsWith("quota/")).length, 6);

    // The full-size file for a permanent copy: its own place and allowance,
    // no limit on its sides, and only a PNG or JPEG inside the profile.
    const big = await encodeRgbPng(new Uint8Array(3000 * 2 * 4).fill(200), 3000, 2);
    const source = await acceptUpload(cfg, next.auth, big, next.later, "copy");
    assert.ok(source.ok, JSON.stringify(source));
    assert.match(source.url, /^https:\/\/images\.test\/src\/[0-9a-f]{64}\.png$/);
    assert.deepEqual([source.used, source.quota], [1, 3]);
    assert.equal(images().length, 6);
    const asImage = await acceptUpload(cfg, next.auth, big, next.later);
    assert.ok(!asImage.ok && asImage.status !== 200);
    const webpSource = await acceptUpload(cfg, next.auth, picture(20), next.later, "copy");
    assert.ok(!webpSource.ok && webpSource.status === 400);

    // A session key the member lets publish dreams uploads for them, against
    // the member's own allowance, for as long as the session stands onchain.
    const keyWallet = await Secp256k1Wallet.fromKey(Uint8Array.from({ length: 32 }, (_, i) => i + 9), "sprkdrm");
    const [{ address: key }] = await keyWallet.getAccounts();
    const keyMessage = uploadAuthMessage({ chainId: cfg.chainId, address, sessionKey: key, expires: new Date(next.later.getTime() + 3600_000).toISOString() });
    const keyAuth = { message: keyMessage, signature: (await keyWallet.signAmino(key, adr36SignDoc(key, keyMessage))).signature };
    const viaKey = (n: number, kind?: "copy") => acceptUpload(cfg, keyAuth, picture(n), next.later, kind);
    const session = (types: string[], expiration: string) => ({ granter: address, grantee: key, allowed_msg_types: types, expiration });
    const live = new Date(next.later.getTime() + 86_400_000).toISOString();
    const unchecked = world.prechecks;
    const noSession = await viaKey(5);
    assert.ok(!noSession.ok && noSession.status === 403 && /session/.test(noSession.message));
    world.session = session(["/sparkdream.blog.v1.MsgReact"], live);
    assert.ok(!(await viaKey(5)).ok, "a session that can't publish dreams");
    world.session = session(["/sparkdream.blog.v1.MsgCreatePost"], new Date(next.later.getTime() - 1000).toISOString());
    assert.ok(!(await viaKey(5)).ok, "an expired session");
    world.session = { ...session(["/sparkdream.blog.v1.MsgCreatePost"], live), granter: key };
    assert.ok(!(await viaKey(5)).ok, "a session from someone else");
    world.session = session(["/sparkdream.blog.v1.MsgCreatePost"], live);
    const asCopy = await viaKey(5, "copy");
    assert.ok(!asCopy.ok && asCopy.status === 403 && /own wallet/.test(asCopy.message));
    assert.equal(world.prechecks, unchecked);
    // Already stored by the member this week, so it is theirs and counts once.
    const sameMember = await viaKey(5);
    assert.ok(sameMember.ok && sameMember.used >= 1, JSON.stringify(sameMember));
    world.session = null;

    // Refusals that never reach the scanner or the bucket.
    const before = world.prechecks;
    const bad = await acceptUpload(cfg, { ...auth, message: auth.message + " " }, picture(6), now);
    assert.ok(!bad.ok && bad.status === 401);
    const gif = await acceptUpload(cfg, auth, bytes("GIF89a", [1, 0, 1, 0, 0, 0, 0]), now);
    assert.ok(!gif.ok && gif.status === 400);
    world.member = { address, status: "MEMBER_STATUS_ZEROED", trust_level: "TRUST_LEVEL_NEW" };
    const zeroed = await acceptUpload(cfg, auth, picture(6), now);
    assert.ok(!zeroed.ok && zeroed.status === 403);
    world.member = null;
    const stranger = await acceptUpload(cfg, auth, picture(6), now);
    assert.ok(!stranger.ok && stranger.status === 403);
    assert.equal(world.prechecks, before);
  } finally {
    globalThis.fetch = realFetch;
  }
});

