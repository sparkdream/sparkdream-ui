"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listServiceOperators,
  listServiceTypes,
} from "@/lib/api";
import {
  OperatorStatus,
  OPERATOR_STATUS_LABELS,
  type Operator,
  type ServiceTypeConfig,
} from "@/types/service";
import CopyableAddress from "@/components/CopyableAddress";

// x/service was added in chain commit 95a0e38 as the SPARK-bonded
// accountability primitive for off-chain operators (Akash funders, pinning
// agents, federation bridges, external RPC, …). The chain hires an operator
// via an x/commons Group ("controller"), which posts a `min_bond` SPARK
// escrow per gov-allowlisted ServiceType. See docs/x-service-spec.md.
//
// This panel is read-only: registration / top-up / unbond / report all flow
// through tx messages that, in turn, must be wrapped in a controller-group
// proposal — outside the scope of a simple add. Listing surfaces the data so
// COC members and observers can audit operator bond, status, and slash
// history without dropping to the LCD.

function formatSpark(amount: string): string {
  if (!amount || amount === "0") return "0";
  try {
    return (BigInt(amount) / BigInt(1_000_000)).toLocaleString();
  } catch {
    return "0";
  }
}

function statusBadge(status: string) {
  if (status === OperatorStatus.ACTIVE) {
    return "bg-emerald-500/15 text-emerald-400";
  }
  if (status === OperatorStatus.UNDERFUNDED || status === OperatorStatus.UNBONDING) {
    return "bg-amber-500/15 text-amber-400";
  }
  if (status === OperatorStatus.RETIRED) {
    return "bg-zinc-500/15 text-zinc-400";
  }
  return "bg-red-500/15 text-red-400";
}

export default function ServiceOperators() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [types, setTypes] = useState<ServiceTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-service-type filter; empty = show all.
  const [filterType, setFilterType] = useState<string>("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [opsRes, typesRes] = await Promise.all([
        listServiceOperators({ limit: "200", reverse: true }).catch(() => null),
        listServiceTypes({ limit: "100" }).catch(() => null),
      ]);
      setOperators(opsRes?.operators || []);
      setTypes(typesRes?.configs || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load service operators";
      // Pre-v1.0.4 chains don't have x/service; surface as empty state, not error.
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setOperators([]);
        setTypes([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = filterType
    ? operators.filter((o) => o.service_type === filterType)
    : operators;

  // Roll up bond per service-type for the summary header.
  const summary: Record<string, { count: number; bond: bigint }> = {};
  for (const op of operators) {
    const e = summary[op.service_type] ??= { count: 0, bond: BigInt(0) };
    e.count += 1;
    try { e.bond += BigInt(op.bond_amount || "0"); } catch {}
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="h-24 animate-pulse sd-hull-tile rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchData} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Service operators</h2>
        <p className="mt-1 text-sm text-zinc-500">
          SPARK-bonded off-chain operators. Each operator is hired by an
          x/commons Group (the controller) and escrows SPARK per service type.
          Slashes resolve unilaterally up to <span className="font-mono">unilateral_slash_cap_bps</span> or
          escalate to an x/rep jury.
        </p>
      </div>

      {/* Per-service-type summary + filter */}
      {types.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((t) => {
            const s = summary[t.service_type];
            const active = filterType === t.service_type;
            return (
              <button
                key={t.service_type}
                onClick={() => setFilterType(active ? "" : t.service_type)}
                className={`sd-hull-tile rounded-xl p-3 text-left transition-colors ${
                  active ? "ring-1 ring-indigo-500" : "hover:bg-zinc-900/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-zinc-300">{t.service_type}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                    t.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-500"
                  }`}>
                    {t.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-3 text-xs text-zinc-500">
                  <span>{s?.count ?? 0} live</span>
                  <span>Min bond: {formatSpark(t.min_bond_amount)} SPARK</span>
                </div>
                {s && s.bond > BigInt(0) && (
                  <div className="text-xs text-zinc-500">
                    Total bonded: {formatSpark(s.bond.toString())} SPARK
                  </div>
                )}
                {t.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{t.description}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {filterType && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Filtered to <span className="font-mono text-zinc-400">{filterType}</span></span>
          <button onClick={() => setFilterType("")} className="text-indigo-400 underline hover:text-indigo-300">
            clear
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-8 text-center text-sm text-zinc-500">
          {operators.length === 0
            ? "No live service operators on this chain."
            : "No operators match the current filter."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl sd-hull-tile">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Operator</th>
                <th className="px-3 py-2 font-medium">Service type</th>
                <th className="px-3 py-2 font-medium text-right">Bond (SPARK)</th>
                <th className="px-3 py-2 font-medium">Controller</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((op) => (
                <tr key={`${op.address}/${op.service_type}`} className="border-t border-zinc-800/60">
                  <td className="px-3 py-2">
                    <CopyableAddress address={op.address} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{op.service_type}</td>
                  <td className="px-3 py-2 text-right font-medium text-zinc-200">
                    {formatSpark(op.bond_amount)}
                  </td>
                  <td className="px-3 py-2">
                    <CopyableAddress address={op.controller} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(op.status)}`}>
                      {OPERATOR_STATUS_LABELS[op.status] || op.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
