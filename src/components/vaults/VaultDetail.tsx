"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import { getAllBankBalances } from "@/lib/api";
import { getVault, invalidateVaults, listVaultProposals } from "@/lib/vaultApi";
import { formatTime } from "@/lib/utils";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import {
  VAULT_PROPOSAL_STATUS_LABELS,
  VaultProposalStatus,
  type Vault,
  type VaultProposal,
} from "@/types/vault";
import ProposalCard from "./ProposalCard";
import ProposeForm from "./ProposeForm";
import { CARD, formatCoin, formatTtl, myWeight, totalWeight } from "./shared";

type Tab = "pending" | "resolved";
const TAB_BTN = "rounded-md px-3 py-1.5 text-xs font-medium transition-colors";
const RESOLVED = [
  VaultProposalStatus.EXECUTED,
  VaultProposalStatus.CANCELLED,
  VaultProposalStatus.EXPIRED,
  VaultProposalStatus.INVALIDATED,
];

interface Loaded {
  vault: Vault;
  balances: { denom: string; amount: string }[];
  pending: VaultProposal[];
  resolved: VaultProposal[];
}

export default function VaultDetail({ vaultId, onBack }: { vaultId: string; onBack: () => void }) {
  const { connected, sessionActive } = useWallet();
  const { config: { denom: DENOM, displayDenom: DISPLAY } } = useChainConfig();
  const { isMine } = useMyAliases();

  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [proposing, setProposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Bumped to refetch. Fetching inline in the effect rather than calling a
  // setState-ing callback keeps this off the react-hooks/set-state-in-effect rule.
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      const vault = await getVault(vaultId);
      // Pending proposals are bounded (signers × per-proposer caps), so one
      // page holds them all; resolved ones only linger for the retention window.
      const [bal, pending, recent] = await Promise.all([
        getAllBankBalances(vault.address, { limit: "200" }).catch(() => ({ balances: [] })),
        listVaultProposals(vaultId, VaultProposalStatus.PENDING, { limit: "200" }),
        listVaultProposals(vaultId, undefined, { limit: "100" }),
      ]);
      return {
        vault,
        balances: bal.balances || [],
        pending: pending.proposals || [],
        resolved: (recent.proposals || []).filter((p) => p.status !== VaultProposalStatus.PENDING),
      };
    })().then(
      (loaded) => {
        if (!live) return;
        setData(loaded);
        setError(null);
      },
      (err) => live && setError(err)
    );
    return () => {
      live = false;
    };
  }, [vaultId, reloadKey]);

  const refresh = (outcome: string) => {
    invalidateVaults();
    setNotice(outcome);
    load();
  };

  const shownResolved = useMemo(
    () => (data?.resolved || []).filter((p) => statusFilter === "all" || p.status === statusFilter),
    [data, statusFilter]
  );

  const back = (
    <button type="button" onClick={onBack} className="mb-4 text-xs text-zinc-400 hover:text-zinc-200">
      ← My vaults
    </button>
  );

  if (error && !data) {
    return (
      <div>
        {back}
        <ErrorState error={error} onRetry={load} fallback="Vault not found" />
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        {back}
        <div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  const { vault, balances, pending, resolved } = data;
  const weight = myWeight(vault, isMine);
  const sum = totalWeight(vault.signers);
  const sortedBalances = [...balances].sort((a, b) => (a.denom === DENOM ? -1 : b.denom === DENOM ? 1 : a.denom.localeCompare(b.denom)));

  return (
    <div className="space-y-6">
      <div>
        {back}
        <section className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold text-white">{vault.label || `Vault #${vault.vault_id}`}</h2>
            <span className="font-mono text-xs text-zinc-500">#{vault.vault_id}</span>
          </div>
          <div className="mt-1 break-all font-mono text-xs text-zinc-400">
            <CopyableAddress address={vault.address} full />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-500">Threshold</dt>
              <dd className="text-zinc-200">
                {vault.threshold} of {sum}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Proposals open for</dt>
              <dd className="text-zinc-200">{formatTtl(Number(vault.proposal_ttl))}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500" title="Goes up with every settings change">
                Config version
              </dt>
              <dd className="text-zinc-200">{vault.config_version}</dd>
            </div>
            {vault.created_at && vault.created_at !== "0" && (
              <div>
                <dt className="text-xs text-zinc-500">Created</dt>
                <dd className="text-zinc-200">{formatTime(vault.created_at)}</dd>
              </div>
            )}
          </dl>

          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Signers</h3>
              <ul className="space-y-1.5 text-sm">
                {vault.signers.map((s) => (
                  <li key={s.address} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <CopyableAddress address={s.address} resolveName className="text-zinc-200" />
                      {isMine(s.address) && <span className="ml-1.5 text-xs text-indigo-300">you</span>}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-zinc-400">weight {s.weight}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Balance</h3>
              {sortedBalances.length === 0 ? (
                <p className="text-sm text-zinc-500">Empty. Send tokens to the vault address to fund it.</p>
              ) : (
                <ul className="space-y-1 text-sm text-zinc-200">
                  {sortedBalances.map((b) => (
                    <li key={b.denom} className="break-all">
                      {formatCoin(b, DENOM, DISPLAY)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      <ActionBanner message={notice} tone="success" onDismiss={() => setNotice(null)} />

      {proposing ? (
        <ProposeForm
          vault={vault}
          balances={balances}
          pending={pending}
          onDone={(outcome) => {
            setProposing(false);
            setTab("pending");
            refresh(outcome);
          }}
          onCancel={() => setProposing(false)}
        />
      ) : (
        weight > 0 &&
        connected && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setProposing(true)}
              disabled={sessionActive}
              title={sessionActive ? "Switch off session mode to sign vault actions" : undefined}
              className="sd-btn sd-btn-primary"
            >
              New proposal
            </button>
            {sessionActive && (
              <span className="text-xs text-zinc-500">Vault actions need your main wallet. Switch off session mode first.</span>
            )}
          </div>
        )
      )}

      <section>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
            <button
              onClick={() => setTab("pending")}
              className={`${TAB_BTN} ${tab === "pending" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-300"}`}
            >
              Pending ({pending.length})
            </button>
            <button
              onClick={() => setTab("resolved")}
              className={`${TAB_BTN} ${tab === "resolved" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-300"}`}
            >
              Resolved ({resolved.length})
            </button>
          </div>
          {tab === "resolved" && resolved.length > 0 && (
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-300"
            >
              <option value="all">All statuses</option>
              {RESOLVED.map((s) => (
                <option key={s} value={s}>
                  {VAULT_PROPOSAL_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </div>

        {error ? <ErrorState error={error} onRetry={load} compact className="mb-4" /> : null}

        {tab === "pending" ? (
          pending.length === 0 ? (
            <div className={`${CARD} p-10 text-center`}>
              <p className="text-zinc-400">No proposals waiting for approval</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pending.map((p) => (
                <ProposalCard key={p.proposal_id} vault={vault} proposal={p} onChanged={refresh} />
              ))}
            </div>
          )
        ) : (
          <>
            <p className="mb-3 text-xs text-zinc-500">Resolved proposals are removed from the chain 7 days after they close.</p>
            {shownResolved.length === 0 ? (
              <div className={`${CARD} p-10 text-center`}>
                <p className="text-zinc-400">Nothing here</p>
              </div>
            ) : (
              <div className="space-y-4">
                {shownResolved.map((p) => (
                  <ProposalCard key={p.proposal_id} vault={vault} proposal={p} onChanged={refresh} />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
