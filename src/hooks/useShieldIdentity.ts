"use client";

import { useCallback, useEffect, useState } from "react";
import { fromBase64 } from "@cosmjs/encoding";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { getRepMember } from "@/lib/api";
import { shieldModuleAddress } from "@/lib/shield";
import {
  cachedIdentity,
  deriveIdentity,
  samePublicKey,
  submitAnonymously,
  type ShieldIdentity,
  type ShieldPhase,
} from "@/lib/shieldClient";
import { TrustLevel } from "@/types/rep";

export const MSG_REGISTER_ZK_PUBLIC_KEY = "/sparkdream.rep.v1.MsgRegisterZkPublicKey";

const TRUST_LEVEL_ORDER: string[] = [
  TrustLevel.NEW,
  TrustLevel.PROVISIONAL,
  TrustLevel.ESTABLISHED,
  TrustLevel.TRUSTED,
  TrustLevel.CORE,
];

/**
 * - `unavailable`: no wallet, session mode, or not an active member
 * - `unregistered`: a member with no anonymous key on chain yet
 * - `locked`: a key is registered, but not unlocked in this tab
 * - `ready`: unlocked, and it matches the registered key
 * - `mismatch`: unlocked, but the chain holds a different key (re-register)
 */
export type ShieldIdentityStatus = "loading" | "unavailable" | "unregistered" | "locked" | "ready" | "mismatch";

async function loadMemberRecord(address: string) {
  try {
    const { member } = await getRepMember(address);
    return {
      address,
      isMember: member.status === "MEMBER_STATUS_ACTIVE",
      registeredKey: member.zk_public_key || null,
      trustLevel: TRUST_LEVEL_ORDER.indexOf(member.trust_level),
    };
  } catch {
    return { address, isMember: false, registeredKey: null, trustLevel: null };
  }
}

/** The connected member's anonymous identity: its on-chain registration, and
 *  the secret derived from their wallet signature (kept for the tab only). */
export function useShieldIdentity() {
  const { config } = useChainConfig();
  const { signerAddress, connected, sessionActive, signAndBroadcast } = useWallet();
  // Both are keyed by the address they belong to, so switching wallets never
  // shows the previous wallet's state.
  const [record, setRecord] = useState<{
    address: string;
    isMember: boolean;
    registeredKey: string | null;
    trustLevel: number | null;
  } | null>(null);
  const [unlocked, setUnlocked] = useState<{ address: string; identity: ShieldIdentity } | null>(null);

  const refresh = useCallback(async () => {
    if (signerAddress) setRecord(await loadMemberRecord(signerAddress));
  }, [signerAddress]);

  useEffect(() => {
    if (!signerAddress) return;
    let live = true;
    loadMemberRecord(signerAddress).then((r) => live && setRecord(r));
    return () => {
      live = false;
    };
  }, [signerAddress]);

  const current = record && record.address === signerAddress ? record : null;
  const identity =
    signerAddress && unlocked?.address === signerAddress
      ? unlocked.identity
      : signerAddress
        ? cachedIdentity(config.chainId, signerAddress)
        : null;
  const trustLevel = current?.trustLevel ?? null;

  let status: ShieldIdentityStatus;
  if (!connected || !signerAddress || sessionActive) status = "unavailable";
  else if (!current) status = "loading";
  else if (!current.isMember) status = "unavailable";
  else if (!current.registeredKey) status = "unregistered";
  else if (!identity) status = "locked";
  else status = samePublicKey(current.registeredKey, identity.publicKey) ? "ready" : "mismatch";

  /** Ask Keplr for the identity signature (once per tab). */
  const unlock = useCallback(async () => {
    if (!signerAddress) throw new Error("Connect your wallet first.");
    const id = await deriveIdentity(config, signerAddress);
    setUnlocked({ address: signerAddress, identity: id });
    return id;
  }, [config, signerAddress]);

  /** Derive the identity and register its public key on chain. */
  const register = useCallback(async () => {
    if (!signerAddress) throw new Error("Connect your wallet first.");
    const id = await unlock();
    await signAndBroadcast([
      {
        typeUrl: MSG_REGISTER_ZK_PUBLIC_KEY,
        value: { member: signerAddress, zkPublicKey: fromBase64(id.publicKey) },
      },
    ]);
    await refresh();
    return id;
  }, [signerAddress, unlock, signAndBroadcast, refresh]);

  return { status, identity, trustLevel, unlock, register, refresh };
}

/** Send a message anonymously. `buildValue` gets the shield module address,
 *  which must be the inner message's signer (creator, voter, ...). */
export function useAnonymousSubmit() {
  const { config } = useChainConfig();
  const shield = useShieldIdentity();
  const [phase, setPhase] = useState<ShieldPhase | null>(null);

  const submit = useCallback(
    async (
      typeUrl: string,
      buildValue: (shieldAddress: string) => Record<string, unknown>,
      minTrustLevel?: number,
    ) => {
      if (shield.status === "unregistered" || shield.status === "mismatch") {
        throw new Error("Set up your anonymous identity first (Permissions page).");
      }
      try {
        const identity = shield.identity ?? (await shield.unlock());
        return await submitAnonymously(
          config,
          identity,
          { typeUrl, value: buildValue(shieldModuleAddress(config.bech32Prefix)) },
          setPhase,
          minTrustLevel,
        );
      } finally {
        setPhase(null);
      }
    },
    [config, shield],
  );

  return { submit, phase, shield };
}

export const SHIELD_PHASE_LABELS: Record<ShieldPhase, string> = {
  preparing: "Preparing your anonymous proof…",
  proving: "Proving you're a member. This takes about 10 seconds…",
  broadcasting: "Sending anonymously…",
};
