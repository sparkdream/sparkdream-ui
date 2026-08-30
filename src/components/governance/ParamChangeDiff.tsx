"use client";

import { useEffect, useState } from "react";
import { getModuleParams } from "@/lib/api";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  displayValue,
  findFieldByApiKey,
  findModuleByTypeUrl,
  getByPath,
  type FieldDef,
  type ModuleDef,
} from "@/lib/paramMeta";

/**
 * Before/after view of a governance `MsgUpdateParams`.
 *
 * The message carries the module's *whole* params object, not just the edited
 * fields, so "what does this proposal change?" is only answerable by diffing
 * it against what the chain holds now. We walk both objects leaf by leaf and
 * show the paths that differ, formatted with the same labels and units the
 * parameter-change form uses.
 *
 * The comparison is against live params, so once a proposal has executed its
 * changes read as already applied and the diff comes back empty. The caller
 * gets that stated rather than an empty box.
 */

interface ParamDiffRow {
  /** LCD dot-path, e.g. `apprentice_tier.max_budget` */
  path: string;
  label: string;
  from: string;
  to: string;
  /** Set when the path has no FieldDef, so the row can show the raw path */
  unlabeled: boolean;
}

/** One in-flight/settled params fetch per LCD path, shared by every card on
 * the page — a list of param proposals otherwise refetches the same module
 * params once per card. */
const paramsCache = new Map<string, Promise<Record<string, unknown>>>();

function fetchParams(module: ModuleDef): Promise<Record<string, unknown>> {
  const cached = paramsCache.get(module.paramPath);
  if (cached) return cached;
  const p = getModuleParams(module.paramPath).then(
    (res) => (res[module.responseKey] as Record<string, unknown>) || {}
  );
  paramsCache.set(module.paramPath, p);
  // Don't cache failures: a transient LCD error shouldn't poison the page.
  p.catch(() => paramsCache.delete(module.paramPath));
  return p;
}

