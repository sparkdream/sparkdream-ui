"use client";

import { useEffect, useState } from "react";
import { pubkeyToAddress } from "@cosmjs/amino";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { getAccountPubKey, MULTISIG_PUBKEY_TYPE, type AccountPubKey } from "@/lib/api";
import CopyableAddress from "@/components/CopyableAddress";
import { Panel } from "./shared";

const SECP256K1 = "/cosmos.crypto.secp256k1.PubKey";

function subKeyAddress(k: AccountPubKey, prefix: string): string | null {
  if (k["@type"] !== SECP256K1 || !k.key) return null;
  try {
    return pubkeyToAddress({ type: "tendermint/PubKeySecp256k1", value: k.key }, prefix);
  } catch {
    return null;
  }
}

/**
 * What kind of key controls the connected account. A native k-of-n multisig
 * (LegacyAminoPubKey) can't sign through Keplr, so its holder needs the CLI
 * flow; most people reach this page through a hot session key granted by the
 * multisig, and the panel says which actions still need the root.
 */
export default function MultisigAccountPanel({ address }: { address: string }) {
  const { config } = useChainConfig();
  const [pk, setPk] = useState<{ for: string; key: AccountPubKey | null } | null>(null);

  useEffect(() => {
    let live = true;
    getAccountPubKey(address)
      .then((key) => live && setPk({ for: address, key }))
      .catch(() => live && setPk(null));
    return () => {
      live = false;
    };
  }, [address]);

  if (!pk || pk.for !== address) return null;
  const key = pk.key;
  const multisig = key?.["@type"] === MULTISIG_PUBKEY_TYPE;

  if (!multisig) {
    return (
      <Panel title="Account keys">
        <p className="text-sm text-zinc-400">
          {key
            ? "This account is controlled by a single key."
            : "No key on record yet: the chain stores an account's key at its first transaction."}{" "}
          To protect a membership with several devices, a native multisig account works as a cold root, with a session
          key for everyday actions. See the multisig guide (docs/multisig-accounts.md) in the chain repository.
        </p>
      </Panel>
    );
  }

  const subKeys = key?.public_keys ?? [];
  return (
    <Panel title="Account keys" intro={`This account is a multisig: ${key?.threshold} of ${subKeys.length} keys must sign.`}>
      <ul className="space-y-1 text-sm">
        {subKeys.map((k, i) => {
          const addr = subKeyAddress(k, config.bech32Prefix);
          return (
            <li key={`${k.key}-${i}`} className="flex items-center gap-2">
              <span className="w-6 text-xs text-zinc-500">{i + 1}.</span>
              {addr ? (
                <CopyableAddress address={addr} className="font-mono text-zinc-300" />
              ) : (
                <span className="font-mono text-xs text-zinc-400">{k["@type"]}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 space-y-2 text-xs text-zinc-400">
        <p>
          Keplr can&apos;t collect multisig signatures. Sign with the command line instead (
          <code className="text-zinc-300">sparkdreamd tx sign --multisig</code> on each device, then{" "}
          <code className="text-zinc-300">tx multisign</code>), as described in docs/multisig-accounts.md. Pass{" "}
          <code className="text-zinc-300">--gas 300000</code> on governance transactions.
        </p>
        <p>
          For everyday posting and voting, grant a session key to a single-key wallet once and use that here. Moving
          the membership, recovery codes and the anonymous identity key can never go through a session key: those
          always need the multisig&apos;s own signatures.
        </p>
        <p>
          Signers are fixed for the life of a multisig address. To change a co-signer, move the membership to a new
          multisig with a key change, and have the new set accept within the accept window.
        </p>
      </div>
    </Panel>
  );
}
