"use client";

import { useState } from "react";
import type { Grant, SessionParams } from "@/types/session";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useTxAction } from "@/hooks/useTxAction";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseSparkToUspark } from "@/lib/utils";
import {
  GRANT_STATUS_LABEL, GRANT_TYPE_LABEL, allowanceRemaining, formatCoin, formatPeriod,
  grantToSession, int, isLive, msgTypeLabel, nowSec, recurringBatchSize, recurringClaimable,
  recurringNextClaimAt, recurringTotalPeriods, tsSec,
} from "@/lib/grants";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import NameOrAddress from "@/components/NameOrAddress";
import NumberInput from "@/components/NumberInput";
import { AddressInput, INPUT_CLASS, fmtDate, useResolvedAddress } from "./fields";

const STATUS_TONE: Record<string, string> = {
  GRANT_STATUS_ACTIVE: "bg-indigo-900/30 text-indigo-300",
  GRANT_STATUS_PAUSED_INSUFFICIENT_FUNDS: "bg-amber-900/30 text-amber-300",
};

const ACTION_BTN = "rounded px-3 py-1 text-xs transition-colors disabled:opacity-50";

export default function GrantCard({
  grant: g,
  side,
  params,
  onChanged,
}: {
  grant: Grant;
  side: "given" | "received";
  params: SessionParams | null;
  onChanged: () => void;
}) {
  const { signerAddress, signAndBroadcast, activeSession, activateSession, deactivateSession } = useWallet();
  const { config: { denom: DENOM, displayDenom: DISPLAY } } = useChainConfig();
  const tx = useTxAction();
  const live = isLive(g);
  const given = side === "given";
  const counterparty = given ? g.grantee : g.granter;
  const coin = (c: Parameters<typeof formatCoin>[0]) => formatCoin(c, DENOM, DISPLAY);
  const id = BigInt(g.id);

  const send = (key: string, msgs: { typeUrl: string; value: unknown }[], fail: string) =>
    tx.run(key, async () => {
      await signAndBroadcast(msgs);
      onChanged();
    }, fail);

  const revoke = () => {
    if (!confirm(`Cancel this ${GRANT_TYPE_LABEL[g.type].toLowerCase()}? This can't be undone.`)) return;
    send("revoke", [{ typeUrl: SessionMsgTypeUrls.RevokeGrant, value: { granter: signerAddress, grantId: id } }], "Cancel failed");
  };
  const decline = () => {
    if (!confirm(`Decline this ${GRANT_TYPE_LABEL[g.type].toLowerCase()}? It will be removed, and only the sender can create a new one.`)) return;
    send("decline", [{ typeUrl: SessionMsgTypeUrls.DeclineGrant, value: { grantee: signerAddress, grantId: id } }], "Decline failed");
  };
  const retry = () =>
    send("retry", [{ typeUrl: SessionMsgTypeUrls.RetryScheduledOneshot, value: { caller: signerAddress, grantId: id } }], "Retry failed");

  const paused = g.status === "GRANT_STATUS_PAUSED_INSUFFICIENT_FUNDS";

  return (
    <article className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 ${live ? "" : "opacity-60"}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-zinc-200">{GRANT_TYPE_LABEL[g.type]}</span>
            <span className={`rounded px-1.5 py-0.5 ${STATUS_TONE[g.status] ?? "bg-zinc-800 text-zinc-400"}`}>
              {GRANT_STATUS_LABEL[g.status]}
            </span>
            <span className="text-zinc-600">#{g.id}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <span className="text-zinc-500">{given ? "To" : "From"}</span>
            <NameOrAddress address={counterparty} className="text-zinc-300" />
            <CopyableAddress className="font-mono text-zinc-600" address={counterparty} />
          </div>
          {g.note && <p className="mt-1.5 text-sm text-zinc-400">{g.note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {g.type === "GRANT_TYPE_SESSION_KEY" && !given && live && (
            activeSession?.granter === g.granter ? (
              <button onClick={deactivateSession} className={`${ACTION_BTN} text-amber-400 hover:bg-amber-900/20`}>
                Deactivate
              </button>
            ) : (
              <button onClick={() => activateSession(grantToSession(g))} className={`${ACTION_BTN} text-indigo-400 hover:bg-indigo-900/20`}>
                Activate
              </button>
            )
          )}
          {g.type === "GRANT_TYPE_SCHEDULED_ONESHOT" && paused && (
            <button onClick={retry} disabled={tx.busy} className={`${ACTION_BTN} text-indigo-400 hover:bg-indigo-900/20`}>
              {tx.pending === "retry" ? "Retrying..." : "Retry now"}
            </button>
          )}
          {given && live && (
            <button onClick={revoke} disabled={tx.busy} className={`${ACTION_BTN} text-red-500 hover:bg-red-900/20 hover:text-red-400`}>
              {tx.pending === "revoke" ? "Cancelling..." : "Cancel"}
            </button>
          )}
          {!given && live && (
            <button onClick={decline} disabled={tx.busy} className={`${ACTION_BTN} text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200`}>
              {tx.pending === "decline" ? "Declining..." : "Decline"}
            </button>
          )}
        </div>
      </div>

      {g.type === "GRANT_TYPE_RECURRING_PULL" && (
        <RecurringBody g={g} given={given} coin={coin} busy={tx.busy} pending={tx.pending} send={send} />
      )}
      {g.type === "GRANT_TYPE_SPENDING_ALLOWANCE" && (
        <AllowanceBody g={g} given={given} coin={coin} params={params} busy={tx.busy} pending={tx.pending} send={send} />
      )}
      {g.type === "GRANT_TYPE_SCHEDULED_ONESHOT" && <OneshotBody g={g} given={given} coin={coin} />}
      {g.type === "GRANT_TYPE_SESSION_KEY" && <SessionKeyBody g={g} coin={coin} />}

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span>Created {fmtDate(tsSec(g.created_at))}</span>
        {live && <span>Ends {fmtDate(tsSec(g.expires_at))}</span>}
      </div>

      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </article>
  );
}

type Send = (key: string, msgs: { typeUrl: string; value: unknown }[], fail: string) => Promise<boolean>;
type CoinFmt = (c: Parameters<typeof formatCoin>[0]) => string;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-sm text-zinc-200">{children}</div>
    </div>
  );
}

