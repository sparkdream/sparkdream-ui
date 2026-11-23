import type { ServiceState } from "@/lib/serviceStatus";

export const STATE_STYLE: Record<ServiceState, { label: string; color: string; soft: string }> = {
  ok: { label: "Working", color: "var(--green)", soft: "var(--green-soft)" },
  degraded: { label: "Degraded", color: "var(--amber)", soft: "var(--amber-soft)" },
  unreachable: { label: "Unreachable", color: "var(--rose)", soft: "var(--rose-soft)" },
  off: { label: "Not set up", color: "var(--ink-soft)", soft: "var(--panel-2)" },
};

export interface CardRow {
  label: string;
  value: React.ReactNode;
}

function StatePill({ state }: { state: ServiceState | null }) {
  if (!state) {
    return <span className="shrink-0 text-xs text-zinc-500">Checking</span>;
  }
  const s = STATE_STYLE[state];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: s.soft, color: s.color }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

/** One service on the Status page. `state` null means the first check is still running. */
export default function ServiceCard({
  name,
  purpose,
  endpoint,
  state,
  issues,
  rows,
}: {
  name: string;
  purpose: string;
  /** Host shown under the purpose, when it is public. */
  endpoint?: string;
  state: ServiceState | null;
  issues: string[];
  rows: CardRow[];
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">{name}</h3>
          <p className="mt-0.5 text-sm text-zinc-400">{purpose}</p>
          {endpoint && <p className="mt-1 break-all font-mono text-xs text-zinc-500">{endpoint}</p>}
        </div>
        <StatePill state={state} />
      </div>

      {state && issues.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" style={{ color: STATE_STYLE[state].color }}>
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <dl className="mt-3 divide-y divide-zinc-800/70 border-t border-zinc-800/70">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="text-sm text-zinc-400">{row.label}</dt>
              <dd className="min-w-0 break-all text-right font-mono text-sm text-zinc-100">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
