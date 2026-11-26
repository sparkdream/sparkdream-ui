// How the Status page judges a worker's session key (x/session).
//
// The off-chain workers (content scanner, chain archiver, storage worker,
// federation bridge) normally don't hold their operator's key. The operator
// grants a session to a key on the worker's machine: a list of messages it
// may send, an expiry, a fee budget and a number of uses. When any of the
// three runs out the worker goes on running and every message it sends is
// refused, which from outside looks like a worker that has stopped. So each
// operator's card says how much is left of the key its worker uses, and
// when it was last used, the nearest thing to a heartbeat the chain holds
// for a worker that doesn't checkpoint.
//
// An operator may also run its worker with its own key and no session. The
// chain can't tell that from a session that was never granted, so a missing
// session is shown, not counted as a failure.

import { formatAge, type ServiceFact, type ServiceReport } from "./serviceStatus";
import type { Session } from "@/types/session";

// A key this close to its end is reported while it still works, so the
// operator can grant a new one before the worker is refused.
export const EXPIRES_SOON_MS = 3 * 86_400_000;
export const LOW_SHARE = 0.05;

export interface SessionNote {
  /** dead: refused now. soon: about to be. ok. none: no session covers the message. */
  state: "ok" | "soon" | "dead" | "none";
  /** What the card shows for this key. */
  value: string;
  /** One sentence when the key is dead or nearly so. */
  issue: string | null;
}

function share(left: bigint, of: bigint): number | null {
  if (of <= BigInt(0)) return null;
  return Number((left * BigInt(10_000)) / of) / 10_000;
}

function big(v: string | undefined): bigint {
  return v && /^\d+$/.test(v) ? BigInt(v) : BigInt(0);
}

const pct = (v: number) => `${Math.max(0, Math.floor(v * 100))}%`;

/**
 * Judge the session `granter` gave its worker for `msgType`. `who` names the
 * worker in an issue ("The archiver's", "A scanner's"). With several sessions
 * covering the message, the one that will last longest is judged.
 */
export function assessSession(sessions: Session[], msgType: string, who: string, now: number): SessionNote {
  const covering = sessions.filter((s) => (s.allowed_msg_types || []).includes(msgType));
  if (covering.length === 0) {
    return { state: "none", value: "None for its messages", issue: null };
  }
  const judged = covering.map((s) => judge(s, who, now));
  const order = { ok: 0, soon: 1, dead: 2, none: 3 };
  return judged.sort((a, b) => order[a.state] - order[b.state])[0];
}

function judge(s: Session, who: string, now: number): SessionNote {
  const expires = Date.parse(s.expiration);
  const left = Number.isFinite(expires) ? expires - now : null;
  const limit = big(s.spend_limit?.amount);
  const budget = share(limit - big(s.spent?.amount), limit);
  const cap = big(s.max_exec_count);
  const uses = share(cap - big(s.exec_count), cap);
  const used = Date.parse(s.last_used_at);
  // A session that was never used carries the zero time.
  const lastUsed = Number.isFinite(used) && used > 86_400_000 ? Math.max(0, now - used) : null;

  const parts: string[] = [];
  if (left !== null) parts.push(left > 0 ? `Expires in ${formatAge(left)}` : `Expired ${formatAge(-left)} ago`);
  parts.push(lastUsed === null ? "never used" : `last used ${formatAge(lastUsed)} ago`);
  const remaining = [budget !== null ? `${pct(budget)} of its fee budget` : "", uses !== null ? `${pct(uses)} of its uses` : ""].filter(Boolean);
  if (remaining.length) parts.push(`${remaining.join(" and ")} left`);
  const value = parts.join(", ");

  if (left !== null && left <= 0) {
    return { state: "dead", value, issue: `${who} session key expired ${formatAge(-left)} ago, so the chain refuses what its worker sends.` };
  }
  if (budget !== null && budget <= 0) {
    return { state: "dead", value, issue: `${who} session key has spent its fee budget, so the chain refuses what its worker sends.` };
  }
  if (uses !== null && uses <= 0) {
    return { state: "dead", value, issue: `${who} session key has used up its uses, so the chain refuses what its worker sends.` };
  }
  if (left !== null && left < EXPIRES_SOON_MS) {
    return { state: "soon", value, issue: `${who} session key expires in ${formatAge(left)}. Its operator needs to grant a new one.` };
  }
  if (budget !== null && budget < LOW_SHARE) {
    return { state: "soon", value, issue: `${who} session key has ${pct(budget)} of its fee budget left. Its operator needs to grant a new one.` };
  }
  if (uses !== null && uses < LOW_SHARE) {
    return { state: "soon", value, issue: `${who} session key has ${pct(uses)} of its uses left. Its operator needs to grant a new one.` };
  }
  return { state: "ok", value, issue: null };
}

/**
 * Add the workers' session keys to a card: one row, and an issue for each
 * key that is dead or nearly so. A card that is off or unreadable is left
 * alone, and so is one with no worker to speak of.
 */
export function withSessions(report: ServiceReport, notes: SessionNote[]): ServiceReport {
  if (notes.length === 0 || report.state === "off" || report.state === "unreachable") return report;
  const order = { dead: 0, soon: 1, ok: 2, none: 3 };
  const sorted = [...notes].sort((a, b) => order[a.state] - order[b.state]);
  const granted = notes.filter((n) => n.state !== "none");
  let fact: ServiceFact;
  if (notes.length === 1) {
    fact = { label: "Session key", value: notes[0].value };
  } else if (granted.length === 0) {
    fact = { label: "Session keys", value: "None for their messages" };
  } else {
    const usable = granted.filter((n) => n.state !== "dead").length;
    // The row describes the key in the most trouble.
    fact = { label: "Session keys", value: `${usable} of ${granted.length} usable. Nearest its end: ${lower(sorted[0].value)}` };
  }
  const issues = sorted.map((n) => n.issue).filter((i): i is string => !!i).slice(0, 4);
  return {
    ...report,
    state: issues.length && report.state === "ok" ? "degraded" : report.state,
    issues: [...report.issues, ...issues],
    facts: [...report.facts, fact],
  };
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
