"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/contexts/WalletContext";
import { getRepCanonical } from "@/lib/api";
import { MigrationPath } from "@/types/rep";
import CopyableAddress from "@/components/CopyableAddress";

interface Tombstone {
  address: string;
  canonical: string;
  path: string;
}

/**
 * Shown while the connected wallet is an address the member migrated away
 * from. The chain refuses almost everything such an address signs
 * (x/rep/ante/tombstoned_signer.go): staking and reward withdrawals stay
 * open because delegations remain at the old address, and a bank send only
 * after a KEY migration (on the recovery and committee paths the old key is
 * presumed stolen). Without this, every action on the site would fail with a
 * bare "not allowed from a tombstone".
 */
export default function TombstoneBanner() {
  const { signerAddress } = useWallet();
  const [tomb, setTomb] = useState<Tombstone | null>(null);

  useEffect(() => {
    if (!signerAddress) return;
    let live = true;
    getRepCanonical(signerAddress)
      .then((res) => {
        if (!live) return;
        setTomb(res.tombstoned ? { address: signerAddress, canonical: res.canonical, path: res.path ?? "" } : null);
      })
      .catch(() => live && setTomb(null));
    return () => {
      live = false;
    };
  }, [signerAddress]);

  if (!tomb || tomb.address !== signerAddress) return null;
  const canSend = tomb.path === MigrationPath.KEY;

  return (
    <div
      role="status"
      className="px-4 py-2 text-center text-xs"
      style={{
        background: "var(--amber-soft)",
        borderBottom: "1px solid rgba(245, 158, 11, 0.3)",
        color: "var(--ink-soft)",
      }}
    >
      <span
        aria-hidden
        className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle"
        style={{ background: "var(--amber)" }}
      />
      This wallet&apos;s membership moved to{" "}
      <CopyableAddress address={tomb.canonical} className="font-mono" />. From here you can only withdraw
      staking rewards, undelegate or redelegate{canSend ? ", and send SPARK" : ""}. Connect the new address to keep
      going, and{" "}
      <Link href="/permissions#identity" className="underline">
        sweep leftover SPARK
      </Link>{" "}
      to it from there.
    </div>
  );
}
