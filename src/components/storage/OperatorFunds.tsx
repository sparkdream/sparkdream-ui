"use client";

import { useEffect, useState } from "react";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useCopy } from "@/hooks/useCopy";
import { arweaveGateway } from "@/lib/contentScan/media";
import { arweaveNodeOf, copiesAfforded, formatAr, loadBackendFunds, type BackendFunds } from "@/lib/storageFunds";
import NameOrAddress from "@/components/NameOrAddress";
import type { StorageBackend } from "@/types/storage";

function WalletAddress({ address }: { address: string }) {
  const { copied, copy } = useCopy();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="break-all font-mono">{address}</span>
      <button type="button" onClick={() => void copy(address)} className="text-indigo-300 underline">
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/**
 * The best-effort notice for a permanent copy, with what the storage
 * operators have to pay for it: each approved operator's declared Arweave
 * wallet, its balance, and an address anyone can send AR to. `sizeBytes`
 * turns a balance into "about N copies of this size".
 */
export default function OperatorFunds({
  backend,
  sizeBytes,
  compact = false,
}: {
  backend: StorageBackend;
  sizeBytes?: number;
  compact?: boolean;
}) {
  // What was read, kept with what it was read for, so a new backend or size
  // shows "reading" again without resetting state inside the effect.
  const { config } = useChainConfig();
  const key = `${backend.name}|${sizeBytes ?? 0}`;
  const [read, setRead] = useState<{ key: string; funds: BackendFunds | null } | null>(null);

  useEffect(() => {
    let live = true;
    arweaveGateway()
      .then((gw) => loadBackendFunds(backend, arweaveNodeOf(gw), sizeBytes))
      .then((f) => live && setRead({ key, funds: f }))
      .catch(() => live && setRead({ key, funds: null }));
    return () => {
      live = false;
    };
  }, [backend, sizeBytes, key]);

  const current = read && read.key === key ? read : null;
  const funds = current?.funds ?? null;
  const failed = !!current && current.funds === null;

  const text = compact ? "text-xs" : "text-sm";
  const wallets = funds?.operators.flatMap((o) => o.wallets) ?? [];
  const known = wallets.filter((w) => w.balance !== null);
  // Short of the price of even one copy of this size, in every wallet that answered.
  const short =
    !!funds?.price && known.length > 0 && known.length === wallets.length && known.every((w) => copiesAfforded(w.balance, funds.price) === 0);

  return (
    <div className={`space-y-2 rounded-lg border border-amber-800/70 bg-amber-900/10 px-4 py-3 ${text} text-zinc-300`}>
      <p>
        <strong className="text-amber-300">A permanent copy is made on a best effort basis.</strong> An operator has to
        take the request and pay the storage network from its own wallet. If no copy is made, the copy fee you paid in
        {config.displayDenom} is returned to you in full. The smaller request fee is burned when you send the request and is not
        returned.
      </p>

      {failed && <p className="text-zinc-400">The operators and their funds could not be read right now.</p>}
      {!failed && !funds && <p className="text-zinc-400">Reading the operators&apos; funds...</p>}
      {funds && funds.operators.length === 0 && (
        <p className="text-amber-300">
          No operator is approved and active for {backend.name} right now, so a request would wait and then be refunded
          unless one is approved in time.
        </p>
      )}
      {funds && funds.operators.length > 0 && (
        <div className="space-y-2">
          <p className="text-zinc-400">
            Funds the operators hold for copies. You can help by sending AR to a wallet below. That is a gift to the
            operator: it is not tracked onchain and is not returned.
          </p>
          <ul className="space-y-2">
            {funds.operators.map((o) => (
              <li key={o.operator} className="space-y-1">
                <div className="text-zinc-400">
                  Operator <NameOrAddress address={o.operator} />
                </div>
                {o.wallets.length === 0 ? (
                  <div className="text-zinc-500">This operator has not published a wallet address.</div>
                ) : (
                  o.wallets.map((w) => {
                    const copies = copiesAfforded(w.balance, funds.price);
                    return (
                      <div key={w.address} className="space-y-0.5">
                        <div>
                          {w.balance === null ? (
                            <span className="text-zinc-400">Balance not available</span>
                          ) : (
                            <strong className="text-white">{formatAr(w.balance)} AR</strong>
                          )}
                          {copies !== null && (
                            <span className="text-zinc-400">
                              {" "}
                              (about {copies >= 1_000_000 ? "a million or more" : copies.toLocaleString()}{" "}
                              {copies === 1 ? "copy" : "copies"} of this size)
                            </span>
                          )}
                        </div>
                        <WalletAddress address={w.address} />
                      </div>
                    );
                  })
                )}
              </li>
            ))}
          </ul>
          {short && (
            <p className="text-amber-300">
              No operator wallet holds enough for a copy of this size right now. The request can still be sent, and
              waits until an operator can pay or it runs out and the copy fee is returned.
            </p>
          )}
          <p className="text-zinc-500">
            Wallet addresses are what each operator published in its onchain record, and balances come from the
            storage network. Check an address before sending to it.
          </p>
        </div>
      )}
    </div>
  );
}
