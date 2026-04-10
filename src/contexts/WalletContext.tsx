"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useChainConfig } from "./ChainConfigContext";

interface WalletState {
  address: string | null;
  name: string | null;
  connected: boolean;
  connecting: boolean;
  isLedger: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signAndBroadcast: (msgs: readonly { typeUrl: string; value: unknown }[], memo?: string) => Promise<string>;
}

const WalletContext = createContext<WalletState>({
  address: null,
  name: null,
  connected: false,
  connecting: false,
  isLedger: false,
  connect: async () => {},
  disconnect: () => {},
  signAndBroadcast: async () => "",
});

export function useWallet() {
  return useContext(WalletContext);
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { config, chainInfo } = useChainConfig();
  const [address, setAddress] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [isLedger, setIsLedger] = useState(false);

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
        setAddress(accounts[0].address);
      }

      localStorage.setItem("wallet_connected", "true");
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    } finally {
      setConnecting(false);
    }
  }, [config.chainId, chainInfo]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setName(null);
    setIsLedger(false);
    localStorage.removeItem("wallet_connected");
  }, []);

  const signAndBroadcast = useCallback(
    async (msgs: readonly { typeUrl: string; value: unknown }[], memo = "") => {
      if (!address || !window.keplr) {
        throw new Error("Wallet not connected");
      }

      const { SigningStargateClient, AminoTypes } = await import("@cosmjs/stargate");
      const { Registry } = await import("@cosmjs/proto-signing");

      const { load: loadBlog } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx.registry");
      const { load: loadSession } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx.registry");
      const { load: loadCommons } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx.registry");
      const registry = new Registry();
      loadBlog(registry);
      loadSession(registry);
      loadCommons(registry);

      const { AminoConverter: blogAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx.amino");
      const { AminoConverter: sessionAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx.amino");
      const { AminoConverter: commonsAmino } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx.amino");
      const aminoTypes = new AminoTypes({ ...blogAmino, ...sessionAmino, ...commonsAmino });

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

      const result = await client.signAndBroadcast(address, msgs as any, fee, memo);
      if (result.code !== 0) {
        throw new Error(`Transaction failed: ${result.rawLog}`);
      }
      return result.transactionHash;
    },
    [address, config.chainId, config.rpcEndpoint, config.denom]
  );

  // Auto-reconnect on page load if previously connected
  useEffect(() => {
    if (typeof window !== "undefined" && window.keplr && localStorage.getItem("wallet_connected")) {
      connect();
    }
  }, [connect]);

  // Listen for Keplr account changes
  useEffect(() => {
    if (typeof window !== "undefined" && window.keplr) {
      const handler = () => {
        if (address) connect();
      };
      window.addEventListener("keplr_keystorechange", handler);
      return () => window.removeEventListener("keplr_keystorechange", handler);
    }
  }, [address, connect]);

  return (
    <WalletContext.Provider
      value={{
        address,
        name,
        connected: !!address,
        connecting,
        isLedger,
        connect,
        disconnect,
        signAndBroadcast,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
