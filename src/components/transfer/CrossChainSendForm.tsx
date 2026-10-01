"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useTxPhase } from "@/hooks/useTxPhase";
import { getAllBankBalances } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { IbcMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseSparkToUspark, truncateAddress } from "@/lib/utils";
import {
  keplrAddressOn,
  keplrDestination,
  listTransferRoutes,
  recipientProblem,
  transferTimeoutNs,
  voucherDenom,
  type DestinationChain,
  type TransferRoute,
} from "@/lib/ibc";
import NumberInput from "@/components/NumberInput";
import { Field, FormShell, INPUT_CLASS, Preview } from "@/components/permissions/fields";

/** Minutes a relayer has to deliver the transfer before it times out and the
 *  tokens come back. Relayers deliver in seconds; this only matters when the
 *  relayer is down. */
const TIMEOUT_MINUTES = 10;

interface Sent {
  hash: string;
  amount: string;
  recipient: string;
  chain: string;
  voucher: string;
}

/**
 * Send the chain's token to another chain over IBC (ICS-20). The destinations
 * are whatever chains a relayer links to this one, read from the chain's own
 * open transfer channels, so a newly relayed chain appears without a release.
 */
export default function CrossChainSendForm() {
  const { signerAddress, sessionActive, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const tx = useTxPhase();

  const [routes, setRoutes] = useState<TransferRoute[] | null>(null);
  const [routesError, setRoutesError] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<Record<string, DestinationChain | null>>({});
  const [channelId, setChannelId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listTransferRoutes();
        if (cancelled) return;
        setRoutes(list);
        // name each destination as Keplr knows it, and preselect the first
        // one that can actually deliver
        const known: Record<string, DestinationChain | null> = {};
        for (const r of list) if (r.chainId && !(r.chainId in known)) known[r.chainId] = await keplrDestination(r.chainId);
        if (cancelled) return;
        setDestinations(known);
        const first = list.find((r) => r.status === "Active");
        if (first) setChannelId(first.channelId);
      } catch (err) {
        if (!cancelled) setRoutesError(errorMessage(err) || "Could not read this chain's IBC channels");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBalance = useCallback(async () => {
    if (!signerAddress) return;
    try {
      const res = await getAllBankBalances(signerAddress, { limit: "200" });
      setBalance((res.balances || []).find((b) => b.denom === config.denom)?.amount ?? "0");
    } catch {
      // keep the last value
    }
  }, [signerAddress, config.denom]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const route = routes?.find((r) => r.channelId === channelId) ?? null;
  const dest = route?.chainId ? destinations[route.chainId] : null;
  const chainLabel = route ? dest?.chainName || route.chainId || route.channelId : "";

  useEffect(() => {
    let cancelled = false;
    if (!route) return;
    voucherDenom(route.counterpartyChannelId, config.denom).then((v) => {
      if (!cancelled) setVoucher(v);
    });
    return () => {
      cancelled = true;
    };
  }, [route, config.denom]);

  const amountBase = parseSparkToUspark(amount);

  function validate(): string | null {
    if (sessionActive) return "Switch out of session mode: a transfer to another chain is signed by your wallet";
    if (!route) return "Pick a destination chain";
    if (route.status !== "Active") return `The link to ${chainLabel} is not working (light client ${route.status.toLowerCase()})`;
    const bad = recipientProblem(recipient, config.bech32Prefix, dest?.bech32Prefix);
    if (bad) return bad;
    if (!amountBase || BigInt(amountBase) <= BigInt(0)) return "Enter an amount greater than 0";
    if (balance !== null && BigInt(amountBase) > BigInt(balance)) return "That is more than your balance";
    return null;
  }

  const fillMyAddress = async () => {
    if (!route?.chainId) return;
    setFilling(true);
    setError(null);
    try {
      setRecipient(await keplrAddressOn(route.chainId));
    } catch (err) {
      setError(
        `Keplr could not give an address on ${chainLabel}: ${errorMessage(err) || "unknown error"}. ` +
          "Paste the address instead.",
      );
    } finally {
      setFilling(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem || !route || !amountBase) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const to = recipient.trim();
      const hash = await signAndBroadcast(
        [
          {
            typeUrl: IbcMsgTypeUrls.Transfer,
            value: {
              sourcePort: "transfer",
              sourceChannel: route.channelId,
              token: { denom: config.denom, amount: amountBase },
              sender: signerAddress,
              receiver: to,
              timeoutTimestamp: transferTimeoutNs(TIMEOUT_MINUTES),
              memo: "",
            },
          },
        ],
        "",
        tx.setPhase,
      );
      setSent({ hash, amount: amountBase, recipient: to, chain: chainLabel, voucher: voucher ?? "" });
      setAmount("");
      loadBalance();
    } catch (err) {
      setError(errorMessage(err) || "Transfer failed");
    } finally {
      setSubmitting(false);
      tx.setPhase(null);
    }
  };

  if (routesError) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">{routesError}</div>
    );
  }
  if (!routes) {
    return <div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />;
  }
  if (routes.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-400">
        This chain has no open transfer channels yet. Destinations appear here once a relayer links another chain.
      </div>
    );
  }

  const problem = validate();

  return (
    <FormShell
      title={`Send ${config.displayDenom} to another chain`}
      intro={`A relayer carries the transfer across, usually within a minute. On the other chain your ${config.displayDenom} shows up as an IBC token, and sending it back here returns it as ${config.displayDenom}.`}
      onSubmit={handleSubmit}
    >
      <Field id="xc-dest" label="Destination chain">
        <select
          id="xc-dest"
          value={channelId}
          onChange={(e) => {
            setChannelId(e.target.value);
            setRecipient("");
            setSent(null);
          }}
          className={INPUT_CLASS}
        >
          {!channelId && <option value="">Choose a chain</option>}
          {routes.map((r) => {
            const name = (r.chainId && destinations[r.chainId]?.chainName) || r.chainId || "Unknown chain";
            const down = r.status !== "Active";
            return (
              <option key={r.channelId} value={r.channelId} disabled={down}>
                {name}
                {r.chainId && name !== r.chainId ? ` (${r.chainId})` : ""} · {r.channelId}
                {down ? ` · link ${r.status.toLowerCase()}` : ""}
              </option>
            );
          })}
        </select>
      </Field>

      <Field
        id="xc-recipient"
        label="Recipient"
        help={dest?.bech32Prefix ? `An address on ${chainLabel}, starting with ${dest.bech32Prefix}1` : `An address on ${chainLabel}`}
      >
        <div className="flex gap-2">
          <input
            id="xc-recipient"
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={dest?.bech32Prefix ? `${dest.bech32Prefix}1…` : "Address on the destination chain"}
            autoComplete="off"
            spellCheck={false}
            className={`${INPUT_CLASS} font-mono`}
          />
          {route?.chainId && (
            <button
              type="button"
              onClick={fillMyAddress}
              disabled={filling}
              className="sd-btn sd-btn-secondary shrink-0"
              title={`Ask Keplr for your own address on ${chainLabel}`}
            >
              {filling ? "Asking Keplr…" : "My address"}
            </button>
          )}
        </div>
      </Field>

      <Field
        id="xc-amount"
        label={`Amount (${config.displayDenom})`}
        help={balance !== null ? `Available: ${formatSpark(balance)} ${config.displayDenom}` : undefined}
      >
        <NumberInput
          id="xc-amount"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className={INPUT_CLASS}
        />
      </Field>

      {!problem && amountBase && (
        <Preview>
          <strong>
            {formatSpark(amountBase)} {config.displayDenom}
          </strong>{" "}
          goes to <span className="font-mono">{truncateAddress(recipient.trim())}</span> on {chainLabel} over{" "}
          {route?.channelId}
          {voucher && (
            <>
              , arriving as <span className="font-mono break-all">{voucher}</span>
            </>
          )}
          . If no relayer delivers it within {TIMEOUT_MINUTES} minutes, it comes back to you.
        </Preview>
      )}

      {sent && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
          Sent {formatSpark(sent.amount)} {config.displayDenom} to{" "}
          <span className="font-mono">{truncateAddress(sent.recipient)}</span> on {sent.chain}. It should arrive within a
          minute
          {sent.voucher && (
            <>
              {" "}
              as <span className="font-mono break-all">{sent.voucher}</span>
            </>
          )}
          . Transaction <span className="font-mono">{truncateAddress(sent.hash)}</span>.
        </div>
      )}

      {(error || (problem && sessionActive)) && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error || problem}
        </div>
      )}
      {tx.hint && <p className="text-xs text-zinc-500">{tx.hint}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting || !!problem} className="sd-btn sd-btn-primary">
          {tx.buttonLabel("Send")}
        </button>
      </div>
    </FormShell>
  );
}
