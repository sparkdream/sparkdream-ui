import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fillNonNullable, renderAminoJson } from "@sparkdreamnft/sparkdreamjs/chain-amino";
import { buildSigningTypes } from "./signingTypes";

// End-to-end amino signing through the same registry and AminoTypes the app
// signs with, with an amino-only key (as Keplr+Ledger is). Each message is
// built the way the app builds it: camelCase values, BigInt for 64-bit
// integers, inner messages packed into Anys through the registry.
//
// The test checks that cosmjs accepts every message and that the tx body
// carries the message the app built, as the chain reads it (with
// dont_omitempty embedded messages filled in, as Go clients send them). To check the signatures the way
// the chain's ante handler does, write the signed transactions out and run
// the chain repo's verifier over them:
//
//   AMINO_SIGNED_OUT=/tmp/signed.jsonl npm test
//   cd ../sparkdream && go run ./cmd/aminogolden verify < /tmp/signed.jsonl

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const CHAIN_ID = "sparkdream-test-1";

test("amino-signed transactions carry the messages the app built", async () => {
  const { Secp256k1HdWallet } = await import("@cosmjs/amino");
  const { SigningStargateClient } = await import("@cosmjs/stargate");
  const { TxRaw, TxBody } = await import("cosmjs-types/cosmos/tx/v1beta1/tx");
  const { registry, aminoTypes } = await buildSigningTypes();

  const wallet = await Secp256k1HdWallet.fromMnemonic(MNEMONIC, { prefix: "sprkdrm" });
  const [account] = await wallet.getAccounts();
  const me = account.address;
  const client = await SigningStargateClient.offline(wallet, { registry, aminoTypes });

  const pack = (typeUrl: string, value: unknown) => ({ typeUrl, value: registry.encode({ typeUrl, value }) });
  const coin = (amount: string) => ({ denom: "uspark", amount });
  const send = { fromAddress: me, toAddress: me, amount: [coin("5")] };
  const policy = "sprkdrm1policy0000000000000000000000000000000000000000000";

  const cases: Array<{ label: string; msgs: { typeUrl: string; value: unknown }[] }> = [
    {
      label: "blog post",
      msgs: [{ typeUrl: "/sparkdream.blog.v1.MsgCreatePost", value: { creator: me, title: "t", body: "b", contentType: 1, tags: [] } }],
    },
    {
      label: "session-wrapped forum post",
      msgs: [{
        typeUrl: "/sparkdream.session.v1.MsgExecSession",
        value: {
          grantee: me, granter: me,
          msgs: [pack("/sparkdream.forum.v1.MsgCreatePost", { creator: me, categoryId: BigInt(1), content: "hi", tags: [] })],
        },
      }],
    },
    {
      label: "juror vote with a Dec confidence",
      msgs: [{
        typeUrl: "/sparkdream.rep.v1.MsgSubmitJurorVote",
        value: { juror: me, juryReviewId: BigInt(3), criteriaVotes: [], verdict: 1, confidence: "0.75", reasoning: "r" },
      }],
    },
    {
      label: "council proposal with a bank send and a sparkdream message",
      msgs: [{
        typeUrl: "/sparkdream.commons.v1.MsgSubmitProposal",
        value: {
          proposer: me, policyAddress: policy, metadata: "",
          messages: [
            pack("/cosmos.bank.v1beta1.MsgSend", { ...send, fromAddress: policy }),
            pack("/sparkdream.rep.v1.MsgForceMigration", { authority: policy, member: me, newAddress: me, evidenceUri: "ipfs://x" }),
          ],
        },
      }],
    },
    {
      label: "vault propose and approve",
      msgs: [
        {
          typeUrl: "/sparkdream.vault.v1.MsgPropose",
          value: { signer: me, vaultId: BigInt(1), messages: [pack("/cosmos.bank.v1beta1.MsgSend", send)], memo: "", execute: false },
        },
        {
          typeUrl: "/sparkdream.vault.v1.MsgApprove",
          value: { signer: me, proposalId: BigInt(2), messagesHash: new Uint8Array([1, 2, 3]), execute: true },
        },
      ],
    },
    {
      label: "artifact class with default policies, mint and buy",
      msgs: [
        { typeUrl: "/sparkdream.artifact.v1.MsgCreateClass", value: { creator: me, name: "n", symbol: "S", flags: { transferable: true }, acceptedContentLicense: "CC0-1.0", expectedClassId: BigInt(5) } },
        { typeUrl: "/sparkdream.artifact.v1.MsgMint", value: { minter: me, classId: BigInt(1), entries: [{ recipient: me, metadata: { name: "x" } }] } },
        { typeUrl: "/sparkdream.artifact.v1.MsgBuy", value: { buyer: me, classId: BigInt(1), tokenId: BigInt(1), expectedPrice: coin("10"), expectedNonce: BigInt(0) } },
      ],
    },
    {
      label: "recovery commitment and invitation acceptance",
      msgs: [
        { typeUrl: "/sparkdream.rep.v1.MsgSetRecoveryCommitment", value: { member: me, commitment: new Uint8Array(32).fill(7), replaces: new Uint8Array() } },
        { typeUrl: "/sparkdream.rep.v1.MsgAcceptInvitation", value: { invitee: me, invitationId: BigInt(4), acceptedContentLicense: "CC0-1.0", recoveryCommitment: new Uint8Array() } },
      ],
    },
    {
      label: "recurring pull grant (oneof payload)",
      msgs: [{
        typeUrl: "/sparkdream.session.v1.MsgCreateGrant",
        value: {
          granter: me, grantee: me, expiresAt: new Date("2027-01-01T00:00:00Z"), note: "",
          recurringPull: { amountPerPeriod: coin("100"), periodSeconds: BigInt(86400), startTime: BigInt(0), maxPerEpoch: "" },
        },
      }],
    },
    {
      label: "gov v1 software upgrade with no deposit",
      msgs: [{
        typeUrl: "/cosmos.gov.v1.MsgSubmitProposal",
        value: {
          messages: [pack("/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade", { authority: policy, plan: { name: "v2", height: BigInt(100), info: "" } })],
          initialDeposit: [], proposer: me, metadata: "", title: "t", summary: "s", expedited: false,
        },
      }],
    },
    {
      label: "plain bank send",
      msgs: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: send }],
    },
  ];

  const out: string[] = [];
  const fee = { amount: [coin("7500")], gas: "300000" };
  for (const [i, c] of cases.entries()) {
    const signerData = { accountNumber: BigInt(12), sequence: i, chainId: CHAIN_ID };
    const raw = await client.sign(me, c.msgs, fee, "memo", signerData);
    const body = TxBody.decode(raw.bodyBytes);
    assert.equal(body.messages.length, c.msgs.length, c.label);
    body.messages.forEach((m, j) => {
      assert.equal(m.typeUrl, c.msgs[j].typeUrl, c.label);
      // The body must carry the message the app built (with dont_omitempty
      // messages filled in), as the chain reads it: compare renderings.
      // Messages the package's schema doesn't cover (bank) compare as bytes.
      const sent = registry.encode({ typeUrl: m.typeUrl, value: fillNonNullable(m.typeUrl.slice(1), c.msgs[j].value) });
      if (m.typeUrl.startsWith("/sparkdream.") || m.typeUrl.startsWith("/cosmos.gov.v1.")) {
        assert.deepEqual(renderAminoJson(m.typeUrl, m.value), renderAminoJson(m.typeUrl, sent), `${c.label}: ${m.typeUrl}`);
      } else {
        assert.deepEqual(Buffer.from(m.value), Buffer.from(sent), `${c.label}: ${m.typeUrl}`);
      }
    });
    out.push(JSON.stringify({
      label: c.label,
      tx: Buffer.from(TxRaw.encode(raw).finish()).toString("hex"),
      chain_id: CHAIN_ID,
      account_number: Number(signerData.accountNumber),
      sequence: signerData.sequence,
      pubkey: Buffer.from(account.pubkey).toString("base64"),
    }));
  }
  if (process.env.AMINO_SIGNED_OUT) fs.writeFileSync(process.env.AMINO_SIGNED_OUT, out.join("\n") + "\n");
});
