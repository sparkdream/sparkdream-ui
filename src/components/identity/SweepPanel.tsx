"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useTxAction } from "@/hooks/useTxAction";
import { getAllBankBalances } from "@/lib/api";
import { RepIdentityMsgTypeUrls } from "@/lib/tx";
import { formatSpark } from "@/lib/utils";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import { Panel, SUBCARD } from "./shared";

interface Held {
  spark: string;
  others: number;
}

/**
 * The member's old addresses and what they still hold. Delegations stay at an
 * old address, so unbonded SPARK and rewards keep landing there after the
 * move; after a recovery or committee move the old key can't send it, so the
 * current address collects it with MsgSweepTombstone (all spendable tokens).
 */
export default function SweepPanel({
  aliases,
  disabled,
}: {
  /** Old addresses of the member (the canonical one excluded). */
  aliases: string[];
  disabled?: boolean;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const tx = useTxAction();
  const [held, setHeld] = useState<Record<string, Held>>({});
  const [nonce, setNonce] = useState(0);
  const key = aliases.join(",");

  useEffect(() => {
    let live = true;
    Promise.all(
      key.split(",").filter(Boolean).map(async (a) => {
        const res = await getAllBankBalances(a).catch(() => null);
        const balances = res?.balances ?? [];
        const spark = balances.find((b) => b.denom === config.denom)?.amount ?? "0";
        return [a, { spark, others: balances.filter((b) => b.denom !== config.denom && b.amount !== "0").length }] as const;
      }),
    ).then((rows) => live && setHeld(Object.fromEntries(rows)));
    return () => {
      live = false;
    };
  }, [key, config.denom, nonce]);

  if (aliases.length === 0) return null;

  const sweep = (tombstone: string) =>
    tx.run(`sweep-${tombstone}`, async () => {
      await signAndBroadcast([
        { typeUrl: RepIdentityMsgTypeUrls.SweepTombstone, value: { signer: signerAddress, tombstone } },
      ]);
      setNonce((n) => n + 1);
    });

  return (
    <Panel
      title="Old addresses"
      intro="Delegations stay at an old address, so unbonded SPARK and rewards can keep arriving there. Sweep moves everything spendable to this address."
    >
      <ul className="space-y-2">
        {aliases.map((a) => {
          const h = held[a];
          const empty = h && h.spark === "0" && h.others === 0;
          return (
            <li key={a} className={`${SUBCARD} flex flex-wrap items-center justify-between gap-3 text-sm`}>
              <div>
                <CopyableAddress address={a} className="font-mono text-zinc-300" />
                <span className="ml-2 text-xs text-zinc-500">
                  {h ? `${formatSpark(h.spark)} SPARK${h.others ? ` and ${h.others} other token${h.others === 1 ? "" : "s"}` : ""}` : "…"}
                </span>
              </div>
              {!disabled && h && !empty && (
                <button type="button" onClick={() => sweep(a)} disabled={tx.busy} className="sd-btn sd-btn-secondary">
                  {tx.pending === `sweep-${a}` ? "Sweeping…" : "Sweep"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-zinc-500">
        To unbond or withdraw rewards from an old address, connect it: the chain still lets it do that.
      </p>
      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </Panel>
  );
}
