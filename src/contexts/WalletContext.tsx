"use client";

import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import { useChainConfig } from "./ChainConfigContext";
import type { Session } from "@/types/session";
import { getCommonsParams, getSessionsByGrantee, isArchiveModeActive } from "@/lib/api";
import { CommonsMsgTypeUrls, SessionMsgTypeUrls } from "@/lib/tx";

/**
 * Phases a tx walks through, in order. Callers pass `onPhase` to drive UI
 * (button label, elapsed timer) so users see progress instead of a stuck spinner.
 *  - "signing":     Keplr popup is open / awaiting user signature
 *  - "broadcasting": signed; sending to the RPC mempool
 *  - "confirming":   accepted by mempool; polling for block inclusion
 */
export type TxPhase = "signing" | "broadcasting" | "confirming";

interface WalletState {
  /** Returns the granter address when session mode is active, otherwise the connected wallet address. */
  address: string | null;
  /** Always returns the actual connected wallet (hot wallet) address. */
  signerAddress: string | null;
  name: string | null;
  connected: boolean;
  connecting: boolean;
  /** True once the initial auto-reconnect attempt has resolved (or was skipped). */
  ready: boolean;
  isLedger: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signAndBroadcast: (
    msgs: readonly { typeUrl: string; value: unknown }[],
    memo?: string,
    onPhase?: (phase: TxPhase, hash?: string) => void,
  ) => Promise<string>;
  // Session mode
  sessionActive: boolean;
  activeSession: Session | null;
  availableSessions: Session[];
  activateSession: (session: Session) => void;
  deactivateSession: () => void;
}

const WalletContext = createContext<WalletState>({
  address: null,
  signerAddress: null,
  name: null,
  connected: false,
  connecting: false,
  ready: false,
  isLedger: false,
  connect: async () => {},
  disconnect: () => {},
  signAndBroadcast: async () => "",
  sessionActive: false,
  activeSession: null,
  availableSessions: [],
  activateSession: () => {},
  deactivateSession: () => {},
});

export function useWallet() {
  return useContext(WalletContext);
}

// Session management message typeUrls that should never be wrapped in MsgExecSession
const SESSION_MGMT_TYPES: Set<string> = new Set([
  SessionMsgTypeUrls.CreateSession,
  SessionMsgTypeUrls.RevokeSession,
  SessionMsgTypeUrls.ExecSession,
]);

// Inner-message typeUrls that x/commons exempts from the ProposalFee
// ante-handler check (see x/commons/ante/group_policy.go). Mirroring the
// chain's list here means signaling votes (empty messages) and emergency
// actions still use the default tx fee instead of paying 5 SPARK.
const PROPOSAL_FEE_EXEMPT_INNER_TYPES: Set<string> = new Set([
  "/sparkdream.commons.v1.MsgEmergencyCancelGovProposal",
  "/sparkdream.commons.v1.MsgVetoGroupProposals",
]);

/**
 * True if `msgs` contains a MsgSubmitProposal that requires the proposal fee.
 * Mirrors x/commons/ante/group_policy.go: signaling proposals (no inner
 * messages) pay the fee; otherwise any non-exempt inner message triggers it.
 */
function txRequiresProposalFee(msgs: readonly { typeUrl: string; value: unknown }[]): boolean {
  return msgs.some((m) => {
    if (m.typeUrl !== CommonsMsgTypeUrls.SubmitProposal) return false;
    const v = m.value as { messages?: readonly { typeUrl: string }[] };
    const inners = v.messages ?? [];
    if (inners.length === 0) return true;
    return inners.some((inner) => !PROPOSAL_FEE_EXEMPT_INNER_TYPES.has(inner.typeUrl));
  });
}

/**
 * Parse a `sdk.Coins`-formatted string like "5000000uspark" or
 * "100uspark,200uother" into discrete `{denom, amount}` entries.
 */
