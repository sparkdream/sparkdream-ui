"use client";

import { useState } from "react";
import { transferPurposeFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx";
import { useWallet } from "@/contexts/WalletContext";
import { useDreamDenom } from "@/hooks/useDreamDenom";
import { useTxAction } from "@/hooks/useTxAction";
import ActionBanner from "@/components/ActionBanner";
import { RepMsgTypeUrls } from "@/lib/tx";
import { formatDream } from "@/lib/reveal-fmt";
import { giftTax, microParam, parseDreamAmount } from "@/lib/dreamGift";
import { TransferPurpose } from "@/types/rep";

interface GiftDreamFormProps {
  /** The member receiving the gift; the chain requires that the sender invited them. */
  recipient: string;
  /** x/rep params, for the tax rate and the lifetime cap. Null while loading. */
  params: Record<string, unknown> | null;
  /** Called with the amount sent (micro-DREAM) once the gift is on chain. */
  onSent: (amountMicro: bigint) => void;
  onCancel: () => void;
}

/**
 * Sends DREAM to an invitee as a gift (MsgTransferDream, purpose GIFT). Gifts
 * go only from an inviter to a member they invited, are capped per invitee
 * for life, and lose the transfer tax on the way.
 */
export default function GiftDreamForm({ recipient, params, onSent, onCancel }: GiftDreamFormProps) {
  const dream = useDreamDenom();
  const { address, signAndBroadcast } = useWallet();
  const tx = useTxAction();
  const [amount, setAmount] = useState("");

  const micro = parseDreamAmount(amount);
  const cap = microParam(params?.max_gift_per_invitee);
  const overCap = micro !== null && cap !== null && micro > cap;
  const tax = micro !== null ? giftTax(micro, params?.transfer_tax_rate) : BigInt(0);

  const send = () => {
    if (!address || micro === null || overCap) return;
    void tx.run(
      "gift",
      async () => {
        await signAndBroadcast([
          {
            typeUrl: RepMsgTypeUrls.TransferDream,
            value: {
              sender: address,
              recipient,
              amount: micro.toString(),
              purpose: transferPurposeFromJSON(TransferPurpose.GIFT),
              reference: "welcome gift",
            },
          },
        ]);
        onSent(micro);
      },
      (raw) => `Gift failed: ${raw}`,
    );
  };

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder={`Gift amount (${dream})`}
          value={amount}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d{0,6}$/.test(v)) setAmount(v);
          }}
          className="w-40 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
        />
        <button type="button" onClick={send} disabled={tx.busy || micro === null || overCap} className="sd-btn sd-btn-primary">
          {tx.busy ? "Sending..." : "Send gift"}
        </button>
        <button type="button" onClick={onCancel} disabled={tx.busy} className="sd-btn sd-btn-secondary">
          Cancel
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {micro !== null && !overCap && (
          <>
            They receive {formatDream((micro - tax).toString())} {dream}
            {tax > BigInt(0) && <> ({formatDream(tax.toString())} {dream} is burned as transfer tax)</>}.{" "}
          </>
        )}
        {overCap && cap !== null && (
          <span className="text-red-400">
            More than the {formatDream(cap.toString())} {dream} you may gift one invitee.{" "}
          </span>
        )}
        A gift leaves your unstaked balance for good.
        {cap !== null && (
          <>
            {" "}You can gift each person you invited up to {formatDream(cap.toString())} {dream} in total, and the chain
            refuses anything beyond that.
          </>
        )}
      </p>
      <ActionBanner message={tx.error} onDismiss={tx.clearError} />
    </div>
  );
}
