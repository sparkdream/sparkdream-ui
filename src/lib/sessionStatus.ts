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
//
// The chain removes a session in the block it expires, so an expired key is
// not there to be read: it looks like no session at all. A key that spent
// its budget or its uses stays until its expiry and is read as dead. To
// report an expiry as one, the caller remembers the expiry of each key it
// has seen (rememberExpiry); a key that is gone at or after that time has
// expired. That memory lives in the server process and starts empty, so
// the warning ahead of the expiry is the one to rely on.

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

/** The other messages a worker sends with the same key. */
export interface AlsoSends {
  /** Messages its work can't be finished without: a key lacking one is a fault. */
  required?: string[];
  /** Messages it can run without (a check-in the operator may have turned off): only noted. */
  optional?: string[];
}

const shortName = (typeUrl: string) => typeUrl.slice(typeUrl.lastIndexOf(".") + 1);

/**
 * Judge the session `granter` gave its worker for `msgType`. `who` names the
 * worker in an issue ("The archiver's", "A scanner's"). A worker holds one
 * key, so that one session also has to cover whatever else it sends (`also`).
 * The chain doesn't say which of an operator's sessions the worker holds, so
 * with several covering the message the most serviceable is judged: usable
 * before dead, then the one covering most of what the worker sends, then the
 * one that lasts longest. An old key beside its replacement is thus ignored.
 */
export function assessSession(
  sessions: Session[],
  msgType: string,
  who: string,
  now: number,
  also: AlsoSends = {}
): SessionNote {
  const covering = sessions.filter((s) => (s.allowed_msg_types || []).includes(msgType));
  if (covering.length === 0) {
    return { state: "none", value: "None on chain for its messages", issue: null };
  }
  const lacks = (s: Session, types: string[] = []) => types.filter((t) => !(s.allowed_msg_types || []).includes(t));
  const expiry = (s: Session) => Date.parse(s.expiration) || 0;
  const order = { ok: 0, soon: 1, dead: 2, none: 3 };
  const best = covering
    .map((s) => ({ session: s, note: judge(s, who, now) }))
    .sort(
      (a, b) =>
        order[a.note.state] - order[b.note.state] ||
        lacks(a.session, also.required).length - lacks(b.session, also.required).length ||
        lacks(a.session, also.optional).length - lacks(b.session, also.optional).length ||
        expiry(b.session) - expiry(a.session)
    )[0];
  const missing = lacks(best.session, also.required).map(shortName);
  const unused = lacks(best.session, also.optional).map(shortName);
  let { state, value, issue } = best.note;
  if (unused.length) value += `, doesn't cover ${unused.join(", ")}`;
  // A key that is already dead says so; a live one that can't finish the work is the news.
  if (missing.length && state !== "dead") {
    state = "soon";
    issue = `${who} session key doesn't cover ${missing.join(", ")}, so the chain refuses ${missing.length === 1 ? "that message" : "those messages"} from its worker.`;
    value += `, doesn't cover ${missing.join(", ")}`;
  }
  return { state, value, issue };
}

function judge(s: Session, who: string, now: number): SessionNote {
  const expires = Date.parse(s.expiration);
  const left = Number.isFinite(expires) ? expires - now : null;
  const limit = big(s.spend_limit?.amount);
  const budget = share(limit - big(s.spent?.amount), limit);
  const cap = big(s.max_exec_count);
  const uses = share(cap - big(s.exec_count), cap);
  const used = Date.parse(s.last_used_at);
  // A session that was never used carries the time it was created, or the
  // zero time: its count of uses is what says so.
  const everUsed = big(s.exec_count) > BigInt(0);
  const lastUsed = everUsed && Number.isFinite(used) && used > 86_400_000 ? Math.max(0, now - used) : null;

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

/** What is remembered of a worker's key between checks: when it expires, epoch ms. */
export type ExpiryMemory = Map<string, number>;

/**
 * Turn "no session" into "expired" when the key was seen before and its
 * expiry has passed, and note the expiry of a key that is there. `key`
 * identifies the worker (operator and message). A key that vanished before
 * its expiry was revoked or replaced by the operator's own key: forgotten.
 */
export function rememberExpiry(
  memory: ExpiryMemory,
  key: string,
  sessions: Session[],
  msgType: string,
  note: SessionNote,
  who: string,
  now: number
): SessionNote {
  if (note.state !== "none") {
    const expiries = sessions
      .filter((s) => (s.allowed_msg_types || []).includes(msgType))
      .map((s) => Date.parse(s.expiration))
      .filter(Number.isFinite);
    if (expiries.length) memory.set(key, Math.max(...expiries));
    return note;
  }
  const expiredAt = memory.get(key);
  if (expiredAt === undefined) return note;
  if (expiredAt > now) {
    memory.delete(key);
    return note;
  }
  const ago = formatAge(now - expiredAt);
  return {
    state: "dead",
    value: `Expired ${ago} ago`,
    issue: `${who} session key expired ${ago} ago, so the chain refuses what its worker sends.`,
  };
}

/**
 * Add the workers' session keys to a card: one row under `label`, and an
 * issue for each key that is dead or nearly so. A card that is off or unreadable is left
 * alone, and so is one with no worker to speak of.
 */
export function withSessions(report: ServiceReport, notes: SessionNote[], label = "Session key"): ServiceReport {
  if (notes.length === 0 || report.state === "off" || report.state === "unreachable") return report;
  const order = { dead: 0, soon: 1, ok: 2, none: 3 };
  const sorted = [...notes].sort((a, b) => order[a.state] - order[b.state]);
  const granted = notes.filter((n) => n.state !== "none");
  let fact: ServiceFact;
  if (notes.length === 1) {
    fact = { label, value: notes[0].value };
  } else if (granted.length === 0) {
    fact = { label: `${label}s`, value: "None on chain for their messages" };
  } else {
    const usable = granted.filter((n) => n.state !== "dead").length;
    // The row describes the key in the most trouble.
    fact = { label: `${label}s`, value: `${usable} of ${granted.length} usable. Nearest its end: ${lower(sorted[0].value)}` };
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
