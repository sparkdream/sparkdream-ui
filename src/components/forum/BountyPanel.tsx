"use client";

import { useEffect, useState } from "react";
import { getForumParams } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useSessionPermits } from "@/hooks/useSessionPermits";
import { ForumMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseSparkToUspark, timeRemaining } from "@/lib/utils";
import NameOrAddress from "@/components/NameOrAddress";
import type { Bounty } from "@/types/forum";
import { BountyStatus } from "@/types/forum";

// Mirrors x/forum DefaultMaxBountyWinners: each AssignBountyToReply hands out
// a fixed 1/5 share of the escrow, so at most 5 replies can be awarded.
export const MAX_BOUNTY_WINNERS = 5;

// Duration choices for MsgCreateBounty. The chain default is 14 days and the
// max is 30 (DefaultBountyDuration / DefaultMaxBountyDuration).
const DURATION_DAYS = [1, 3, 7, 14, 30] as const;

interface BountyPanelProps {
  threadId: string;
  bounty: Bounty | null;
  isThreadAuthor: boolean;
  onChanged: () => void;
}

// Thread-level bounty lifecycle panel: shows the active bounty (amount,
// expiry, assigned awards) and, for the bounty creator, the increase /
// cancel / pay-out actions. When the thread has no active bounty, the
// thread author gets the create form. Per-reply award assignment lives in
// ThreadDetail next to each reply.
export default function BountyPanel({ threadId, bounty, isThreadAuthor, onChanged }: BountyPanelProps) {
  const { address, signAndBroadcast } = useWallet();
  const permits = useSessionPermits();

  const [bountiesEnabled, setBountiesEnabled] = useState(true);
  const [cancelFeePercent, setCancelFeePercent] = useState<string | null>(null);
  const [form, setForm] = useState<"create" | "increase" | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [durationDays, setDurationDays] = useState(14);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getForumParams()
      .then((res) => {
        if (cancelled) return;
        setBountiesEnabled(res.params?.bounties_enabled ?? true);
        setCancelFeePercent(res.params?.bounty_cancellation_fee_percent ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isActive = bounty?.status === BountyStatus.ACTIVE;
  const isSuspended = bounty?.status === BountyStatus.MODERATION_PENDING;
  const isBountyCreator = !!bounty && !!address && address === bounty.creator;
  const awards = bounty?.awards || [];

  const broadcast = async (label: string, typeUrl: string, value: Record<string, unknown>) => {
    if (!address) return;
    setBusy(label);
    try {
      await signAndBroadcast([{ typeUrl, value }]);
      setForm(null);
      setAmountInput("");
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = () => {
    const uspark = parseSparkToUspark(amountInput.trim());
    if (!uspark || uspark === "0") return;
    broadcast("create", ForumMsgTypeUrls.CreateBounty, {
      creator: address,
      threadId: BigInt(threadId),
      amount: uspark,
      duration: BigInt(durationDays * 86400),
    });
  };

  const handleIncrease = () => {
    if (!bounty) return;
    const uspark = parseSparkToUspark(amountInput.trim());
    if (!uspark || uspark === "0") return;
    broadcast("increase", ForumMsgTypeUrls.IncreaseBounty, {
      creator: address,
      bountyId: BigInt(bounty.id),
      additionalAmount: uspark,
    });
  };

  const handleCancel = () => {
    if (!bounty) return;
    const feeNote = cancelFeePercent && cancelFeePercent !== "0"
      ? ` A ${cancelFeePercent}% cancellation fee applies; the rest is refunded.`
      : " Escrowed funds are refunded.";
    if (!confirm(`Cancel this bounty?${feeNote}`)) return;
    broadcast("cancel", ForumMsgTypeUrls.CancelBounty, {
      creator: address,
      bountyId: BigInt(bounty.id),
    });
  };

  const handlePayOut = () => {
    if (!bounty || awards.length === 0) return;
    const total = awards.reduce((sum, a) => sum + BigInt(a.amount || "0"), BigInt(0));
    if (
      !confirm(
        `Pay out ${formatSpark(total)} SPARK to ${awards.length} repl${awards.length === 1 ? "y" : "ies"} and close the bounty? This cannot be undone.`
      )
    )
      return;
    broadcast("award", ForumMsgTypeUrls.AwardBounty, {
      creator: address,
      bountyId: BigInt(bounty.id),
    });
  };

  const amountForm = (label: string, onSubmit: () => void) => (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        value={amountInput}
        onChange={(e) => setAmountInput(e.target.value)}
        placeholder="Amount (SPARK)"
        className="w-36 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
      />
      {form === "create" && (
        <select
          value={durationDays}
          onChange={(e) => setDurationDays(parseInt(e.target.value, 10))}
          className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
        >
          {DURATION_DAYS.map((d) => (
            <option key={d} value={d}>{d} day{d !== 1 ? "s" : ""}</option>
          ))}
        </select>
      )}
      <button
        onClick={onSubmit}
        disabled={!parseSparkToUspark(amountInput.trim()) || parseSparkToUspark(amountInput.trim()) === "0" || !!busy}
        className="rounded-lg border border-amber-700/50 px-3 py-1.5 text-xs text-amber-400 transition-colors hover:border-amber-600 disabled:opacity-50"
      >
        {busy ? "Signing..." : label}
      </button>
      <button onClick={() => { setForm(null); setAmountInput(""); }} className="text-xs text-zinc-500 hover:text-zinc-300">
        Cancel
      </button>
    </div>
  );

  // No bounty (or a closed one): the thread author may open a new bounty.
  if (!bounty || !(isActive || isSuspended)) {
    if (!isThreadAuthor || !bountiesEnabled || !permits(ForumMsgTypeUrls.CreateBounty)) return null;
    return (
      <div className="mb-4">
        {form !== "create" ? (
          <button
            onClick={() => { setForm("create"); setAmountInput(""); }}
            className="rounded-lg border border-amber-700/50 px-3 py-1.5 text-xs text-amber-400 transition-colors hover:border-amber-600 hover:bg-amber-900/15"
          >
            Add Bounty
          </button>
        ) : (
          <div className="rounded-xl border border-amber-700/50 bg-amber-900/10 p-3">
            <p className="text-xs text-zinc-400">
              Escrow SPARK as a bounty on this thread. You can assign up to {MAX_BOUNTY_WINNERS} replies an
              equal share, then pay them out before the bounty expires.
            </p>
            {amountForm("Create Bounty", handleCreate)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-700/50 bg-amber-900/10 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs font-medium text-amber-400">
            Bounty: {formatSpark(bounty.amount)} SPARK
          </span>
        </div>
        {isSuspended ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
            Suspended pending moderation
          </span>
        ) : (
          bounty.expires_at && (
            <span className="text-xs text-zinc-500">{timeRemaining(bounty.expires_at)}</span>
          )
        )}
        <span className="text-xs text-zinc-500">
          by <NameOrAddress address={bounty.creator} />
        </span>
        {isActive && isBountyCreator && (
          <div className="flex items-center gap-2">
            {awards.length > 0 && permits(ForumMsgTypeUrls.AwardBounty) && (
              <button
                onClick={handlePayOut}
                disabled={!!busy}
                title="Pay all assigned awards and close the bounty"
                className="rounded-lg border border-amber-700/50 px-3 py-1.5 text-xs text-amber-400 transition-colors hover:border-amber-600 disabled:opacity-50"
              >
                {busy === "award" ? "Signing..." : "Pay Out Awards"}
              </button>
            )}
            {permits(ForumMsgTypeUrls.IncreaseBounty) && (
              <button
                onClick={() => { setForm(form === "increase" ? null : "increase"); setAmountInput(""); }}
                className="text-xs text-amber-400 transition-colors hover:text-amber-300"
              >
                Increase
              </button>
            )}
            {permits(ForumMsgTypeUrls.CancelBounty) && (
              <button
                onClick={handleCancel}
                disabled={!!busy}
                className="text-xs text-red-400 transition-colors hover:text-red-300 disabled:opacity-50"
              >
                {busy === "cancel" ? "..." : "Cancel Bounty"}
              </button>
            )}
          </div>
        )}
      </div>

      {form === "increase" && amountForm("Increase Bounty", handleIncrease)}

      {awards.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-amber-800/30 pt-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            Assigned awards ({awards.length}/{MAX_BOUNTY_WINNERS}){isActive ? ", paid when the creator finalizes" : ""}
          </p>
          {awards.map((a) => (
            <div key={a.post_id} className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="text-amber-400">{formatSpark(a.amount)} SPARK</span>
              <NameOrAddress address={a.recipient} />
              {a.reason && <span className="text-zinc-500">{a.reason}</span>}
            </div>
          ))}
        </div>
      )}

      {isActive && isBountyCreator && awards.length === 0 && (
        <p className="mt-2 text-[10px] text-zinc-500">
          Use the Award button on a reply to assign it a share, then pay out to close the bounty.
        </p>
      )}
    </div>
  );
}
