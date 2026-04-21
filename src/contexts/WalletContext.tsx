"use client";

import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import { useChainConfig } from "./ChainConfigContext";
import type { Session } from "@/types/session";
import { getSessionsByGrantee } from "@/lib/api";
import { SessionMsgTypeUrls } from "@/lib/tx";

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

      const { AminoConverter: blogAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx.amino");
      const { AminoConverter: sessionAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx.amino");
      const { AminoConverter: commonsAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx.amino");
      const { AminoConverter: repAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx.amino");
      const { AminoConverter: collectAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx.amino");
      const { AminoConverter: nameAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/name/v1/tx.amino");
      const { AminoConverter: forumAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx.amino");
      const { AminoConverter: seasonAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/season/v1/tx.amino");
      const aminoTypes = new AminoTypes({ ...createDefaultAminoConverters(), ...blogAmino, ...sessionAmino, ...commonsAmino, ...repAmino, ...collectAmino, ...nameAmino, ...forumAmino, ...seasonAmino });

      const key = await window.keplr.getKey(config.chainId);
      const offlineSigner = key.isNanoLedger
        ? window.keplr.getOfflineSignerOnlyAmino(config.chainId)
        : window.keplr.getOfflineSigner(config.chainId);

      const client = await SigningStargateClient.connectWithSigner(
        config.rpcEndpoint,
        offlineSigner,
        { registry, aminoTypes }
      );

      const fee = {
        amount: [{ denom: config.denom, amount: "5000" }],
        gas: "300000",
      };

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
