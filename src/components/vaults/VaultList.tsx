"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import { getVault, getVaultByAddress, listVaultsBySigner } from "@/lib/vaultApi";
import { truncateAddress } from "@/lib/utils";
import ErrorState from "@/components/ErrorState";
import { INPUT_CLASS } from "@/components/permissions/fields";
import type { Vault } from "@/types/vault";
import { CARD, formatTtl, myWeight, totalWeight } from "./shared";

const PAGE = 50;

export default function VaultList({
  onOpen,
  onCreate,
}: {
  onOpen: (vaultId: string) => void;
  onCreate: () => void;
}) {
  const { signerAddress } = useWallet();
  const { isMine } = useMyAliases();
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!signerAddress) return;
    try {
      const res = await listVaultsBySigner(signerAddress, 0, PAGE);
      setVaults(res.vaults || []);
      setTotal(Number(res.pagination?.total || res.vaults?.length || 0));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [signerAddress]);

  const loadMore = async () => {
    if (!signerAddress) return;
    try {
      const res = await listVaultsBySigner(signerAddress, vaults.length, PAGE);
      setVaults((v) => [...v, ...(res.vaults || [])]);
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <VaultLookup onOpen={onOpen} />

      {error ? <ErrorState error={error} onRetry={load} /> : null}

      {loading ? (
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      ) : vaults.length === 0 && !error ? (
        <div className={`${CARD} p-12 text-center`}>
          <p className="text-zinc-400">You aren&apos;t a signer on any vault yet</p>
          <button type="button" onClick={onCreate} className="sd-btn sd-btn-secondary mt-4">
            Create one
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {vaults.map((v) => {
            const mine = myWeight(v, isMine);
            return (
              <button
                key={v.vault_id}
                type="button"
                onClick={() => onOpen(v.vault_id)}
                className={`${CARD} block w-full text-left transition-colors hover:border-indigo-600`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-base font-semibold text-white">{v.label || `Vault #${v.vault_id}`}</span>
                  <span className="font-mono text-xs text-zinc-500">#{v.vault_id}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-zinc-400">{truncateAddress(v.address, 14, 6)}</div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
                  <span>
                    {v.signers.length} signer{v.signers.length === 1 ? "" : "s"}
                  </span>
                  <span>
                    Needs {v.threshold} of {totalWeight(v.signers)}
                  </span>
                  {mine > 0 && <span>Your weight: {mine}</span>}
                  <span>Proposals open {formatTtl(Number(v.proposal_ttl))}</span>
                </div>
              </button>
            );
          })}
          {vaults.length < total && (
            <button type="button" onClick={loadMore} className="sd-btn sd-btn-secondary">
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Open any vault by id or address, to view one you don't sign for. */
function VaultLookup({ onOpen }: { onOpen: (vaultId: string) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      if (/^\d+$/.test(q)) {
        const v = await getVault(q);
        onOpen(v.vault_id);
      } else {
        const v = await getVaultByAddress(q);
        if (v) onOpen(v.vault_id);
        else setError("That address isn't a vault");
      }
    } catch {
      setError("No vault found");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Open a vault by id or address"
          aria-label="Vault id or address"
          spellCheck={false}
          autoComplete="off"
          className={INPUT_CLASS}
        />
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <button type="submit" disabled={busy || !query.trim()} className="sd-btn sd-btn-secondary">
        Open
      </button>
    </form>
  );
}
