// The recovery hashes must equal x/rep/types/migration.go byte for byte. The
// vectors were produced by the chain's own RecoveryCommitmentHash and
// RecoverySeal over the preimage 0x00..0x1f (32 bytes) and the two address
// strings below (the functions hash the bech32 text; it is not validated).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatRecoveryCode,
  parseBackupMember,
  parseRecoveryCode,
  recoveryBackupText,
  recoveryCommitment,
  recoverySeal,
  toHex,
} from "./recovery";

const PREIMAGE = Uint8Array.from({ length: 32 }, (_, i) => i);
const FROM = "sprkdrm1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnwx9nkh";
const TO = "sprkdrm1zg69v7ys40x77y352eufp27daufrg4ncwcsrn0";

test("commitment matches the chain's RecoveryCommitmentHash", async () => {
  assert.equal(
    toHex(await recoveryCommitment(PREIMAGE)),
    "8c32ef8200b854309b5a3df825ec935eb50599b92471153a9c676e567c7725bc",
  );
});

test("seal matches the chain's RecoverySeal", async () => {
  assert.equal(
    toHex(await recoverySeal(PREIMAGE, FROM, TO)),
    "5964fbea155f06b7176137520bfddf9c60c039e0441cd25f18e409a58326ced0",
  );
});

test("the code survives formatting, and a pasted backup file parses", async () => {
  const code = formatRecoveryCode(PREIMAGE);
  assert.deepEqual(parseRecoveryCode(code), PREIMAGE);
  assert.deepEqual(parseRecoveryCode(code.replace(/-/g, " ")), PREIMAGE);
  const backup = recoveryBackupText(FROM, PREIMAGE, await recoveryCommitment(PREIMAGE));
  assert.deepEqual(parseRecoveryCode(backup), PREIMAGE);
  assert.equal(parseBackupMember(backup), FROM);
  assert.equal(parseRecoveryCode("not hex"), null);
  assert.equal(parseRecoveryCode("abc"), null);
});
