"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useTxAction } from "@/hooks/useTxAction";
import { getBankBalance } from "@/lib/api";
import { formatSpark, parseSparkToUspark } from "@/lib/utils";
import ActionBanner from "@/components/ActionBanner";
import { INPUT_CLASS } from "@/components/permissions/fields";

/**
 * The new address signs MsgAcceptMigration itself, so it needs SPARK for gas
 * before it can accept. A fresh address has none; offer a bank send from the
 * connected wallet. (On the KEY path the old address may also send after the
 * move, but the accept comes first.)
 */
export default function FundAddressHint({ target }: { target: string }) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const tx = useTxAction();
  const [balance, setBalance] = useState<{ for: string; amount: string } | null>(null);
  const [amount, setAmount] = useState("1");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    getBankBalance(target, config.denom)
      .then((res) => live && setBalance({ for: target, amount: res.balance?.amount ?? "0" }))
      .catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [target, config.denom, nonce]);

  if (!balance || balance.for !== target) return null;
  const uspark = parseSparkToUspark(amount);

  const send = () =>
    tx.run("fund", async () => {
      if (!signerAddress || !uspark || uspark === "0") throw new Error("Enter an amount");
      await signAndBroadcast([
        {
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: { fromAddress: signerAddress, toAddress: target, amount: [{ denom: config.denom, amount: uspark }] },
        },
      ]);
      setNonce((n) => n + 1);
    });

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-400">
      <p>
        The new address holds {formatSpark(balance.amount)} SPARK.{" "}
        {balance.amount === "0"
          ? "It pays the gas to accept, so send it a little SPARK first."
          : "That covers the gas to accept."}
      </p>
      {signerAddress !== target && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            aria-label="SPARK to send"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${INPUT_CLASS} w-28`}
            inputMode="decimal"
          />
          <button type="button" onClick={send} disabled={tx.busy || !uspark} className="sd-btn sd-btn-secondary">
            {tx.busy ? "Sending…" : "Send SPARK to it"}
          </button>
        </div>
      )}
      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-2" />
    </div>
  );
}