function RecurringBody({
  g, given, coin, busy, pending, send,
}: { g: Grant; given: boolean; coin: CoinFmt; busy: boolean; pending: string | null; send: Send }) {
  const { signerAddress } = useWallet();
  const rp = g.recurring_pull!;
  const period = int(rp.period_seconds);
  const total = recurringTotalPeriods(g);
  const made = int(rp.claims_made);
  const claimable = recurringClaimable(g);
  const batch = recurringBatchSize(g);
  const next = recurringNextClaimAt(g);
  const live = isLive(g);

  const claim = () =>
    send(
      "claim",
      Array.from({ length: batch }, () => ({
        typeUrl: SessionMsgTypeUrls.ClaimRecurringPull,
        value: { grantee: signerAddress, grantId: BigInt(g.id) },
      })),
      "Claim failed"
    );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Amount">{coin(rp.amount_per_period)} / {formatPeriod(period)}</Stat>
        <Stat label="Paid">{made} of {total}</Stat>
        <Stat label="Next payment">{live && made < total ? (claimable > 0 ? "Due now" : fmtDate(next)) : "None"}</Stat>
        <Stat label="Daily limit">{coin({ denom: rp.amount_per_period?.denom ?? "", amount: rp.max_per_epoch || "0" })}</Stat>
      </div>
      {g.status === "GRANT_STATUS_PAUSED_INSUFFICIENT_FUNDS" && (
        <p className="mt-3 text-xs text-amber-300">
          {given
            ? "The last claim failed because your balance was too low. Top up your wallet so the recipient can claim again."
            : "The last claim failed because the sender's balance was too low. You can try again once they top up."}
        </p>
      )}
      {!given && claimable > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={claim} disabled={busy} className="sd-btn sd-btn-primary">
            {pending === "claim"
              ? "Claiming..."
              : `Claim ${batch > 1 ? `${batch} payments` : "payment"} (${formatSpark(
                  (BigInt(rp.amount_per_period?.amount || "0") * BigInt(batch)).toString()
                )})`}
          </button>
          {claimable > batch && (
            <span className="text-xs text-zinc-500">{claimable - batch} more after this</span>
          )}
        </div>
      )}
    </>
  );
}