function parseCoinsString(s: string): Array<{ denom: string; amount: string }> {
  if (!s.trim()) return [];
  return s.split(",").map((chunk) => {
    const m = chunk.trim().match(/^(\d+)([a-zA-Z][a-zA-Z0-9/]*)$/);
    if (!m) throw new Error(`invalid coin string: ${chunk}`);
    return { amount: m[1], denom: m[2] };
  });
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { config, chainInfo } = useChainConfig();
  const [rawAddress, setRawAddress] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [isLedger, setIsLedger] = useState(false);
  const [ready, setReady] = useState(false);
  const needsSessionRestore = useRef(false);

  // Session mode state
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [availableSessions, setAvailableSessions] = useState<Session[]>([]);

  const sessionActive = activeSession !== null;
  const address = activeSession ? activeSession.granter : rawAddress;

  const connect = useCallback(async () => {
    if (typeof window === "undefined" || !window.keplr) {
      alert("Please install Keplr wallet extension");
      return;
    }

    setConnecting(true);
    try {
      await window.keplr.experimentalSuggestChain(chainInfo);
      await window.keplr.enable(config.chainId);

      const key = await window.keplr.getKey(config.chainId);
      setName(key.name);
      setIsLedger(!!key.isNanoLedger);

      const offlineSigner = key.isNanoLedger
        ? window.keplr.getOfflineSignerOnlyAmino(config.chainId)
        : window.keplr.getOfflineSigner(config.chainId);
      const accounts = await offlineSigner.getAccounts();
      if (accounts.length > 0) {
        setRawAddress(accounts[0].address);
      }

      localStorage.setItem("wallet_connected", "true");
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    } finally {
      setConnecting(false);
    }
  }, [config.chainId, chainInfo]);

  const disconnect = useCallback(() => {
    setRawAddress(null);
    setName(null);
    setIsLedger(false);
    setActiveSession(null);
    setAvailableSessions([]);
    localStorage.removeItem("wallet_connected");
    localStorage.removeItem("session_granter");
  }, []);

  const signAndBroadcast = useCallback(
    async (
      msgs: readonly { typeUrl: string; value: unknown }[],
      memo = "",
      onPhase?: (phase: TxPhase, hash?: string) => void,
    ) => {
      if (isArchiveModeActive()) {
        throw new Error("Archive mode is read-only");
      }
      if (!rawAddress || !window.keplr) {
        throw new Error("Wallet not connected");
      }

      const { SigningStargateClient, AminoTypes, defaultRegistryTypes, createDefaultAminoConverters } = await import("@cosmjs/stargate");
      const { Registry } = await import("@cosmjs/proto-signing");
      type GeneratedType = import("@cosmjs/proto-signing").GeneratedType;
      type EncodeObject = import("@cosmjs/proto-signing").EncodeObject;
      // Both the TsProto and Pbjs codecs that ship in cosmjs-types have
      // `encode`/`fromPartial` but with incompatible argument shapes — the
      // union doesn't simplify into a callable type, so calls through
      // `registry.lookupType` need a narrowing cast. This is the structural
      // shape both halves satisfy.
      type RegistryCodec = {
        encode: (msg: unknown) => { finish: () => Uint8Array };
        fromPartial: (val: unknown) => unknown;
      };

      const { load: loadBlog } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx.registry");
      const { load: loadSession } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx.registry");
      const { load: loadCommons } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx.registry");
      const { load: loadRep } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx.registry");
      const { load: loadCollect } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx.registry");
      const { load: loadName } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/name/v1/tx.registry");
      const { load: loadForum } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx.registry");
      const { load: loadSeason } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/season/v1/tx.registry");
      const { load: loadReveal } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/tx.registry");
      const { load: loadFutarchy } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/futarchy/v1/tx.registry");
      // Gov v1 + upgrade types (not in defaultRegistryTypes which only has v1beta1)
      const { MsgSubmitProposal: GovV1MsgSubmitProposal } = await import("cosmjs-types/cosmos/gov/v1/tx");
      const { MsgSoftwareUpgrade, MsgCancelUpgrade } = await import("cosmjs-types/cosmos/upgrade/v1beta1/tx");

      const registry = new Registry(defaultRegistryTypes);
      registry.register("/cosmos.gov.v1.MsgSubmitProposal", GovV1MsgSubmitProposal as unknown as GeneratedType);
      registry.register("/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade", MsgSoftwareUpgrade as unknown as GeneratedType);
      registry.register("/cosmos.upgrade.v1beta1.MsgCancelUpgrade", MsgCancelUpgrade as unknown as GeneratedType);
      loadBlog(registry);
      loadSession(registry);
      loadCommons(registry);
      loadRep(registry);
      loadCollect(registry);
      loadName(registry);
      loadForum(registry);
      loadSeason(registry);
      loadReveal(registry);
      loadFutarchy(registry);

      const { AminoConverter: blogAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx.amino");
      const { AminoConverter: sessionAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx.amino");
      const { AminoConverter: commonsAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx.amino");
      const { AminoConverter: repAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx.amino");
      const { AminoConverter: collectAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx.amino");
      const { AminoConverter: nameAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/name/v1/tx.amino");
      const { AminoConverter: forumAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx.amino");
      const { AminoConverter: seasonAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/season/v1/tx.amino");
      const { AminoConverter: revealAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/tx.amino");
      const { AminoConverter: futarchyAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/futarchy/v1/tx.amino");

      // The published sparkdreamjs (0.0.19) ships the registry + proto codecs
      // for the new Pin/MakePermanent-separation and forum post-conviction
      // messages but its generated AminoConverter maps omit them, so
      // amino-signing (Keplr/Ledger) these would fail with "does not exist in
      // the Amino message type register".
      // The proto message classes still carry the telescope-generated
      // toAmino/fromAmino statics (the messages have no repeated fields, so the
      // omit-empty traps that forced the src-overrides overlays don't apply
      // here), so wire converters by delegating to them, mirroring exactly how
      // the package's own tx.amino does it. Amino names match the chain's
      // `option (amino.name)` in each module's tx.proto.
      const { MsgMakePostPermanent: BlogMakePostPermanent, MsgMakeReplyPermanent: BlogMakeReplyPermanent, MsgUnpinPost: BlogUnpinPost, MsgUnpinReply: BlogUnpinReply } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx");
      const { MsgMakePostPermanent: ForumMakePostPermanent, MsgStakePostConviction: ForumStakePostConviction, MsgReleasePostConviction: ForumReleasePostConviction } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx");
      const { MsgMakeCollectionPermanent: CollectMakeCollectionPermanent, MsgUnpinCollection: CollectUnpinCollection } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx");
      const pinSeparationAmino = {
        "/sparkdream.blog.v1.MsgMakePostPermanent": { aminoType: "sparkdream/x/blog/MsgMakePostPermanent", toAmino: BlogMakePostPermanent.toAmino, fromAmino: BlogMakePostPermanent.fromAmino },
        "/sparkdream.blog.v1.MsgMakeReplyPermanent": { aminoType: "sparkdream/x/blog/MsgMakeReplyPermanent", toAmino: BlogMakeReplyPermanent.toAmino, fromAmino: BlogMakeReplyPermanent.fromAmino },
        "/sparkdream.blog.v1.MsgUnpinPost": { aminoType: "sparkdream/x/blog/MsgUnpinPost", toAmino: BlogUnpinPost.toAmino, fromAmino: BlogUnpinPost.fromAmino },
        "/sparkdream.blog.v1.MsgUnpinReply": { aminoType: "sparkdream/x/blog/MsgUnpinReply", toAmino: BlogUnpinReply.toAmino, fromAmino: BlogUnpinReply.fromAmino },
        "/sparkdream.forum.v1.MsgMakePostPermanent": { aminoType: "sparkdream/x/forum/MsgMakePostPermanent", toAmino: ForumMakePostPermanent.toAmino, fromAmino: ForumMakePostPermanent.fromAmino },
        "/sparkdream.forum.v1.MsgStakePostConviction": { aminoType: "sparkdream/x/forum/MsgStakePostConviction", toAmino: ForumStakePostConviction.toAmino, fromAmino: ForumStakePostConviction.fromAmino },
        "/sparkdream.forum.v1.MsgReleasePostConviction": { aminoType: "sparkdream/x/forum/MsgReleasePostConviction", toAmino: ForumReleasePostConviction.toAmino, fromAmino: ForumReleasePostConviction.fromAmino },
        "/sparkdream.collect.v1.MsgMakeCollectionPermanent": { aminoType: "sparkdream/x/collect/MsgMakeCollectionPermanent", toAmino: CollectMakeCollectionPermanent.toAmino, fromAmino: CollectMakeCollectionPermanent.fromAmino },
        "/sparkdream.collect.v1.MsgUnpinCollection": { aminoType: "sparkdream/x/collect/MsgUnpinCollection", toAmino: CollectUnpinCollection.toAmino, fromAmino: CollectUnpinCollection.fromAmino },
      };

      // Telescope's auto-generated amino converters don't recursively decode
      // `repeated google.protobuf.Any` fields, so MsgSubmitProposal /
      // MsgSubmitAnonymousProposal / MsgExecSession need the registry + the
      // assembled AminoTypes wired into sparkdreamjs's hand-written override
      // before any amino signing can happen (otherwise Ledger users hit
      // "JSON Dictionaries are not sorted" / "signature verification failed").
      // The same helpers also back our hand-rolled /cosmos.gov.v1.MsgSubmitProposal
      // converter below, so import them eagerly here.
      const { configureNestedAminoConverter, anyToAmino, aminoToAny } = await import("@sparkdreamnft/sparkdreamjs/nested-amino");

      // CosmJS's createGovAminoConverters() only registers v1beta1
      // (https://github.com/cosmos/cosmjs/issues/1442), so amino-signing a
      // chain proposal otherwise fails with
      // `Type URL '/cosmos.gov.v1.MsgSubmitProposal' does not exist in the
      // Amino message type register`. Sign bytes must match
      // cosmossdk.io/x/tx/signing/aminojson on the chain: snake_case keys,
      // fields at their zero value omitted (matching aminojson's omitempty),
      // and the inner `messages` Anys recursively amino-converted via the
      // same nested-amino helpers the commons MsgSubmitProposal converter
      // already uses.
      const govV1AminoConverters = {
        "/cosmos.gov.v1.MsgSubmitProposal": {
          aminoType: "cosmos-sdk/v1/MsgSubmitProposal",
          toAmino: (msg: {
            messages?: { typeUrl: string; value: Uint8Array }[];
            initialDeposit?: { denom: string; amount: string }[];
            proposer?: string;
            metadata?: string;
            title?: string;
            summary?: string;
            expedited?: boolean;
          }) => ({
            messages:
              (msg.messages?.length ?? 0) > 0
                ? msg.messages!.map((m) => anyToAmino(m))
                : undefined,
            // initial_deposit is `(amino.dont_omitempty)=true` +
            // `(amino.encoding)="legacy_coins"` in cosmos-sdk's gov/v1/tx.proto,
            // so cosmossdk.io/x/tx/signing/aminojson always emits the key
            // (chain's `nullSliceAsEmptyEncoder` writes `[]` for empty Coins).
            // Dropping it to `undefined` for zero-deposit proposals signed JSON
            // without the key while the chain reconstructed `"initial_deposit":[]`,
            // failing sigverify as "unauthorized" — that's what was killing every
            // ParamChangeForm submission with no deposit (and every other
            // zero-deposit gov-v1 proposal flow: software-upgrade, register-council,
            // cancel-market, plain signaling).
            initial_deposit: msg.initialDeposit ?? [],
            proposer: msg.proposer ? msg.proposer : undefined,
            metadata: msg.metadata ? msg.metadata : undefined,
            title: msg.title ? msg.title : undefined,
            summary: msg.summary ? msg.summary : undefined,
            expedited: msg.expedited ? msg.expedited : undefined,
          }),
          fromAmino: (obj: {
            messages?: { type: string; value: unknown }[];
            initial_deposit?: { denom: string; amount: string }[];
            proposer?: string;
            metadata?: string;
            title?: string;
            summary?: string;
            expedited?: boolean;
          }) => ({
            messages: (obj.messages ?? []).map((m) => aminoToAny(m)),
            initialDeposit: Array.from(obj.initial_deposit ?? []),
            proposer: obj.proposer ?? "",
            metadata: obj.metadata ?? "",
            title: obj.title ?? "",
            summary: obj.summary ?? "",
            expedited: obj.expedited ?? false,
          }),
        },
      };

      // cosmjs ships no upgrade-module amino converters at all (only
      // SoftwareUpgradeProposal v1beta1 legacy content type, not the Msg-based
      // v1 flow), so amino-signing a MsgSoftwareUpgrade — directly or wrapped
      // in MsgSubmitProposal — otherwise fails with
      // `Type URL '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade' does not exist
      // in the Amino message type register`. The amino name comes from the
      // chain's proto (`option (amino.name) = "cosmos-sdk/MsgSoftwareUpgrade"`).
      // Plan.upgraded_client_state is deprecated and the SDK rejects upgrades
      // that set it, so we omit it entirely. Plan.time is *also* deprecated,
      // but its proto field has `(amino.dont_omitempty) = true` (see
      // cosmossdk.io@v0.53.0/proto/cosmos/upgrade/v1beta1/upgrade.proto:31),
      // so the chain's aminojson always emits it as `marshalTimestamp(default
      // Timestamp) = "1970-01-01T00:00:00Z"` even though the upgrade keeper
      // rejects any non-zero value. Omitting `time` from our sign bytes broke
      // every software-upgrade proposal as "signature verification failed"
      // because the JS-signed JSON lacked the key the chain reconstructed.
      // Mirror the chain by always emitting the zero-time string. Other Plan
      // fields (name / height / info) have no dont_omitempty annotation, so
      // they follow aminojson's standard omit-when-zero/empty behavior.
      const upgradeV1beta1AminoConverters = {
        "/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade": {
          aminoType: "cosmos-sdk/MsgSoftwareUpgrade",
          toAmino: (msg: {
            authority?: string;
            plan?: { name?: string; height?: bigint | string; info?: string };
          }) => ({
            authority: msg.authority ? msg.authority : undefined,
            // MsgSoftwareUpgrade.plan is `(amino.dont_omitempty)=true` +
            // `(gogoproto.nullable)=false` — the chain always emits the `plan`
            // key (with `{}` for an absent plan after the inner-field
            // omitempties drop name/height/info). In practice every code path
            // populates msg.plan, but match the chain's shape unconditionally.
            plan: {
              name: msg.plan?.name ? msg.plan.name : undefined,
              // Mirror the chain's marshalTimestamp output for the default
              // Timestamp (seconds=0, nanos=0) — this is what the keeper sees
              // and re-encodes into sign bytes.
              time: "1970-01-01T00:00:00Z",
              height:
                msg.plan?.height !== undefined && msg.plan.height.toString() !== "0"
                  ? msg.plan.height.toString()
                  : undefined,
              info: msg.plan?.info ? msg.plan.info : undefined,
            },
          }),
          fromAmino: (obj: {
            authority?: string;
            plan?: { name?: string; height?: string; info?: string };
          }) => ({
            authority: obj.authority ?? "",
            plan: {
              name: obj.plan?.name ?? "",
              // We never round-trip a non-default time (chain rejects it
              // anyway), so leave the proto field undefined; cosmjs's
              // Plan.fromPartial seeds it back to Timestamp.fromPartial({})
              // which matches the wire shape we produced on the way in.
              time: undefined,
              height: BigInt(obj.plan?.height ?? "0"),
              info: obj.plan?.info ?? "",
              upgradedClientState: undefined,
            },
          }),
        },
        "/cosmos.upgrade.v1beta1.MsgCancelUpgrade": {
          aminoType: "cosmos-sdk/MsgCancelUpgrade",
          toAmino: (msg: { authority?: string }) => ({
            authority: msg.authority ? msg.authority : undefined,
          }),
          fromAmino: (obj: { authority?: string }) => ({
            authority: obj.authority ?? "",
          }),
        },
      };

      const aminoTypes = new AminoTypes({ ...createDefaultAminoConverters(), ...blogAmino, ...sessionAmino, ...commonsAmino, ...repAmino, ...collectAmino, ...nameAmino, ...forumAmino, ...seasonAmino, ...revealAmino, ...futarchyAmino, ...pinSeparationAmino, ...govV1AminoConverters, ...upgradeV1beta1AminoConverters });
      // Cast: cosmjs's `lookupType` returns `GeneratedType` (union of TsProto +
      // Pbjs); the override only ever encounters TsProto types here.
      configureNestedAminoConverter({ registry: registry as unknown as Parameters<typeof configureNestedAminoConverter>[0]["registry"], aminoTypes });

      // Keplr's default `signAmino`/`signDirect` quietly overrides the fee in
      // our sign doc with its own gas-price calculation, which falls under
      // both the chain's `min-gas-prices` floor (after we stopped underpaying)
      // and the 5 SPARK ProposalFee, bouncing every signed tx. Set Keplr's
      // global signing flags so every signAmino/signDirect call from this
      // session honors what we put in the sign doc. This is the
      // canonical Keplr pattern — wrapping the offline signer instead would
      // skip its internal cosmjs-vs-keplr shape conversion and break sig
      // verification on plain txs (regressed once before).
      if (window.keplr.defaultOptions) {
        window.keplr.defaultOptions.sign = {
          ...(window.keplr.defaultOptions.sign ?? {}),
          preferNoSetFee: true,
          preferNoSetMemo: true,
        };
      } else {
        window.keplr.defaultOptions = {
          sign: { preferNoSetFee: true, preferNoSetMemo: true },
        };
      }

      const key = await window.keplr.getKey(config.chainId);
      const offlineSigner = key.isNanoLedger
        ? window.keplr.getOfflineSignerOnlyAmino(config.chainId)
        : window.keplr.getOfflineSigner(config.chainId);

      const client = await SigningStargateClient.connectWithSigner(
        config.rpcEndpoint,
        offlineSigner,
        { registry, aminoTypes }
      );

      // Derive the minimum fee from the chain's registered gas price
      // (average step). This matches what validators accept as `min-gas-prices`
      // — using a hard-coded 5000 underpaid 0.025 × 300000 = 7500 and the chain
      // rejected with "insufficient fee" once we stopped letting Keplr silently
      // bump the fee for us. Fallback to 0.025 if chainInfo somehow omits it.
      const gas = 300000;
      const gasPrice = chainInfo.feeCurrencies?.[0]?.gasPriceStep?.average ?? 0.025;
      const minFeeAmount = Math.ceil(gasPrice * gas);
      let fee = {
        amount: [{ denom: config.denom, amount: String(minFeeAmount) }],
        gas: String(gas),
      };

      // x/commons enforces a min tx fee on MsgSubmitProposal containing
      // non-exempt inner messages (5 SPARK by default). Query the live
      // param so future changes don't strand the UI on a stale constant.
      // Per-denom we take the max of (gas-price floor, proposal-fee minimum)
      // so we always clear both ante checks.
      if (txRequiresProposalFee(msgs)) {
        try {
          const { params } = await getCommonsParams();
          const required = parseCoinsString(params.proposal_fee);
          if (required.length > 0) {
            fee = {
              amount: required.map((c) =>
                c.denom === config.denom && BigInt(c.amount) < BigInt(minFeeAmount)
                  ? { denom: c.denom, amount: String(minFeeAmount) }
                  : c
              ),
              gas: String(gas),
            };
          }
        } catch (err) {
          throw new Error(
            `Failed to look up commons proposal fee: ${err instanceof Error ? err.message : err}`
          );
        }
      }

      // Wrap messages in MsgExecSession when session mode is active,
      // unless the messages are session management operations themselves.
      let finalMsgs = msgs;
      const isSessionMgmt = msgs.some((m) => SESSION_MGMT_TYPES.has(m.typeUrl));
      if (activeSession && !isSessionMgmt) {
        // Validate session hasn't expired
        if (activeSession.expiration && new Date(activeSession.expiration) < new Date()) {
          setActiveSession(null);
          localStorage.removeItem("session_granter");
          throw new Error("Session has expired. Session mode has been deactivated.");
        }

        // Encode each inner message to protobuf Any
        const encodedInnerMsgs = msgs.map((msg) => {
          const msgType = registry.lookupType(msg.typeUrl);
          if (!msgType) {
            throw new Error(`Unknown message type: ${msg.typeUrl}`);
          }
          const codec = msgType as unknown as RegistryCodec;
          const encoded = codec.encode(codec.fromPartial(msg.value)).finish();
          return { typeUrl: msg.typeUrl, value: encoded };
        });

        finalMsgs = [
          {
            typeUrl: SessionMsgTypeUrls.ExecSession,
            value: {
              grantee: rawAddress,
              granter: activeSession.granter,
              msgs: encodedInnerMsgs,
            },
          },
        ];
      }

      // Split sign vs broadcast vs confirm so the caller can drive a phased
      // progress UI (button label, elapsed timer). cosmjs's one-shot
      // `signAndBroadcast` polls internally with a 60s default and surfaces a
      // timeout as a hard error even when the tx actually landed — see commit
      // tied to the delegate-modal UX work.
      onPhase?.("signing");
      const txRaw = await client.sign(rawAddress, finalMsgs as readonly EncodeObject[], fee, memo);
      const { TxRaw } = await import("cosmjs-types/cosmos/tx/v1beta1/tx");
      const txBytes = TxRaw.encode(txRaw).finish();

      onPhase?.("broadcasting");
      const hash = await client.broadcastTxSync(txBytes);
      onPhase?.("confirming", hash);

      // Poll for inclusion ourselves with a much longer ceiling than cosmjs's
      // 60s default. Typical inclusion on this chain is ~90s, so 300s leaves
      // comfortable headroom; if a tx is going to be rejected by CheckTx that's
      // already been raised by broadcastTxSync.
      const timeoutMs = 300_000;
      const pollIntervalMs = 3_000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const indexed = await client.getTx(hash);
        if (indexed) {
          if (indexed.code !== 0) {
            // `rawLog` is deprecated in favor of `events`, but for a failed
            // tx it's still the only source of the chain's formatted error
            // string (e.g. "insufficient fees: got X, expected Y") — `events`
            // doesn't include it in a structured way for human display.
            throw new Error(`Transaction failed: ${indexed.rawLog}`);
          }
          return indexed.hash;
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      throw new Error(
        `Transaction ${hash} was broadcast but not yet found on the chain after ${Math.round(timeoutMs / 1000)}s. It may still confirm — check a block explorer for the hash.`,
      );
    },
    [rawAddress, activeSession, config.chainId, config.rpcEndpoint, config.denom, chainInfo.feeCurrencies]
  );

  const activateSession = useCallback((session: Session) => {
    setActiveSession(session);
    localStorage.setItem("session_granter", session.granter);
  }, []);

  const deactivateSession = useCallback(() => {
    setActiveSession(null);
    localStorage.removeItem("session_granter");
  }, []);

  // Fetch available sessions (where this wallet is the grantee)
  useEffect(() => {
    if (!rawAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getSessionsByGrantee(rawAddress);
        const now = new Date();
        const valid = (res.sessions || []).filter(
          (s) => !s.expiration || new Date(s.expiration) > now
        );
        if (!cancelled) {
          setAvailableSessions(valid);

          // Restore persisted session mode
          const savedGranter = localStorage.getItem("session_granter");
          if (savedGranter) {
            const match = valid.find((s) => s.granter === savedGranter);
            if (match) {
              setActiveSession(match);
            } else {
              localStorage.removeItem("session_granter");
            }
          }
        }
      } catch {
        // Session fetch is best-effort
      } finally {
        if (!cancelled && needsSessionRestore.current) {
          needsSessionRestore.current = false;
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [rawAddress]);

  // Auto-reconnect on page load if previously connected
  useEffect(() => {
    if (typeof window !== "undefined" && window.keplr && localStorage.getItem("wallet_connected")) {
      needsSessionRestore.current = !!localStorage.getItem("session_granter");
      connect().finally(() => {
        if (!needsSessionRestore.current) setReady(true);
      });
    } else {
      setReady(true);
    }
  }, [connect]);

  // Listen for Keplr account changes
  useEffect(() => {
    if (typeof window !== "undefined" && window.keplr) {
      const handler = () => {
        if (rawAddress) connect();
      };
      window.addEventListener("keplr_keystorechange", handler);
      return () => window.removeEventListener("keplr_keystorechange", handler);
    }
  }, [rawAddress, connect]);

  return (
    <WalletContext.Provider
      value={{
        address,
        signerAddress: rawAddress,
        name,
        connected: !!rawAddress,
        connecting,
        ready,
        isLedger,
        connect,
        disconnect,
        signAndBroadcast,
        sessionActive,
        activeSession,
        availableSessions,
        activateSession,
        deactivateSession,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
