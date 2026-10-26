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
export const MSG_CLEAR_ZK_PUBLIC_KEY = "/sparkdream.rep.v1.MsgClearZkPublicKey";

/**
 * Short fingerprint of a ZK public key, the same as `sparkdreamd
 * zk-key-fingerprint`: the first 8 bytes of its SHA-256 as hex, in groups of
 * four. Lets a multisig's co-signers check whose key a registration carries.
 */
export async function zkKeyFingerprint(publicKeyBase64: string): Promise<string> {
  const bytes = fromBase64(publicKeyBase64);
  if (bytes.length === 0) return "";
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  const hex = Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.match(/.{4}/g)!.join(" ");
}

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
 * - `pending`: this wallet's key is registered but waits for its activation
 *   epoch (every key change does, so it can't act twice in an open window)
 * - `locked`: a key is registered, but not unlocked in this tab
 * - `ready`: unlocked, and it matches the registered key
 * - `mismatch`: unlocked, but the chain holds a different key (re-register)
 */
export type ShieldIdentityStatus = "loading" | "unavailable" | "unregistered" | "pending" | "locked" | "ready" | "mismatch";

interface MemberKeyRecord {
  address: string;
  isMember: boolean;
  registeredKey: string | null;
  pendingKey: string | null;
  /** Rep epoch at which pendingKey becomes the registered key. */
  activatesAtEpoch: string | null;
  /** Season of the last key change; one change per season unless exempt. */
  lastChangeSeason: string | null;
  cooldownExempt: boolean;
  trustLevel: number | null;
}

async function loadMemberRecord(address: string): Promise<MemberKeyRecord> {
  try {
    const { member } = await getRepMember(address);
    // A tombstoned (migrated-away) address resolves to the member it moved to;
    // its keys aren't this wallet's to use.
    const own = member.address === address;
    return {
      address,
      isMember: own && member.status === "MEMBER_STATUS_ACTIVE",
      registeredKey: member.zk_public_key || null,
      pendingKey: member.pending_zk_public_key || null,
      activatesAtEpoch: member.pending_zk_public_key ? member.zk_key_activates_at_epoch || null : null,
      lastChangeSeason: member.last_zk_key_change_season || null,
      cooldownExempt: !!member.zk_key_cooldown_exempt,
      trustLevel: TRUST_LEVEL_ORDER.indexOf(member.trust_level),
    };
  } catch {
    return {
      address, isMember: false, registeredKey: null, pendingKey: null, activatesAtEpoch: null,
      lastChangeSeason: null, cooldownExempt: false, trustLevel: null,
    };
  }
}

/** The connected member's anonymous identity: its on-chain registration, and
 *  the secret derived from their wallet signature (kept for the tab only). */
export function useShieldIdentity() {
  const { config } = useChainConfig();
  const { signerAddress, connected, sessionActive, signAndBroadcast } = useWallet();
  // Both are keyed by the address they belong to, so switching wallets never
  // shows the previous wallet's state.
  const [record, setRecord] = useState<MemberKeyRecord | null>(null);
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
  else if (!current.registeredKey) status = current.pendingKey ? "pending" : "unregistered";
  else if (!identity) status = "locked";
  else if (samePublicKey(current.registeredKey, identity.publicKey)) status = "ready";
  else if (current.pendingKey && samePublicKey(current.pendingKey, identity.publicKey)) status = "pending";
  else status = "mismatch";

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

  /** Zero the registered key (a leaked key): immediate, no cooldown. Registering again still waits the activation delay. */
  const clear = useCallback(async () => {
    if (!signerAddress) throw new Error("Connect your wallet first.");
    await signAndBroadcast([{ typeUrl: MSG_CLEAR_ZK_PUBLIC_KEY, value: { member: signerAddress } }]);
    await refresh();
  }, [signerAddress, signAndBroadcast, refresh]);

  return {
    status,
    identity,
    trustLevel,
    registeredKey: current?.registeredKey ?? null,
    pendingKey: current?.pendingKey ?? null,
    activatesAtEpoch: current?.activatesAtEpoch ?? null,
    lastChangeSeason: current?.lastChangeSeason ?? null,
    cooldownExempt: current?.cooldownExempt ?? false,
    unlock,
    register,
    clear,
    refresh,
  };
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
      if (shield.status === "pending") {
        throw new Error(`Your anonymous identity activates at epoch ${shield.activatesAtEpoch ?? "?"}. Try again then.`);
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
