// Batch checks for committee membership moves (MsgForceMigration).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";
import { toBech32 } from "@cosmjs/encoding";
import {
  emptyForceRow,
  filledForceRows,
  forceBatchSummary,
  forceRowProblems,
  parseForceRows,
} from "./forceMigrationBatch";

const PREFIX = "sprkdrm";
const addr = (n: number, prefix = PREFIX) => toBech32(prefix, new Uint8Array(20).fill(n));
const A = addr(1);
const B = addr(2);
const C = addr(3);
const D = addr(4);

test("a clean batch has no problems and blank rows are ignored", () => {
  const rows = [
    { member: A, newAddress: B, evidence: "ipfs://phoenix" },
    emptyForceRow(),
    { member: C, newAddress: D, evidence: "" },
  ];
  assert.deepEqual(forceRowProblems(rows, PREFIX), [[], [], []]);
  assert.equal(filledForceRows(rows).length, 2);
});

test("addresses are trimmed and lowercased", () => {
  const [row] = filledForceRows([{ member: `  ${A.toUpperCase()} `, newAddress: ` ${B}`, evidence: " x " }]);
  assert.deepEqual(row, { member: A, newAddress: B, evidence: "x" });
});

test("missing, malformed and foreign-prefix addresses are reported", () => {
  const problems = forceRowProblems(
    [
      { member: A, newAddress: "", evidence: "" },
      { member: "not-an-address", newAddress: B, evidence: "" },
      { member: C, newAddress: addr(9, "aurora"), evidence: "" },
    ],
    PREFIX,
  );
  assert.match(problems[0][0], /Enter the new address/);
  assert.match(problems[1][0], /member address is not a valid address/);
  assert.match(problems[2][0], /new address is not a valid address/);
});

test("a member cannot move to their own address", () => {
  const [p] = forceRowProblems([{ member: A, newAddress: A, evidence: "" }], PREFIX);
  assert.deepEqual(p, ["The new address must differ from the member's address."]);
});

test("a member or a new address used twice is reported on both rows", () => {
  const dupMember = forceRowProblems(
    [
      { member: A, newAddress: B, evidence: "" },
      { member: A, newAddress: C, evidence: "" },
    ],
    PREFIX,
  );
  assert.match(dupMember[0][0], /also in row 2/);
  assert.match(dupMember[1][0], /also in row 1/);

  const dupTarget = forceRowProblems(
    [
      { member: A, newAddress: C, evidence: "" },
      { member: B, newAddress: C, evidence: "" },
    ],
    PREFIX,
  );
  assert.match(dupTarget[0][0], /also used in row 2/);
  assert.match(dupTarget[1][0], /also used in row 1/);
});

test("an address cannot be a member in one row and a new address in another", () => {
  const problems = forceRowProblems(
    [
      { member: A, newAddress: B, evidence: "" },
      { member: B, newAddress: C, evidence: "" },
    ],
    PREFIX,
  );
  assert.match(problems[0][0], /member being moved in row 2/);
  assert.match(problems[1][0], /new address in row 1/);
});

test("pasted lines parse with commas, tabs or spaces", () => {
  const { rows, problems } = parseForceRows(
    [
      "# member, new address, evidence",
      `${A}, ${B}, https://example.org/a,b`,
      "",
      `${C}\t${D}`,
      `${A} ${D} ipfs://zenith`,
      "lonely",
    ].join("\n"),
  );
  assert.deepEqual(rows, [
    { member: A, newAddress: B, evidence: "https://example.org/a,b" },
    { member: C, newAddress: D, evidence: "" },
    { member: A, newAddress: D, evidence: "ipfs://zenith" },
  ]);
  assert.deepEqual(problems, ["Line 6 needs a member address and a new address."]);
});

test("the default description names one move or counts several", () => {
  const short = (a: string) => a.slice(0, 9);
  assert.equal(
    forceBatchSummary([{ member: A, newAddress: B, evidence: "" }], short),
    `Move membership ${A.slice(0, 9)} to ${B.slice(0, 9)}`,
  );
  assert.equal(
    forceBatchSummary(
      [
        { member: A, newAddress: B, evidence: "" },
        { member: C, newAddress: D, evidence: "" },
      ],
      short,
    ),
    "Move 2 memberships to new addresses",
  );
});
