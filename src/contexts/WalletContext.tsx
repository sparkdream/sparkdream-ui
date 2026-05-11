"use client";

import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import { useChainConfig } from "./ChainConfigContext";
import type { Session } from "@/types/session";
import { getCommonsParams, getSessionsByGrantee } from "@/lib/api";
import { CommonsMsgTypeUrls, SessionMsgTypeUrls } from "@/lib/tx";

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
  signAndBroadcast: (msgs: readonly { typeUrl: string; value: unknown }[], memo?: string) => Promise<string>;
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
    async (msgs: readonly { typeUrl: string; value: unknown }[], memo = "") => {
      if (!rawAddress || !window.keplr) {
        throw new Error("Wallet not connected");
      }

      const { SigningStargateClient, AminoTypes, defaultRegistryTypes, createDefaultAminoConverters } = await import("@cosmjs/stargate");
      const { Registry } = await import("@cosmjs/proto-signing");

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
      const { MsgSoftwareUpgrade } = await import("cosmjs-types/cosmos/upgrade/v1beta1/tx");

      const registry = new Registry(defaultRegistryTypes);
      registry.register("/cosmos.gov.v1.MsgSubmitProposal", GovV1MsgSubmitProposal as any);
      registry.register("/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade", MsgSoftwareUpgrade as any);
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
      const aminoTypes = new AminoTypes({ ...createDefaultAminoConverters(), ...blogAmino, ...sessionAmino, ...commonsAmino, ...repAmino, ...collectAmino, ...nameAmino, ...forumAmino, ...seasonAmino, ...revealAmino, ...futarchyAmino });

      // Telescope's auto-generated amino converters don't recursively decode
      // `repeated google.protobuf.Any` fields, so MsgSubmitProposal /
      // MsgSubmitAnonymousProposal / MsgExecSession need the registry + the
      // assembled AminoTypes wired into sparkdreamjs's hand-written override
      // before any amino signing can happen (otherwise Ledger users hit
      // "JSON Dictionaries are not sorted" / "signature verification failed").
      const { configureNestedAminoConverter } = await import("@sparkdreamnft/sparkdreamjs/nested-amino");
      // Cast: cosmjs's `lookupType` returns `GeneratedType` (union of TsProto +
      // Pbjs); the override only ever encounters TsProto types here.
      configureNestedAminoConverter({ registry: registry as unknown as Parameters<typeof configureNestedAminoConverter>[0]["registry"], aminoTypes });

      const key = await window.keplr.getKey(config.chainId);
      const baseSigner = key.isNanoLedger
        ? window.keplr.getOfflineSignerOnlyAmino(config.chainId)
        : window.keplr.getOfflineSigner(config.chainId);

      // Keplr's default `signAmino`/`signDirect` quietly overrides the fee in
      // our sign doc with its own gas-price calculation (~0.0075 SPARK at the
      // current registered gas price), which falls under the chain's 5 SPARK
      // ProposalFee minimum and bounces every non-signaling proposal. Force
      // Keplr to honor what we put in the sign doc via `preferNoSetFee`.
      // Also keep our memo as-passed (`preferNoSetMemo`).
      const signOptions = { preferNoSetFee: true, preferNoSetMemo: true };
      const keplr = window.keplr;
      const offlineSigner = {
        getAccounts: () => baseSigner.getAccounts(),
        signAmino: (signerAddr: string, signDoc: unknown) =>
          keplr.signAmino(config.chainId, signerAddr, signDoc as never, signOptions),
        ...(!key.isNanoLedger && {
          signDirect: (signerAddr: string, signDoc: unknown) =>
            keplr.signDirect(config.chainId, signerAddr, signDoc as never, signOptions),
        }),
      };

      const client = await SigningStargateClient.connectWithSigner(
        config.rpcEndpoint,
        offlineSigner as never,
        { registry, aminoTypes }
      );

      let fee = {
        amount: [{ denom: config.denom, amount: "5000" }],
        gas: "300000",
      };

      // x/commons enforces a min tx fee on MsgSubmitProposal containing
      // non-exempt inner messages (5 SPARK by default). Query the live
      // param so future changes don't strand the UI on a stale constant.
      if (txRequiresProposalFee(msgs)) {
        try {
          const { params } = await getCommonsParams();
          const required = parseCoinsString(params.proposal_fee);
          if (required.length > 0) {
            fee = { amount: required, gas: "300000" };
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
          const encoded = (msgType as any).encode((msgType as any).fromPartial(msg.value)).finish();
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

      const result = await client.signAndBroadcast(rawAddress, finalMsgs as any, fee, memo);
      if (result.code !== 0) {
        throw new Error(`Transaction failed: ${result.rawLog}`);
      }
      return result.transactionHash;
    },
    [rawAddress, activeSession, config.chainId, config.rpcEndpoint, config.denom]
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
