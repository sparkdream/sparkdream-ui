// The blind-mint commitment built in the browser must equal the chain's, or
// every MsgReveal fails with "invalid reveal" long after the class was
// created. The vector comes from the chain's own tool (cmd/artifactcommit
// tree / seed in the chain repo), with fixed salts so it is reproducible;
// regenerate it there if the leaf format ever changes.
//
//   npm test

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fromHex } from "@cosmjs/encoding";
import type { TokenMetadata } from "@/types/artifact";
import {
  buildCommitTree,
  checkLeaf,
  metadataHash,
  parseCommitTree,
  revealLeaf,
  seedCommitment,
  verifyRevealProof,
  type CommitEntry,
  type CommitTree,
} from "./artifactCommit";

interface Vector {
  class_id: number;
  entries: CommitEntry[];
  tree: CommitTree & { leaves: (CommitTree["leaves"][number] & { token_id: number | string })[] };
  seed: { seed: string; commitment: string };
}

const vector = JSON.parse(
  fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "__fixtures__/artifact-commit-vector.json"), "utf8"),
) as Vector;

test("metadata hashes match the chain's MetadataHash", () => {
  vector.entries.forEach((e, i) => {
    assert.equal(metadataHash(e.metadata), vector.tree.leaves[i].metadata_hash, `entry ${i}`);
  });
});

test("the tree root and every proof match artifactcommit tree", () => {
  const got = buildCommitTree(BigInt(vector.class_id), vector.entries);
  assert.equal(got.root, vector.tree.root);
  assert.equal(got.leaves.length, vector.tree.leaves.length);
  got.leaves.forEach((l, i) => {
    const want = vector.tree.leaves[i];
    assert.equal(l.token_id, String(want.token_id));
    assert.equal(l.salt, want.salt);
    assert.deepEqual(l.proof, want.proof, `proof of token ${l.token_id}`);
  });
});

test("every chain proof verifies, and a swapped token id does not", () => {
  const root = fromHex(vector.tree.root);
  vector.entries.forEach((e, i) => {
    const want = vector.tree.leaves[i];
    const proof = want.proof.map((p) => fromHex(p));
    const leaf = revealLeaf(BigInt(vector.class_id), BigInt(String(e.token_id)), fromHex(want.salt), e.metadata);
    assert.ok(verifyRevealProof(leaf, proof, root));
    const swapped = revealLeaf(BigInt(vector.class_id), BigInt(String(e.token_id)) + BigInt(1), fromHex(want.salt), e.metadata);
    assert.ok(!verifyRevealProof(swapped, proof, root));
  });
});

test("an uploaded artifactcommit file checks out against entered metadata", () => {
  const tree = parseCommitTree(JSON.stringify(vector.tree));
  const id = BigInt(vector.class_id);
  tree.leaves.forEach((l, i) => assert.equal(checkLeaf(id, tree.root, l, vector.entries[i].metadata), null));
  const wrong: TokenMetadata = { ...vector.entries[0].metadata, name: "Not it" };
  assert.notEqual(checkLeaf(id, tree.root, tree.leaves[0], wrong), null);
  assert.notEqual(checkLeaf(id + BigInt(1), tree.root, tree.leaves[0], vector.entries[0].metadata), null);
});

test("random salts are filled in and still verify", () => {
  const entries = vector.entries.map((e) => ({ ...e, salt: "" }));
  const tree = buildCommitTree(BigInt(9), entries);
  tree.leaves.forEach((l, i) => {
    assert.match(l.salt, /^[0-9a-f]{64}$/);
    assert.equal(checkLeaf(BigInt(9), tree.root, l, entries[i].metadata), null);
  });
});

test("the seed commitment matches artifactcommit seed", () => {
  assert.equal(seedCommitment(vector.seed.seed), vector.seed.commitment);
});

test("the artifact module address is sha256(\"artifact\")[:20]", async () => {
  const { sha256 } = await import("@cosmjs/crypto");
  const { fromBech32 } = await import("@cosmjs/encoding");
  const { artifactModuleAddress, harbergerTaxPerPeriod } = await import("./artifactModule");
  const want = sha256(new TextEncoder().encode("artifact")).slice(0, 20);
  assert.deepEqual(fromBech32(artifactModuleAddress("sprkdrm")).data, want);
  // TaxPerPeriod rounds up: 1 at 5%/year over a day is a fraction, so 1.
  assert.equal(harbergerTaxPerPeriod(BigInt(1), 500, BigInt(86400)), BigInt(1));
  assert.equal(harbergerTaxPerPeriod(BigInt(365_000_000), 1000, BigInt(86400)), BigInt(100_000));
  assert.equal(harbergerTaxPerPeriod(BigInt(0), 1000, BigInt(86400)), BigInt(0));
});
