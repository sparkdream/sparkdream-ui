"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveName } from "@/lib/api";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { truncateAddress } from "@/lib/utils";

export const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export function Field({
  id,
  label,
  help,
  children,
}: {
  id?: string;
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-zinc-300">
        {label}
      </label>
      {children}
      {help && <p className="mt-1 text-xs text-zinc-500">{help}</p>}
    </div>
  );
}

export function FormShell({
  title,
  intro,
  onSubmit,
  children,
}: {
  title: string;
  intro: ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mb-8 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
    >
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-zinc-400">{intro}</p>
      </div>
      {children}
    </form>
  );
}

export function FormActions({
  submitting,
  disabled,
  label,
  onCancel,
  error,
}: {
  submitting: boolean;
  disabled?: boolean;
  label: string;
  onCancel: () => void;
  error: string | null;
}) {
  return (
    <>
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting || disabled} className="sd-btn sd-btn-primary">
          {submitting ? "Signing..." : label}
        </button>
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">
          Cancel
        </button>
      </div>
    </>
  );
}

/** Summary box restating what the form will do, in plain words, before signing. */
export function Preview({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-300">
      {children}
    </div>
  );
}

export interface ResolvedAddress {
  /** Resolved bech32 address, or null while empty / resolving / invalid. */
  address: string | null;
  resolving: boolean;
  error: string | null;
  /** Set when the input was a name, for the "→ address" hint. */
  viaName: string | null;
}

/**
 * Accepts a bech32 address or a registered name, resolving names through
 * x/name (honoring an accepted target over the owner, as the chain does).
 */
export function useResolvedAddress(input: string): ResolvedAddress {
  const { config } = useChainConfig();
  const value = input.trim();
  const prefix = config.bech32Prefix;

  // Everything but a name lookup is decided synchronously.
  const sync = useMemo<ResolvedAddress | null>(() => {
    if (!value) return { address: null, resolving: false, error: null, viaName: null };
    if (value.startsWith(`${prefix}1`)) {
      const ok = new RegExp(`^${prefix}1[02-9ac-hj-np-z]{38}$`).test(value);
      return { address: ok ? value : null, resolving: false, error: ok ? null : "Not a valid address", viaName: null };
    }
    if (!/^[a-z0-9-]+$/i.test(value)) {
      return { address: null, resolving: false, error: "Enter an address or a name", viaName: null };
    }
    return null;
  }, [value, prefix]);

  const [lookup, setLookup] = useState<{ name: string; result: ResolvedAddress } | null>(null);

  useEffect(() => {
    if (sync) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let result: ResolvedAddress;
      try {
        const { name_record: r } = await resolveName(value.toLowerCase());
        const addr = r.target && r.target_accepted ? r.target : r.owner;
        result = { address: addr || null, resolving: false, error: addr ? null : "Name has no address", viaName: value };
      } catch {
        result = { address: null, resolving: false, error: `No name "${value}"`, viaName: null };
      }
      if (!cancelled) setLookup({ name: value, result });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sync, value]);

  if (sync) return sync;
  if (lookup?.name === value) return lookup.result;
  return { address: null, resolving: true, error: null, viaName: null };
}

export function AddressInput({
  id,
  value,
  onChange,
  resolved,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  resolved: ResolvedAddress;
  placeholder?: string;
}) {
  const { config } = useChainConfig();
  return (
    <>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? `Name or ${config.bech32Prefix}1…`}
        autoComplete="off"
        spellCheck={false}
        className={`${INPUT_CLASS} font-mono`}
      />
      {resolved.resolving && <p className="mt-1 text-xs text-zinc-500">Looking up name…</p>}
      {resolved.error && <p className="mt-1 text-xs text-red-400">{resolved.error}</p>}
      {resolved.viaName && resolved.address && (
        <p className="mt-1 font-mono text-xs text-zinc-500">→ {truncateAddress(resolved.address)}</p>
      )}
    </>
  );
}

/** Value for a datetime-local input, in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(sec: number): string {
  return new Date(sec * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
