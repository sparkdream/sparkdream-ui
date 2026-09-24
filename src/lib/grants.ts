// Helpers for x/session grants (recurring payments, spending allowances,
// scheduled transfers, session keys). Time math mirrors the chain's keeper so
// the UI can say "claimable now" without a dry-run.

import type { Coin, Grant, GrantStatus, GrantType, Session, SessionParams } from "@/types/session";
import { formatSpark } from "./utils";

export const GRANT_TYPE_LABEL: Record<GrantType, string> = {
  GRANT_TYPE_UNSPECIFIED: "Grant",
  GRANT_TYPE_SESSION_KEY: "Session key",
  GRANT_TYPE_RECURRING_PULL: "Recurring payment",
  GRANT_TYPE_SPENDING_ALLOWANCE: "Spending allowance",
  GRANT_TYPE_SCHEDULED_ONESHOT: "Scheduled transfer",
};

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  GRANT_STATUS_UNSPECIFIED: "Unknown",
  GRANT_STATUS_ACTIVE: "Active",
  GRANT_STATUS_PAUSED_INSUFFICIENT_FUNDS: "Paused",
  GRANT_STATUS_DECLINED: "Declined",
  GRANT_STATUS_REVOKED: "Revoked",
  GRANT_STATUS_COMPLETED: "Completed",
  GRANT_STATUS_FIRED: "Sent",
};

/** Active or paused: the grant can still move funds and can be revoked or declined. */
export function isLive(g: Grant): boolean {
  return g.status === "GRANT_STATUS_ACTIVE" || g.status === "GRANT_STATUS_PAUSED_INSUFFICIENT_FUNDS";
}

export function int(s: string | undefined): number {
  const n = parseInt(s || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

function big(s: string | undefined): bigint {
  try {
    return BigInt(s || "0");
  } catch {
    return BigInt(0);
  }
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Unix seconds of an RFC 3339 timestamp. */
export function tsSec(rfc3339: string | undefined): number {
  if (!rfc3339) return 0;
  const t = new Date(rfc3339).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

/**
 * Display a Coin. The bond denom renders in its display unit; anything else
 * (only reachable if gov adds allowed_denoms) falls back to base units.
 */
export function formatCoin(coin: Coin | undefined, bondDenom: string, displayDenom: string): string {
  // An unset non-nullable Coin comes back as {denom: "", amount: "0"}.
  if (!coin || !coin.denom || coin.denom === bondDenom) return `${formatSpark(coin?.amount ?? "0")} ${displayDenom}`;
  return `${coin.amount} ${coin.denom}`;
}

const DAY = 86_400;

/** "day", "week", "30 days", "6 hours" — the unit in "every …". */
export function formatPeriod(seconds: number): string {
  if (seconds === DAY) return "day";
  if (seconds === 7 * DAY) return "week";
  if (seconds % DAY === 0) return `${seconds / DAY} days`;
  if (seconds === 3600) return "hour";
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

// ── Recurring payments ─────────────────────────────────────────────

/** Payments the schedule allows in total: claim k opens at start + k·period and must not pass expires_at. */
export function recurringTotalPeriods(g: Grant): number {
  const rp = g.recurring_pull;
  const period = int(rp?.period_seconds);
  if (!rp || period <= 0) return 0;
  return Math.max(0, Math.floor((tsSec(g.expires_at) - int(rp.start_time)) / period));
}

/** Unix seconds at which the next payment becomes claimable. */
export function recurringNextClaimAt(g: Grant): number {
  const rp = g.recurring_pull;
  return int(rp?.last_claim_advance) + int(rp?.period_seconds);
}

/** Payments claimable right now (catch-up included). */
export function recurringClaimable(g: Grant, now = nowSec()): number {
  const rp = g.recurring_pull;
  const period = int(rp?.period_seconds);
  if (!rp || period <= 0 || !isLive(g)) return 0;
  const last = int(rp.last_claim_advance);
  const expires = tsSec(g.expires_at);
  const due = Math.floor((now - last) / period);
  const left = Math.floor((expires - last) / period);
  return Math.max(0, Math.min(due, left));
}

/** Most claims one tx should batch without tripping the per-day ceiling. */
export const MAX_CLAIMS_PER_TX = 10;

export function recurringBatchSize(g: Grant, now = nowSec()): number {
  const rp = g.recurring_pull;
  const amount = big(rp?.amount_per_period?.amount);
  const perDay = big(rp?.max_per_epoch);
  const byCeiling = amount > BigInt(0) ? Number(perDay / amount) : 0;
  return Math.max(0, Math.min(recurringClaimable(g, now), byCeiling || 1, MAX_CLAIMS_PER_TX));
}

// ── Spending allowances ────────────────────────────────────────────

/** Base units still spendable in the current window, plus when the window resets. */
export function allowanceRemaining(g: Grant, now = nowSec()): { remaining: bigint; resetsAt: number | null } {
  const sa = g.spending_allowance;
  const cap = big(sa?.max_per_period?.amount);
  const period = int(sa?.period_seconds);
  const start = int(sa?.current_period_start);
  // The window only resets lazily on the next pull; until then a stale window
  // means the full cap is available.
  if (!sa || start === 0 || now >= start + period) return { remaining: cap, resetsAt: null };
  const spent = big(sa.spent_in_current_period?.amount);
  return { remaining: cap > spent ? cap - spent : BigInt(0), resetsAt: start + period };
}

// ── Scheduled transfers ────────────────────────────────────────────

/** The SPARK deposit escrowed for a transfer oneshot: max(creation fee, min deposit), in base units. */
export function oneshotTransferDeposit(params: SessionParams | null): bigint {
  const fee = big(params?.oneshot_creation_fee);
  const min = big(params?.min_oneshot_deposit);
  return fee > min ? fee : min;
}

// ── Session keys ───────────────────────────────────────────────────

/** Project a SESSION_KEY grant onto the legacy Session shape session mode uses. */
export function grantToSession(g: Grant): Session {
  const sk = g.session_key ?? {};
  return {
    granter: g.granter,
    grantee: g.grantee,
    allowed_msg_types: sk.allowed_msg_types ?? [],
    spend_limit: sk.spend_limit ?? { denom: "", amount: "0" },
    spent: sk.spent ?? { denom: "", amount: "0" },
    expiration: g.expires_at,
    created_at: g.created_at,
    last_used_at: sk.last_used_at ?? "",
    exec_count: sk.exec_count ?? "0",
    max_exec_count: sk.max_exec_count ?? "0",
  };
}

/** "/sparkdream.blog.v1.MsgCreatePost" → "CreatePost (blog)" */
export function msgTypeLabel(typeUrl: string): string {
  const parts = typeUrl.split(".");
  const msg = parts[parts.length - 1].replace(/^Msg/, "");
  return `${msg} (${parts[1] || ""})`;
}

/** Parse a params Duration ("604800s" or {seconds}) to seconds. */
export function durationSeconds(raw: unknown): number {
  if (typeof raw === "string") {
    const m = raw.match(/^(\d+(?:\.\d+)?)s$/);
    return m ? parseFloat(m[1]) : parseFloat(raw) || 0;
  }
  if (typeof raw === "object" && raw !== null) {
    return Number((raw as { seconds?: string | number }).seconds || 0);
  }
  return Number(raw) || 0;
}