function AllowanceBody({
  g, given, coin, params, busy, pending, send,
}: {
  g: Grant; given: boolean; coin: CoinFmt; params: SessionParams | null;
  busy: boolean; pending: string | null; send: Send;
}) {
  const { signerAddress } = useWallet();
  const { config: { displayDenom: DISPLAY } } = useChainConfig();
  const sa = g.spending_allowance!;
  const denom = sa.denom || sa.max_per_period?.denom || "";
  const { remaining, resetsAt } = allowanceRemaining(g);
  const whitelist = sa.allowed_recipients ?? [];
  const minPull = BigInt(params?.min_pull_amount || "0");

  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const resolved = useResolvedAddress(to);
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const amountBase = parseSparkToUspark(amount);

  const pull = async () => {
    const r = resolved.address;
    let problem: string | null = null;
    if (!r) problem = "Enter a valid recipient";
    else if (r === g.granter) problem = "Can't send back to the owner of the allowance";
    else if (whitelist.length > 0 && !whitelist.includes(r)) problem = "That address isn't on the approved list";
    else if (!amountBase || BigInt(amountBase) <= BigInt(0)) problem = "Enter an amount";
    else if (BigInt(amountBase) < minPull) problem = `Minimum is ${formatSpark(minPull)} ${DISPLAY}`;
    else if (BigInt(amountBase) > remaining) problem = `Only ${formatSpark(remaining)} ${DISPLAY} left this period`;
    setFormError(problem);
    if (problem) return;
    const ok = await send(
      "pull",
      [{
        typeUrl: SessionMsgTypeUrls.PullAllowance,
        value: { grantee: signerAddress, grantId: BigInt(g.id), recipient: r, amount: { denom, amount: amountBase } },
      }],
      "Send failed"
    );
    if (ok) {
      setOpen(false);
      setTo("");
      setAmount("");
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Budget">{coin(sa.max_per_period)} / {formatPeriod(int(sa.period_seconds))}</Stat>
        <Stat label="Left this period">{coin({ denom, amount: remaining.toString() })}</Stat>
        <Stat label="Refills">{resetsAt ? fmtDate(resetsAt) : "Full now"}</Stat>
        <Stat label="Recipients">{whitelist.length > 0 ? `${whitelist.length} approved` : "Anyone"}</Stat>
      </div>
      {whitelist.length > 0 && (
        <details className="mt-2 text-xs text-zinc-500">
          <summary className="cursor-pointer select-none">Approved recipients</summary>
          <ul className="mt-1 space-y-0.5">
            {whitelist.map((a) => (
              <li key={a}><NameOrAddress address={a} className="text-zinc-300" /></li>
            ))}
          </ul>
        </details>
      )}
      {!given && isLive(g) && !open && remaining > BigInt(0) && (
        <button onClick={() => setOpen(true)} className="sd-btn sd-btn-primary mt-3">
          Send from allowance
        </button>
      )}
      {!given && open && (
        <div className="mt-3 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
            <div>
              <AddressInput id={`pull-to-${g.id}`} value={to} onChange={setTo} resolved={resolved} placeholder="Recipient name or address" />
            </div>
            <NumberInput
              aria-label={`Amount (${DISPLAY})`}
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Amount (${DISPLAY})`}
              className={INPUT_CLASS}
            />
          </div>
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <div className="flex gap-2">
            <button onClick={pull} disabled={busy} className="sd-btn sd-btn-primary">
              {pending === "pull" ? "Sending..." : "Send"}
            </button>
            <button onClick={() => setOpen(false)} className="sd-btn sd-btn-secondary">Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

function OneshotBody({ g, given, coin }: { g: Grant; given: boolean; coin: CoinFmt }) {
  const so = g.scheduled_oneshot!;
  const fireAt = int(so.fire_at);
  const fired = g.status === "GRANT_STATUS_FIRED";
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {so.transfer ? (
          <>
            <Stat label="Amount">{coin(so.transfer.amount)}</Stat>
            <Stat label="Recipient">
              {so.transfer.recipient ? <NameOrAddress address={so.transfer.recipient} /> : "None"}
            </Stat>
          </>
        ) : (
          <Stat label="Action">{so.exec?.msg?.["@type"] ? msgTypeLabel(so.exec.msg["@type"]) : "Message"}</Stat>
        )}
        <Stat label={fired ? "Sent" : "Sends"}>{fmtDate(fireAt)}{!fired && fireAt <= nowSec() ? " (due)" : ""}</Stat>
      </div>
      {g.status === "GRANT_STATUS_PAUSED_INSUFFICIENT_FUNDS" && (
        <p className="mt-3 text-xs text-amber-300">
          {given
            ? "This didn't send because your balance was too low. Top up, then retry. It's cancelled automatically if not retried in time."
            : "This didn't send because the sender's balance was too low. You can retry once they top up."}
        </p>
      )}
      {fired && so.fire_error && <p className="mt-3 text-xs text-red-400">Failed: {so.fire_error}</p>}
    </>
  );
}

function SessionKeyBody({ g, coin }: { g: Grant; coin: CoinFmt }) {
  const sk = g.session_key!;
  const types = sk.allowed_msg_types ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {types.map((t) => (
          <span key={t} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{msgTypeLabel(t)}</span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Fees used">{coin(sk.spent)} of {coin(sk.spend_limit)}</Stat>
        <Stat label="Uses">{sk.exec_count || "0"} of {sk.max_exec_count || "0"}</Stat>
        {sk.last_used_at && tsSec(sk.last_used_at) > 0 && <Stat label="Last used">{fmtDate(tsSec(sk.last_used_at))}</Stat>}
      </div>
    </>
  );
}
