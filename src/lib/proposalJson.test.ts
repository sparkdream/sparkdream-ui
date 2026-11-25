import assert from "node:assert/strict";
import { test } from "node:test";
import { differencesFromChain, encodeProposalMessages, microToDisplay, parseProposalFile } from "./proposalJson";

const MSG = { "@type": "/sparkdream.service.v1.MsgUpdateServiceTypeConfig", authority: "a", config: { service_type: "x", slash: 100, lag: "34560" } };

test("parseProposalFile reads the CLI proposal file", () => {
  const file = parseProposalFile(JSON.stringify({ messages: [MSG], deposit: "50000000uspark.sparkdreamtest", title: "t", summary: "s" }));
  assert.deepEqual(file.deposit, [{ denom: "uspark.sparkdreamtest", amount: "50000000" }]);
  assert.equal(file.expedited, false);
  assert.equal(file.metadata, "");
  assert.deepEqual(file.messages, [MSG]);
});

test("parseProposalFile refuses what it does not understand", () => {
  assert.throws(() => parseProposalFile("{"), /Not valid JSON/);
  assert.throws(() => parseProposalFile(JSON.stringify({ messages: [] })), /at least one message/);
  assert.throws(() => parseProposalFile(JSON.stringify({ messages: [{ authority: "a" }] })), /@type/);
  assert.throws(() => parseProposalFile(JSON.stringify({ messages: [MSG], depositt: "1uspark" })), /Unknown field "depositt"/);
  assert.throws(() => parseProposalFile(JSON.stringify({ messages: [MSG], deposit: "fifty" })), /deposit/);
});

test("differencesFromChain accepts defaults the chain adds and number spellings", () => {
  const read = { ...MSG, config: { service_type: "x", slash: 100, lag: "34560", enabled: false, dec: "0.500000000000000000" } };
  assert.deepEqual(differencesFromChain([MSG], [read], "messages"), []);
  assert.deepEqual(differencesFromChain({ lag: 34560, dec: "0.5" }, { lag: "34560", dec: "0.500000000000000000" }, ""), []);
});

test("differencesFromChain reports a dropped field and a changed value", () => {
  const typo = { ...MSG, config: { ...MSG.config, lagg: "1" } };
  assert.match(differencesFromChain([typo], [MSG], "messages")[0], /messages\[0\]\.config\.lagg: the chain does not know this field/);
  assert.match(differencesFromChain({ action: 1 }, { action: "ESCALATE" }, "")[0], /the file says 1, the chain read "ESCALATE"/);
  assert.equal(differencesFromChain([MSG, MSG], [MSG], "messages").length, 1);
  assert.equal(differencesFromChain({ on: true }, { on: "true" }, "").length, 1);
});

test("encodeProposalMessages refuses a proposal the node read differently", async () => {
  // A node that drops the misspelled field, as grpc-gateway does.
  const fake = (async (url: string) => {
    const body = String(url).endsWith("/encode")
      ? { tx_bytes: "" }
      : { tx: { body: { messages: [{ "@type": "/cosmos.gov.v1.MsgSubmitProposal", messages: [MSG] }] } } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const typo = { ...MSG, config: { ...MSG.config, lagg: "1" } };
  await assert.rejects(encodeProposalMessages([typo], fake), /does not read the proposal as written.*lagg/);
});

test("microToDisplay", () => {
  assert.equal(microToDisplay("50000000"), "50");
  assert.equal(microToDisplay("1500000"), "1.5");
  assert.equal(microToDisplay("1"), "0.000001");
  assert.equal(microToDisplay("0"), "0");
});
