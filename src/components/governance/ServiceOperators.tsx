"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getLatestBlockHeight,
  listCheckpointsByServiceType,
  listServiceOperators,
  listServiceTypes,
} from "@/lib/api";
import {
  CONTENT_SCANNER_SERVICE_TYPE,
  OperatorStatus,
  OPERATOR_STATUS_LABELS,
  type Checkpoint,
  type Operator,
  type ServiceTypeConfig,
} from "@/types/service";
import CopyableAddress from "@/components/CopyableAddress";
import ScannerOperatorPanel from "@/components/governance/ScannerOperatorPanel";
import ErrorState from "@/components/ErrorState";
import { isMissingEndpoint } from "@/lib/errors";

// x/service was added in chain commit 95a0e38 as the SPARK-bonded
// accountability primitive for off-chain operators (Akash funders, pinning
// agents, federation bridges, external RPC, …). The chain hires an operator
// via an x/commons Group ("controller"), which posts a `min_bond` SPARK
// escrow per gov-allowlisted ServiceType. See docs/x-service-spec.md.
//
// The listing is read-only and surfaces the data so COC members and
// observers can audit operator bond, status, and slash history without
// dropping to the LCD. An operator registers itself (MsgRegisterOperator is
// signed by the operator, naming the council as controller);
// ScannerOperatorPanel does that for content scanners, the one type whose
// operators are ordinary members rather than launcher-run daemons.

function formatSpark(amount: string): string {
  if (!amount || amount === "0") return "0";
  try {
    return (BigInt(amount) / BigInt(1_000_000)).toLocaleString();
  } catch {
    return "0";
  }
}

// Checkpoint roots are 32 bytes, base64 in LCD JSON; show them as hex.
function base64ToHex(b64: string): string {
  try {
    const bin = atob(b64);
    let out = "";
    for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, "0");
    return out;
  } catch {
    return b64;
  }
}

function toInt(v: string | number | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Types whose operators checkpoint: liveness tracking on, an attestation
// quorum set, or the seeded content-scanner type.
function tracksCheckpoints(t: ServiceTypeConfig): boolean {
  return (
    t.service_type === CONTENT_SCANNER_SERVICE_TYPE ||
    toInt(t.checkpoint_max_lag_blocks) > 0 ||
    toInt(t.attestation_quorum) > 0
  );
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
  const [error, setError] = useState<unknown>(null);
  // Per-service-type filter; empty = show all.
  const [filterType, setFilterType] = useState<string>("");
  // Latest MsgSubmitCheckpoint per `${service_type}/${operator}`.
  const [checkpoints, setCheckpoints] = useState<Record<string, Checkpoint>>({});
  const [currentHeight, setCurrentHeight] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [opsRes, typesRes] = await Promise.all([
        listServiceOperators({ limit: "200", reverse: true }).catch(() => null),
        listServiceTypes({ limit: "100" }).catch(() => null),
      ]);
      setOperators(opsRes?.operators || []);
      const configs = typesRes?.configs || [];
      setTypes(configs);

      // Checkpoints are a newer query (chain commit 246bf2b); a node without
      // it just leaves the column empty.
      const tracked = configs.filter(tracksCheckpoints);
      const [height, ...cpRes] = await Promise.all([
        getLatestBlockHeight().catch(() => null),
        ...tracked.map((t) =>
          listCheckpointsByServiceType(t.service_type, { limit: "200" }).catch(() => null)
        ),
      ]);
      const cps: Record<string, Checkpoint> = {};
      for (const res of cpRes) {
        for (const cp of res?.checkpoints || []) cps[`${cp.service_type}/${cp.operator}`] = cp;
      }
      setCheckpoints(cps);
      setCurrentHeight(height ? Number(height) : null);
    } catch (err) {
      // Pre-v1.0.4 chains don't have x/service; surface as empty state, not error.
      if (isMissingEndpoint(err)) {
        setOperators([]);
        setTypes([]);
      } else {
        setError(err);
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
  const typeByName: Record<string, ServiceTypeConfig> = {};
  for (const t of types) typeByName[t.service_type] = t;
  const showCheckpoints = filtered.some((o) => {
    const t = typeByName[o.service_type];
    return (t && tracksCheckpoints(t)) || !!checkpoints[`${o.service_type}/${o.address}`];
  });

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
      <ErrorState error={error} onRetry={fetchData} />
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

      <ScannerOperatorPanel onChanged={fetchData} />

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
                {(toInt(t.attestation_quorum) > 0 || toInt(t.checkpoint_max_lag_blocks) > 0) && (
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                    {toInt(t.attestation_quorum) > 0 && (
                      <span title="Independent active operators that must agree before clients accept an attestation">
                        Quorum: {toInt(t.attestation_quorum)}
                        {toInt(t.elevated_attestation_quorum) > toInt(t.attestation_quorum) &&
                          ` (${toInt(t.elevated_attestation_quorum)} for low-trust authors)`}
                      </span>
                    )}
                    {toInt(t.checkpoint_max_lag_blocks) > 0 && (
                      <span title="How far a checkpoint may trail the chain before an automatic liveness report">
                        Max lag: {toInt(t.checkpoint_max_lag_blocks).toLocaleString("en-US")} blocks
                      </span>
                    )}
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
                {showCheckpoints && <th className="px-3 py-2 font-medium">Latest checkpoint</th>}
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
                  {showCheckpoints && (
                    <td className="px-3 py-2">
                      <CheckpointCell
                        checkpoint={checkpoints[`${op.service_type}/${op.address}`]}
                        config={typeByName[op.service_type]}
                        operator={op}
                        currentHeight={currentHeight}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CheckpointCell({
  checkpoint,
  config,
  operator,
  currentHeight,
}: {
  checkpoint: Checkpoint | undefined;
  config: ServiceTypeConfig | undefined;
  operator: Operator;
  currentHeight: number | null;
}) {
  const maxLag = toInt(config?.checkpoint_max_lag_blocks);
  if (!checkpoint) {
    if (!config || !tracksCheckpoints(config)) return <span className="text-xs text-zinc-600">n/a</span>;
    // Before the first checkpoint, liveness counts from registration.
    const since = currentHeight !== null ? currentHeight - toInt(operator.registered_at) : null;
    const overdue = maxLag > 0 && since !== null && since > maxLag;
    return (
      <span className={`text-xs ${overdue ? "text-red-400" : "text-zinc-500"}`}>
        None yet
        {since !== null && since >= 0 && ` (registered ${since.toLocaleString("en-US")} blocks ago)`}
      </span>
    );
  }
  const height = toInt(checkpoint.height);
  const lag = currentHeight !== null ? Math.max(0, currentHeight - height) : null;
  const overdue = maxLag > 0 && lag !== null && lag > maxLag;
  const rootHex = base64ToHex(checkpoint.root);
  return (
    <div className="text-xs">
      <div className="text-zinc-300">
        Block {height.toLocaleString("en-US")}
        {lag !== null && (
          <span className={overdue ? "text-red-400" : "text-zinc-500"}>
            {" "}
            · {lag.toLocaleString("en-US")} behind
            {maxLag > 0 && ` of ${maxLag.toLocaleString("en-US")} allowed`}
          </span>
        )}
      </div>
      <div className="font-mono text-[11px] text-zinc-500" title={rootHex}>
        Root {rootHex.slice(0, 12)}…{rootHex.slice(-6)}
      </div>
    </div>
  );
}
