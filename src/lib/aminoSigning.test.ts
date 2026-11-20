import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fillNonNullable, renderAminoJson } from "@sparkdreamnft/sparkdreamjs/chain-amino";
import { buildSigningTypes } from "./signingTypes";
import {
  recurringPaymentGrantMsg,
  scheduledTransferGrantMsg,
  sessionKeyGrantMsg,
  signInGrantMsg,
  spendingAllowanceGrantMsg,
} from "./grantMsgs";
import { normalizeSignValue } from "./signText";
import { emptyMintPolicyState, mintPolicyToMsg } from "../components/artifacts/CreateClassForm";
import { addSourceMsg, cancelRequestMsg, disputeCompletionMsg, requestCopyMsg } from "./storageMsgs";
import {
  approveOperatorMsg,
  approveScannerMsg,
  packStorageCouncilMsg,
  removeOperatorMsg,
  removeScannerMsg,
  unflagRemovedMsg,
  updateStoragePricesMsg,
  voidCompletionMsg,
} from "./storageCouncilMsgs";

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
  // Records the sign doc the wallet signed, as WalletContext does for a Ledger.
  let signedDoc: { msgs: readonly unknown[] } | null = null;
  const recordingWallet = {
    getAccounts: () => wallet.getAccounts(),
    signAmino: async (address: string, doc: Parameters<typeof wallet.signAmino>[1]) => {
      const res = await wallet.signAmino(address, doc);
      signedDoc = res.signed;
      return res;
    },
  };
  const client = await SigningStargateClient.offline(recordingWallet, { registry, aminoTypes });
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v;

  const pack = (typeUrl: string, value: unknown) => ({ typeUrl, value: registry.encode({ typeUrl, value }) });
  const coin = (amount: string) => ({ denom: "uspark", amount });
  const send = { fromAddress: me, toAddress: me, amount: [coin("5")] };
  const policy = "sprkdrm1policy0000000000000000000000000000000000000000000";
  const grantBase = { granter: me, grantee: me, expiresAt: new Date("2027-01-01T00:00:00Z"), note: " a note " };

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
      label: "storage request, added source, dispute by the requester and cancel",
      // The forms' own builders (lib/storageMsgs.ts).
      msgs: [
        requestCopyMsg({
          requester: me, backend: "arweave", sha256: "ab".repeat(32), sizeBytes: 22637, contentType: "image/png",
          url: "https://files.phoenix.example/a.png", maxFee: "2000000",
        }),
        addSourceMsg(me, "7", "https://files.aurora.example/a.png", "1000000"),
        disputeCompletionMsg(me, "7", "0"),
        cancelRequestMsg(me, "0"),
      ],
    },
    {
      label: "council proposal with the storage council messages",
      // The proposal form's own builders and packer (lib/storageCouncilMsgs.ts).
      msgs: [{
        typeUrl: "/sparkdream.commons.v1.MsgSubmitProposal",
        value: {
          proposer: me, policyAddress: policy, metadata: "",
          messages: await Promise.all([
            approveOperatorMsg(policy, "arweave", me),
            removeOperatorMsg(policy, "arweave", me),
            approveScannerMsg(policy, me),
            removeScannerMsg(policy, me),
            voidCompletionMsg(policy, "7", "the copy does not match the file"),
            unflagRemovedMsg(policy, ["ab".repeat(32), "cd".repeat(32)]),
            updateStoragePricesMsg(policy, "arweave", "10", "1000000"),
            // Zero prices: the chain renders them, never omits them.
            updateStoragePricesMsg(policy, "arweave", "0", "0"),
          ].map(packStorageCouncilMsg)),
        },
      }],
    },
    {
      label: "artifact class with default policies, mint and buy",
      msgs: [
        { typeUrl: "/sparkdream.artifact.v1.MsgCreateClass", value: {
          creator: me, name: "n", symbol: "S", flags: { transferable: true }, acceptedContentLicense: "CC0-1.0", expectedClassId: BigInt(5),
          // The form's own builder, on the form's initial state.
          mintPolicy: mintPolicyToMsg(emptyMintPolicyState(), false, "uspark").policy,
        } },
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
    // The Permissions forms, through the builders the forms call
    // (grantMsgs.ts): what is signed here is what the forms send.
    {
      label: "session key grant (SessionKeyForm)",
      msgs: [sessionKeyGrantMsg(
        { ...grantBase, expiresAt: new Date("2027-01-01T00:00:00.047Z") },
        { allowedMsgTypes: ["/sparkdream.blog.v1.MsgCreatePost", "/sparkdream.blog.v1.MsgReact"], denom: "uspark", spendLimit: "100000000", maxExecCount: 10000, allowSelfRevoke: false },
      )],
    },
    {
      label: "session key grant with self-revoke (SessionKeyForm)",
      msgs: [sessionKeyGrantMsg(grantBase, { allowedMsgTypes: ["/sparkdream.forum.v1.MsgCreatePost"], denom: "uspark", spendLimit: "1", maxExecCount: 1, allowSelfRevoke: true })],
    },
    {
      label: "spending allowance grant (SpendingAllowanceForm)",
      msgs: [spendingAllowanceGrantMsg(grantBase, { denom: "uspark", maxPerPeriod: "1000000", periodSeconds: 86400, allowedRecipients: [] })],
    },
    {
      label: "spending allowance grant with recipients (SpendingAllowanceForm)",
      msgs: [spendingAllowanceGrantMsg(grantBase, { denom: "uspark", maxPerPeriod: "1000000", periodSeconds: 3600, allowedRecipients: [me] })],
    },
    {
      label: "recurring payment grant (RecurringPaymentForm)",
      msgs: [recurringPaymentGrantMsg(grantBase, { denom: "uspark", amountPerPeriod: "100", periodSeconds: 86400, startTime: 1800000000, maxPerEpoch: null })],
    },
    {
      label: "scheduled transfer grant (ScheduledTransferForm)",
      msgs: [scheduledTransferGrantMsg(grantBase, { denom: "uspark", amount: "250", fireAt: 1800000000 })],
    },
    {
      label: "sign-in grant (SignInGrantForm)",
      msgs: [signInGrantMsg(grantBase, "mstdn.sparkdream.io")],
    },
    // A pasted line separator: signAndBroadcast normalizes every message
    // (signText.ts), since the chain escapes that character and the wallet
    // does not.
    {
      label: "blog post with pasted line and paragraph separators",
      msgs: [{
        typeUrl: "/sparkdream.blog.v1.MsgCreatePost",
        value: normalizeSignValue({ creator: me, title: `t${String.fromCharCode(0x2028)}u`, body: `b${String.fromCharCode(0x2029)}c`, contentType: 1, tags: [] }),
      }],
    },
    // The same grants with the chain-written fields left out: sparkdreamjs
    // (0.0.52+) renders them into the sign doc itself.
    {
      label: "session key grant with the usage counters left out",
      msgs: [{
        typeUrl: "/sparkdream.session.v1.MsgCreateGrant",
        value: {
          granter: me, grantee: me, expiresAt: new Date("2027-01-01T00:00:00.047Z"), note: "",
          sessionKey: {
            allowedMsgTypes: ["/sparkdream.blog.v1.MsgCreatePost"], spendLimit: coin("100000000"),
            maxExecCount: BigInt(10000), allowSelfRevoke: false,
          },
        },
      }],
    },
    {
      label: "artifact class with empty price amounts",
      msgs: [{
        typeUrl: "/sparkdream.artifact.v1.MsgCreateClass",
        value: {
          creator: me, name: "n", symbol: "S", flags: { transferable: true }, acceptedContentLicense: "CC0-1.0", expectedClassId: BigInt(5),
          mintPolicy: { publicMintEnabled: false, price: coin("0"), startTime: BigInt(0), endTime: BigInt(0), perAddressLimit: 0, pricing: 0, priceStep: "", floorPrice: "" },
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
      label: "gov v1 expedited software upgrade with a deposit",
      msgs: [{
        typeUrl: "/cosmos.gov.v1.MsgSubmitProposal",
        value: {
          messages: [pack("/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade", { authority: policy, plan: { name: "v2", height: BigInt(100), info: "" } })],
          initialDeposit: [coin("250000000")], proposer: me, metadata: "", title: "t", summary: "s", expedited: true,
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
    assert.ok(signedDoc, c.label);
    const signedMsgs = (signedDoc as { msgs: readonly unknown[] }).msgs;
    body.messages.forEach((m, j) => {
      assert.equal(m.typeUrl, c.msgs[j].typeUrl, c.label);
      // The check that decides whether the chain accepts the signature: what
      // was signed must be what the chain renders from the tx body.
      // renderAminoJson is the chain's rendering (re-encoding included),
      // pinned to it by the golden records.
      if (m.typeUrl.startsWith("/sparkdream.") || m.typeUrl.startsWith("/cosmos.gov.v1.")) {
        assert.deepEqual(canon(signedMsgs[j]), canon(renderAminoJson(m.typeUrl, m.value)), `${c.label}: signed doc differs from the chain's rendering of ${m.typeUrl}`);
      }
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
