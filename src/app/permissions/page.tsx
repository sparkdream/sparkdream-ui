"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Grant, GrantType, SessionParams } from "@/types/session";
import { getAllowedMsgTypes, getGrantsByGrantee, getGrantsByGranter, getSessionParams } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { GRANT_TYPE_LABEL, isLive, recurringClaimable } from "@/lib/grants";
import ErrorState from "@/components/ErrorState";
import GrantCard from "@/components/permissions/GrantCard";
import RecurringPaymentForm from "@/components/permissions/RecurringPaymentForm";
import SpendingAllowanceForm from "@/components/permissions/SpendingAllowanceForm";
import ScheduledTransferForm from "@/components/permissions/ScheduledTransferForm";
import SessionKeyForm from "@/components/permissions/SessionKeyForm";

type Side = "given" | "received";
type Kind = "recurring" | "allowance" | "scheduled" | "session";

const KINDS: { kind: Kind; type: GrantType; title: string; desc: string }[] = [
  {
    kind: "recurring",
    type: "GRANT_TYPE_RECURRING_PULL",
    title: "Recurring payment",
    desc: "Pay someone a fixed amount every day, week or month. They claim each payment when it's due.",
  },
  {
    kind: "allowance",
    type: "GRANT_TYPE_SPENDING_ALLOWANCE",
    title: "Spending allowance",
    desc: "Give someone a budget that refills each period. They choose where it goes.",
  },
  {
    kind: "scheduled",
    type: "GRANT_TYPE_SCHEDULED_ONESHOT",
    title: "Scheduled transfer",
    desc: "Send tokens once, automatically, at a time you pick.",
  },
  {
    kind: "session",
    type: "GRANT_TYPE_SESSION_KEY",
    title: "Session key",
    desc: "Let another address sign selected actions as you, like posting or reacting.",
  },
];

const TAB_BTN = "rounded-md px-3 py-1.5 text-xs font-medium transition-colors";

export default function PermissionsPage() {
  return (
    <Suspense fallback={null}>
      <PermissionsPageInner />
    </Suspense>
  );
}

// Received grants that want attention sort first: claimable payments, then
// anything still live, then finished ones; newest first within each.
function rank(g: Grant): number {
  if (recurringClaimable(g) > 0) return 0;
  return isLive(g) ? 1 : 2;
}

function PermissionsPageInner() {
  const searchParams = useSearchParams();
  const { signerAddress, connected, ready } = useWallet();

  const [side, setSide] = useState<Side>(searchParams.get("tab") === "received" ? "received" : "given");
  const [filter, setFilter] = useState<GrantType | "all">("all");
  const initialKind = searchParams.get("new") as Kind | null;
  const [creating, setCreating] = useState<Kind | "pick" | null>(
    KINDS.some((k) => k.kind === initialKind) ? initialKind : null
  );

  const [given, setGiven] = useState<Grant[]>([]);
  const [received, setReceived] = useState<Grant[]>([]);
  const [params, setParams] = useState<SessionParams | null>(null);
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchAll = useCallback(async () => {
    if (!signerAddress) return;
    try {
      const [g, r, p, t] = await Promise.all([
        getGrantsByGranter(signerAddress),
        getGrantsByGrantee(signerAddress),
        getSessionParams(),
        getAllowedMsgTypes(),
      ]);
      setGiven(g.grants || []);
      setReceived(r.grants || []);
      setParams(p.params || null);
      setAllowedTypes(t.allowed_msg_types || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [signerAddress]);

  useEffect(() => {
    if (!ready) return;
    if (connected && signerAddress) {
      setLoading(true);
      fetchAll();
    } else {
      setLoading(false);
    }
  }, [ready, connected, signerAddress, fetchAll]);

  const list = side === "given" ? given : received;
  const shown = useMemo(
    () =>
      list
        .filter((g) => filter === "all" || g.type === filter)
        .sort((a, b) => rank(a) - rank(b) || Number(BigInt(b.id) - BigInt(a.id))),
    [list, filter]
  );
  const typesPresent = useMemo(() => new Set(list.map((g) => g.type)), [list]);
  const claimableCount = received.filter((g) => recurringClaimable(g) > 0).length;

  const done = () => {
    setCreating(null);
    setSide("given");
    fetchAll();
  };
  const cancel = () => setCreating(null);

  const header = (
    <header className="sd-page-header">
      <span className="crumb">System</span>
      <h1>Permissions</h1>
      <p>Recurring payments, allowances, scheduled transfers and session keys</p>
      {connected && !creating && (
        <button
          type="button"
          onClick={() => setCreating("pick")}
          className="sd-btn sd-btn-primary w-fit"
          style={{ marginLeft: "auto" }}
        >
          New
        </button>
      )}
    </header>
  );

  if (!ready) {
    return (
      <div className="sd-page">
        {header}
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="sd-page">
        {header}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">Connect your wallet to manage permissions</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sd-page">
      {header}

      {creating === "pick" && (
        <div className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">What would you like to set up?</h2>
            <button type="button" onClick={cancel} className="text-xs text-zinc-400 hover:text-zinc-200">
              Cancel
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => setCreating(k.kind)}
                className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-left transition-colors hover:border-indigo-600"
              >
                <div className="text-sm font-medium text-white">{k.title}</div>
                <div className="mt-1 text-xs text-zinc-400">{k.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {!loading && creating === "recurring" && <RecurringPaymentForm params={params} onDone={done} onCancel={cancel} />}
      {!loading && creating === "allowance" && <SpendingAllowanceForm params={params} onDone={done} onCancel={cancel} />}
      {!loading && creating === "scheduled" && <ScheduledTransferForm params={params} onDone={done} onCancel={cancel} />}
      {!loading && creating === "session" && (
        <SessionKeyForm params={params} allowedTypes={allowedTypes} onDone={done} onCancel={cancel} />
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
          <button
            onClick={() => { setSide("given"); setFilter("all"); }}
            className={`${TAB_BTN} ${side === "given" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-300"}`}
          >
            Given ({given.length})
          </button>
          <button
            onClick={() => { setSide("received"); setFilter("all"); }}
            className={`${TAB_BTN} ${side === "received" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-300"}`}
          >
            Received ({received.length})
            {claimableCount > 0 && (
              <span className="ml-1.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white">
                {claimableCount} to claim
              </span>
            )}
          </button>
        </div>
        {typesPresent.size > 1 && (
          <select
            aria-label="Filter by type"
            value={filter}
            onChange={(e) => setFilter(e.target.value as GrantType | "all")}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-300"
          >
            <option value="all">All types</option>
            {KINDS.filter((k) => typesPresent.has(k.type)).map((k) => (
              <option key={k.type} value={k.type}>{GRANT_TYPE_LABEL[k.type]}</option>
            ))}
          </select>
        )}
      </div>

      {error ? <ErrorState error={error} onRetry={fetchAll} className="mb-6" /> : null}

      {loading ? (
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">
            {side === "given"
              ? "You haven't given any permissions yet"
              : "No one has given you any permissions yet"}
          </p>
          {side === "given" && (
            <button type="button" onClick={() => setCreating("pick")} className="sd-btn sd-btn-secondary mt-4">
              Set one up
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {shown.map((g) => (
            <GrantCard key={g.id} grant={g} side={side} params={params} onChanged={fetchAll} />
          ))}
        </div>
      )}
    </div>
  );
}
