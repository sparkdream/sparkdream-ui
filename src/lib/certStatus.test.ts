import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCerts, httpsHosts, type CertReading } from "./certStatus";

const NOW = Date.parse("2026-11-26T06:00:00Z");
const DAY = 86_400_000;
const reading = (host: string, over: Partial<CertReading> = {}): CertReading => ({
  host,
  expiresAt: NOW + 78 * DAY,
  refused: null,
  unreachable: false,
  ...over,
});

test("certificates with time left are working, one row each", () => {
  const got = assessCerts([reading("api.test"), reading("rpc.test", { expiresAt: NOW + 20 * DAY })], NOW);
  assert.equal(got.state, "ok");
  assert.deepEqual(got.facts, [
    { label: "api.test", value: "Expires in 78d" },
    { label: "rpc.test", value: "Expires in 20d" },
  ]);
});

test("a certificate that missed its renewal is said two weeks ahead", () => {
  const got = assessCerts([reading("api.test", { expiresAt: NOW + 9 * DAY })], NOW);
  assert.equal(got.state, "degraded");
  assert.equal(got.issues[0], "The certificate of api.test expires in 9d and hasn't been renewed.");
});

test("an expired or unaccepted certificate cuts its host off from browsers", () => {
  const expired = assessCerts([reading("api.test", { expiresAt: NOW - 3 * DAY, refused: "CERT_HAS_EXPIRED" })], NOW);
  assert.equal(expired.state, "degraded");
  assert.equal(expired.facts[0].value, "Expired 3d ago");
  assert.equal(expired.issues.length, 1);
  assert.match(expired.issues[0], /expired 3d ago, so browsers refuse/);
  const wrong = assessCerts([reading("api.test", { refused: "ERR_TLS_CERT_ALTNAME_INVALID" })], NOW);
  assert.equal(wrong.facts[0].value, "Not accepted");
  assert.match(wrong.issues[0], /isn't accepted \(ERR_TLS_CERT_ALTNAME_INVALID\)/);
});

test("a host that doesn't answer is not a certificate problem, and no hosts is off", () => {
  const got = assessCerts([reading("api.test", { expiresAt: null, unreachable: true }), reading("rpc.test")], NOW);
  assert.equal(got.state, "ok");
  assert.equal(got.facts[0].value, "Not checked, the host didn't answer");
  assert.equal(assessCerts([reading("x.test", { expiresAt: null })], NOW).facts[0].value, "Unreadable");
  assert.equal(assessCerts([], NOW).state, "off");
});

test("only distinct https hosts on the default port are checked", () => {
  assert.deepEqual(
    httpsHosts([
      "https://api.test/path",
      "https://api.test",
      undefined,
      "",
      "http://plain.test",
      "https://gw.test/{id}",
      "https://odd.test:8443",
      "https://ok.test:443/x",
      "not a url",
    ]),
    ["api.test", "gw.test", "ok.test"]
  );
});