export default function ParamChangeDiff({
  msg,
  applied = false,
}: {
  msg: { "@type": string; [key: string]: unknown };
  /** The proposal has already executed, so an empty diff means "these values
   * are live now" rather than "this proposal changes nothing". */
  applied?: boolean;
}) {
  const { config } = useChainConfig();
  const match = findModuleByTypeUrl(String(msg["@type"] || ""));
  const proposed = (msg.params as Record<string, unknown> | undefined) ?? null;

  const [current, setCurrent] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const paramPath = match?.module.paramPath;

  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    fetchParams(match.module)
      .then((params) => {
        if (!cancelled) setCurrent(params);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `match` is recomputed each render; the LCD path is what identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramPath]);

  // Not a params message, or a module we have no field table for: the caller's
  // one-line description is all we can say.
  if (!match || !proposed) return null;

  const rows =
    current && !failed
      ? diffParams(match.module, current, proposed, config.displayDenom)
      : [];

  const visible = showAll ? rows : rows.slice(0, 6);

  return (
    <div className="ml-3.5 mt-1 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      {!current && !failed && (
        <div className="text-xs text-zinc-500">Loading current values...</div>
      )}

      {failed && (
        <div className="text-xs text-zinc-500">
          {`Could not load the chain's current ${match.module.label} params to compare against.`}
        </div>
      )}

      {current && !failed && rows.length === 0 && (
        <div className="text-xs text-zinc-500">
          {applied
            ? `These values are the chain's current ${match.module.label} params.`
            : `No differences from the chain's current ${match.module.label} params.`}
        </div>
      )}

      {visible.length > 0 && (
        <ul className="space-y-1">
          {visible.map((row) => (
            <li
              key={row.path}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
            >
              <span
                className={`text-xs ${row.unlabeled ? "font-mono text-zinc-500" : "text-zinc-400"}`}
                title={row.path}
              >
                {row.label}
              </span>
              <span className="flex items-baseline gap-1.5 text-xs">
                <span className="text-zinc-500 line-through decoration-zinc-700">
                  {row.from}
                </span>
                <span className="text-zinc-600">&rarr;</span>
                <span className="font-medium text-white">{row.to}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {rows.length > visible.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1 text-xs text-indigo-400 hover:text-indigo-300"
        >
          Show all {rows.length} changes
        </button>
      )}
    </div>
  );
}

// ── Diffing ─────────────────────────────────────────────────────────

/** Compare the proposed params against the live ones, leaf by leaf. Arrays
 * (coin lists, string lists) count as leaves: a per-element diff would say
 * less than showing the whole value before and after. */
function diffParams(
  module: ModuleDef,
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  displayDenom: string
): ParamDiffRow[] {
  const paths = new Set<string>();
  collectLeafPaths(current, "", paths);
  collectLeafPaths(proposed, "", paths);

  const rows: ParamDiffRow[] = [];
  for (const path of paths) {
    const a = getByPath(current, path);
    const b = getByPath(proposed, path);
    if (sameValue(a, b)) continue;

    const field = findFieldByApiKey(module, path);
    rows.push({
      path,
      label: field ? field.label : humanizePath(path),
      unlabeled: !field,
      from: formatParam(field, a, displayDenom),
      to: formatParam(field, b, displayDenom),
    });
  }

  // Described fields first, in the form's own order, so a diff reads like the
  // form that produced it; anything we have no FieldDef for trails behind.
  const order = new Map(module.fields.map((f, i) => [f.apiKey, i]));
  return rows.sort((x, y) => {
    const xi = order.get(x.path) ?? Number.MAX_SAFE_INTEGER;
    const yi = order.get(y.path) ?? Number.MAX_SAFE_INTEGER;
    if (xi !== yi) return xi - yi;
    return x.path.localeCompare(y.path);
  });
}

function collectLeafPaths(
  value: unknown,
  prefix: string,
  out: Set<string>
): void {
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      collectLeafPaths(value[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (prefix) out.add(prefix);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Values that are equal for display purposes. Protobuf JSON omits zero
 * values, so a field the chain reports as absent and one the proposal sends
 * as "0" are the same param, not a change. */
function sameValue(a: unknown, b: unknown): boolean {
  if (isZeroish(a) && isZeroish(b)) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isZeroish(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "boolean") return v === false;
  if (typeof v === "number") return v === 0;
  if (typeof v === "string") {
    if (v === "" || v === "0s") return true;
    // "0", "0.000000000000000000" and other decimal spellings of zero
    return /^0*(\.0*)?$/.test(v);
  }
  return false;
}

/** Render one side of a change. Falls back to the raw JSON for paths the
 * form doesn't describe, so a CLI-built proposal still shows its values. */
function formatParam(
  field: FieldDef | undefined,
  raw: unknown,
  displayDenom: string
): string {
  if (!field) {
    if (raw === undefined || raw === null) return "unset";
    if (typeof raw === "object") return JSON.stringify(raw);
    return String(raw);
  }

  const shown = trimDecimal(displayValue(field, raw));
  if (shown === "") return defaultForKind(field, displayDenom);

  const unit = unitLabel(field, displayDenom);
  return unit ? `${shown} ${unit}` : shown;
}

/** LegacyDec values arrive at full precision ("0.750000000000000000"); a diff
 * reads better as "0.75". Value-preserving, and display-only. */
function trimDecimal(value: string): string {
  if (!/^-?\d+\.\d+$/.test(value)) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

/** What an absent field means on the wire, by kind: protobuf JSON drops zero
 * values, so "missing" is a zero, not an unknown. */
function defaultForKind(field: FieldDef, displayDenom: string): string {
  if (field.kind === "boolean") return "false";
  if (field.kind === "string") return "unset";
  const unit = unitLabel(field, displayDenom);
  return unit ? `0 ${unit}` : "0";
}

function unitLabel(field: FieldDef, displayDenom: string): string {
  switch (field.kind) {
    case "duration":
      return field.unit || "seconds";
    case "amount":
    case "coin":
    case "coins":
      return displayDenom;
    case "dream":
      return "DREAM";
    default:
      return "";
  }
}

/** "apprentice_tier.max_budget" -> "Apprentice tier / max budget". Only used
 * for params the form has no FieldDef for. */
function humanizePath(path: string): string {
  return path
    .split(".")
    .map((seg) => seg.replace(/_/g, " "))
    .join(" / ")
    .replace(/^./, (c) => c.toUpperCase());
}
