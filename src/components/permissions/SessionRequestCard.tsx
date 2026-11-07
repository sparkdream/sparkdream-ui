"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { getSession } from "@/lib/api";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { formatSpark, truncateAddress } from "@/lib/utils";
import { msgTypeLabel } from "@/lib/grants";
import { ConsentNotice, fmtDate } from "./fields";

/**
 * A session key someone else minted and asks this account to grant: the
 * launcher's daemons (verifier, game server) hold the key, and the member it
 * acts for may keep their wallet on another computer. The launcher links here
 * with every term filled in; this card shows them and signs the same
 * transaction the launcher would: a 1-unit send that opens the key's account,
 * the grant, and the revocation of the keys it replaces.
 *
 * Query: session_request=<who it is for>, granter, grantee, type (repeated),
 * spend (base units), expires (RFC 3339), execs, revoke (repeated), fund
 * (base units sent to the key, default none).
 */
export interface SessionRequest {
  label: string;
  granter: string;
  grantee: string;
  types: string[];
  spend: string;
  expires: Date;
  execs: string;
  revoke: string[];
  fund: string | null;
}

const UINT = /^\d+$/;

/** The request in the URL, or an error naming what is wrong with it. */
export function parseSessionRequest(
  q: URLSearchParams | ReadonlyURLSearchParams,
  prefix: string
): SessionRequest | { error: string } | null {
  if (!q.has("session_request")) return null;
  const addr = new RegExp(`^${prefix}1[02-9ac-hj-np-z]{38}$`);
  const granter = q.get("granter") ?? "";
  const grantee = q.get("grantee") ?? "";
  const types = q.getAll("type").filter(Boolean);
  const spend = q.get("spend") ?? "";
  const expires = new Date(q.get("expires") ?? "");
  const execs = q.get("execs") ?? "";
  const revoke = q.getAll("revoke").filter(Boolean);
  const fund = q.get("fund");
  if (!addr.test(granter)) return { error: "The link has no valid granter address" };
  if (!addr.test(grantee) || grantee === granter) return { error: "The link has no valid key address" };
  if (types.length === 0 || types.some((t) => !/^\/[\w.]+$/.test(t))) return { error: "The link lists no valid actions" };
  if (!UINT.test(spend) || !UINT.test(execs)) return { error: "The link's fee budget or use count is not a number" };
  if (Number.isNaN(expires.getTime())) return { error: "The link has no valid expiry" };
  if (revoke.some((r) => !addr.test(r))) return { error: "The link lists an invalid key to revoke" };
  if (fund !== null && !UINT.test(fund)) return { error: "The link's funding amount is not a number" };
  return {
    label: (q.get("session_request") || "").slice(0, 64),
    granter,
    grantee,
    types,
    spend,
    expires,
    execs,
    revoke,
    fund: fund && fund !== "0" ? fund : null,
  };
}

export default function SessionRequestCard({
  request,
  onDone,
  onCancel,
}: {
  request: SessionRequest | { error: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const { config: { denom: DENOM, displayDenom: DISPLAY } } = useChainConfig();
  const [granted, setGranted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const req = "error" in request ? null : request;

  // Already on chain (signed in another tab, or by the launcher's CLI route)
  useEffect(() => {
    if (!req) return;
    let cancelled = false;
    getSession(req.granter, req.grantee)
      .then((r) => !cancelled && setGranted(!!r.session))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [req]);

  const expired = req ? req.expires.getTime() <= Date.now() : false;
  const wrongAccount = req ? signerAddress !== req.granter : false;
  const title = useMemo(() => (req?.label ? `Grant the ${req.label}'s session key` : "Grant a session key"), [req]);

  if (!req) {
    return (
      <div className="mb-8 rounded-xl border border-red-800 bg-red-900/20 p-5 text-sm text-red-400">
        <div className="mb-3">This session key link is incomplete: {(request as { error: string }).error}.</div>
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">
          Dismiss
        </button>
      </div>
    );
  }

  const handleSign = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await signAndBroadcast([
        ...(req.fund
          ? [
              {
                typeUrl: "/cosmos.bank.v1beta1.MsgSend",
                value: {
                  fromAddress: req.granter,
                  toAddress: req.grantee,
                  amount: [{ denom: DENOM, amount: req.fund }],
                },
              },
            ]
          : []),
        {
          typeUrl: SessionMsgTypeUrls.CreateSession,
          value: {
            granter: req.granter,
            grantee: req.grantee,
            allowedMsgTypes: req.types,
            spendLimit: { denom: DENOM, amount: req.spend },
            expiration: req.expires,
            maxExecCount: BigInt(req.execs),
          },
        },
        ...req.revoke.map((grantee) => ({
          typeUrl: SessionMsgTypeUrls.RevokeSession,
          value: { granter: req.granter, grantee },
        })),
      ]);
      setGranted(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant the session key");
    } finally {
      setSubmitting(false);
    }
  };

  const row = "flex flex-col gap-0.5 sm:flex-row sm:gap-3";
  const key = "w-36 shrink-0 text-zinc-500";

  return (
    <div className="mb-8 space-y-4 rounded-xl border border-indigo-800/60 bg-zinc-900/50 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-zinc-400">
          A service asks to act as you with a key it holds, within the limits below. Sign only if you started this
          yourself, for example from your launcher.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-300">
        <div className={row}>
          <span className={key}>Granted by</span>
          <span className="break-all font-mono text-xs">{req.granter}</span>
        </div>
        <div className={row}>
          <span className={key}>Key address</span>
          <span className="break-all font-mono text-xs">{req.grantee}</span>
        </div>
        <div className={row}>
          <span className={key}>Allowed actions</span>
          <ul className="space-y-0.5">
            {req.types.map((t) => (
              <li key={t} title={t}>
                {msgTypeLabel(t)}
              </li>
            ))}
          </ul>
        </div>
        <div className={row}>
          <span className={key}>Fee budget</span>
          <span>
            {formatSpark(req.spend)} {DISPLAY}
          </span>
        </div>
        <div className={row}>
          <span className={key}>Max uses</span>
          <span>{Number(req.execs).toLocaleString()}</span>
        </div>
        <div className={row}>
          <span className={key}>Expires</span>
          <span>{fmtDate(req.expires.getTime() / 1000)}</span>
        </div>
        {req.fund && (
          <div className={row}>
            <span className={key}>Also sends</span>
            <span>
              {formatSpark(req.fund)} {DISPLAY} to the key, so its account exists on chain
            </span>
          </div>
        )}
        {req.revoke.length > 0 && (
          <div className={row}>
            <span className={key}>Revokes</span>
            <ul className="space-y-0.5 font-mono text-xs">
              {req.revoke.map((r) => (
                <li key={r} title={r}>
                  {truncateAddress(r)} <span className="font-sans text-zinc-500">(the key this replaces)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {granted ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-400">
          This key is granted. The service picks it up by itself.
        </div>
      ) : expired ? (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-400">
          This request expired. Ask for a fresh link.
        </div>
      ) : wrongAccount ? (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-400">
          Only {truncateAddress(req.granter)} can grant this key. Switch to that account in your wallet
          {signerAddress ? `; ${truncateAddress(signerAddress)} is connected` : ""}.
        </div>
      ) : (
        <ConsentNotice granter={req.granter} grantee={req.grantee} kind="session" />
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      <div className="flex items-center gap-3">
        {!granted && (
          <button
            type="button"
            onClick={handleSign}
            disabled={submitting || expired || wrongAccount}
            className="sd-btn sd-btn-primary"
          >
            {submitting ? "Signing..." : "Grant session key"}
          </button>
        )}
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">
          {granted ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
