import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, locatorTarget, sourceUrlProblem } from "./storageRules";

// The cases of TestValidateSourceURL in the chain repo
// (x/storage/types/validate_test.go).
test("source addresses are judged as the chain judges them", () => {
  const ok = ["https://files.phoenix.example/a.png", "https://h.example:8443/p/a%20b.png?x=1&y=2", "https://[2001:db8::1]/a.png",
    // Go lowercases the scheme and never checks escapes in the query.
    "HTTPS://files.phoenix.example/a.png", "https://files.phoenix.example/a?x=%zz", "https://files.phoenix.example/a@b"];
  for (const u of ok) assert.equal(sourceUrlProblem(u, 512), null, u);
  const bad = [
    "",
    "http://files.phoenix.example/a.png",
    "ftp://files.phoenix.example/a.png",
    "https://files.phoenix.example/a.png#frag",
    "https://user:pw@files.phoenix.example/a.png",
    "https://user@files.phoenix.example/a.png",
    "https://files.phoenix.example/a b.png",
    'https://files.phoenix.example/"a".png',
    "https://files.phoenix.example/<a>.png",
    "https:///a.png",
    "https://@files.phoenix.example/a.png",
    "https://a%41b.example/a.png",
    "https://files.phoenix.example:8a/a.png",
    "https://files.phoenix.example/a\nb",
    "https://files.phoenix.example/\u00e9",
    "https://files.phoenix.example/a%zz",
    "files.phoenix.example/a.png",
    "https://files.phoenix.example/" + "a".repeat(600),
  ];
  for (const u of bad) assert.notEqual(sourceUrlProblem(u, 512), null, u);
});

test("a locator opens only in its own format", () => {
  const id = "DJWWgh1_MciO5UOdmRKxS-eQotBqo26YVgKcP6GXsA0";
  assert.equal(locatorTarget("LOCATOR_FORMAT_ARWEAVE_TX", id), `https://arweave.net/${id}`);
  assert.equal(locatorTarget("LOCATOR_FORMAT_ARWEAVE_TX", "../evil"), null);
  assert.equal(locatorTarget("LOCATOR_FORMAT_UNSPECIFIED", id), null);
  assert.equal(locatorTarget("LOCATOR_FORMAT_ARWEAVE_TX", ""), null);
});

test("sizes read in binary units", () => {
  assert.equal(formatBytes(900), "900 B");
  assert.equal(formatBytes(2048), "2.0 KiB");
  assert.equal(formatBytes(10 * 1024 * 1024), "10.00 MiB");
});
