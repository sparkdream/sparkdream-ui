import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadVerifiedImage } from "./contentScan/media";

// An image whose host stopped serving it is read from its permanent copy,
// found on chain by the file's hash (x/storage), and only if the copy's
// bytes hash to the same value.
test("an image that no longer loads is read from its permanent copy, checked by hash", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const sha = createHash("sha256").update(png).digest("hex");
  const other = createHash("sha256").update("another file").digest("hex");
  const id = "JNC6vBhjHY1EPwV3pEeNmrsgFMxH5d38_LHsZ7jful8";
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // The site's own policy route is a relative address, which has no meaning
    // here: the loader falls back to the default gateway.
    if (raw.startsWith("/")) throw new TypeError("relative address");
    const url = new URL(raw);
    seen.push(url.pathname);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url.host === "images.test") return new Response(null, { status: 404 });
    if (url.pathname.endsWith("/storage/v1/backends")) {
      return json(200, { backends: [{ name: "arweave", locator_format: "LOCATOR_FORMAT_ARWEAVE_TX", enabled: true }] });
    }
    if (url.pathname.endsWith(`/storage/v1/request_by_hash/arweave/${sha}`)) {
      return json(200, { request: { id: "7", sha256: sha, status: "REQUEST_STATUS_SETTLED", locator: id } });
    }
    if (url.pathname.includes("/storage/v1/request_by_hash/")) return json(404, { code: 5, message: "not found" });
    if (url.host === "arweave.net" && url.pathname === `/${id}`) {
      return new Response(png, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    throw new Error(`unexpected fetch ${raw}`);
  }) as typeof fetch;
  try {
    const got = await loadVerifiedImage(`https://images.test/img/${sha}.png`, sha);
    assert.ok(got.ok, JSON.stringify(got));
    assert.ok(seen.includes(`/${id}`));

    // No request for the hash: the first failure stands.
    const none = await loadVerifiedImage(`https://images.test/img/${other}.png`, other);
    assert.deepEqual(none, { ok: false, reason: "error" });
  } finally {
    globalThis.fetch = realFetch;
  }
});
