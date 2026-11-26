import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, pinnedLookup, publicHttpsTarget } from "./publicUrl";

test("private, loopback, link-local and reserved addresses are not public", () => {
  for (const ip of ["10.0.0.8", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1", "::", "not-an-ip"]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ["1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:1.1.1.1"]) {
    assert.equal(isPublicIp(ip), true, ip);
  }
});

test("only an https host name on the default port that resolves publicly is allowed", async () => {
  const pub = async () => ["1.1.1.1"];
  assert.deepEqual(await publicHttpsTarget("https://mstdn.test/some/path?x=1", pub), { host: "mstdn.test", address: "1.1.1.1" });
  for (const url of ["http://mstdn.test", "https://mstdn.test:8443", "https://u:p@mstdn.test", "https://10.0.0.8", "https://[::1]", "https://localhost", "https://box.local", "https://svc.internal", "ftp://mstdn.test", "nope"]) {
    assert.equal(await publicHttpsTarget(url, pub), null, url);
  }
  // One private answer among public ones is enough to refuse.
  assert.equal(await publicHttpsTarget("https://mstdn.test", async () => ["1.1.1.1", "10.0.0.8"]), null);
  assert.equal(await publicHttpsTarget("https://mstdn.test", async () => []), null);
  assert.equal(await publicHttpsTarget("https://mstdn.test", async () => { throw new Error("ENOTFOUND"); }), null);
});

test("the pinned lookup answers any name with the checked address, in both shapes Node asks for", () => {
  const lookup = pinnedLookup("1.1.1.1");
  let single: unknown[] = [];
  lookup("anything.test", {}, (...args: unknown[]) => (single = args));
  assert.deepEqual(single, [null, "1.1.1.1", 4]);
  let list: unknown[] = [];
  lookup("anything.test", { all: true }, (...args: unknown[]) => (list = args));
  assert.deepEqual(list, [null, [{ address: "1.1.1.1", family: 4 }]]);
  let six: unknown[] = [];
  pinnedLookup("2606:4700::1111")("x.test", {}, (...args: unknown[]) => (six = args));
  assert.deepEqual(six, [null, "2606:4700::1111", 6]);
});
