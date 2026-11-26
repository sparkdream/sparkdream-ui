// How the Status page judges the IBC relayer: the off-chain process that
// carries packets (token transfers, federated posts) between this chain and
// each peer chain, and keeps this chain's light client of the peer up to date.
//
// A relayer has no record on chain, so it is judged by what it leaves there.
// Every packet it delivers comes with an update of the light client, and an
// idle relayer still refreshes the client well before its trusting period
// runs out (Hermes does at two thirds of it). So: the client's status, how
// long since its last update, the channels' state, and packets sent from here
// that nobody has acknowledged. This file only judges; lib/siteStatus.ts
// does the reading.
//
// Only this chain's side is read. Whether the relayer keeps the peer's
// client of this chain alive is not seen here.

import { formatAge, type ServiceFact, type ServiceReport } from "./serviceStatus";

export interface IbcChannel {
  /** What it carries: "federation" or "transfer". */
  port: string;
  id: string;
  /** STATE_OPEN and so on. Null when it couldn't be read. */
  state: string | null;
  /** Packets sent on it and not yet acknowledged or timed out. Null when unread. */
  pending: number | null;
}

/** This chain's link to one peer chain. */
export interface IbcLink {
  peer: string;
  channels: IbcChannel[];
  /** "Active", "Expired", "Frozen". Null when it couldn't be read. */
  clientStatus: string | null;
  /** When the light client last moved, epoch ms: the peer's block time at its latest height. */
  updatedAt: number | null;
  /** The client's trusting period in seconds. 0 when unknown. */
  trustingSeconds: number;
}

export interface IbcInput {
  /** Null when the chain has no federation module to name its peers. */
  links: IbcLink[] | null;
  now: number;
}

// A relayer that is running refreshes an idle client at about this share of
// the trusting period. Past it, nothing has relayed and nothing has refreshed.
export const REFRESH_SHARE = 2 / 3;
// Packets time out in minutes. Packets still waiting while the client hasn't
// moved for this long are not being relayed.
export const STUCK_PACKETS_MS = 30 * 60_000;
// More peers than this are summarised by the count alone.
const MAX_LISTED = 3;

const n = (v: number) => v.toLocaleString("en-US");
const OPEN = "STATE_OPEN";

function stateWord(state: string | null): string {
  return state ? state.replace(/^STATE_/, "").toLowerCase() : "unreadable";
}

export function assessIbc(input: IbcInput): ServiceReport {
  const id = "relayer";
  const report = (state: ServiceReport["state"], issues: string[], facts: ServiceFact[] = []): ServiceReport => ({
    id,
    state,
    issues,
    latency_ms: null,
    facts,
  });
  if (!input.links || input.links.length === 0) {
    return report("off", ["This chain has no IBC link to a peer chain."]);
  }

  const issues: string[] = [];
  const listed: ServiceFact[] = [];
  const many = input.links.length > 1;
  let working = 0;

  for (const link of input.links) {
    const before = issues.length;
    const label = (text: string) => (many ? `${link.peer}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);
    const age = link.updatedAt !== null ? Math.max(0, input.now - link.updatedAt) : null;
    const trustingMs = link.trustingSeconds * 1000;
    const pending = link.channels.reduce((sum, c) => sum + (c.pending ?? 0), 0);

    const closed = link.channels.filter((c) => c.state !== OPEN);
    for (const c of closed) {
      issues.push(`The ${c.port} channel to ${link.peer} (${c.id}) is ${stateWord(c.state)}, not open.`);
    }

    if (link.clientStatus === "Expired") {
      issues.push(
        `The light client of ${link.peer} has expired: nothing updated it within its trusting period, so no packet can be delivered until governance revives it.`
      );
    } else if (link.clientStatus === "Frozen") {
      issues.push(`The light client of ${link.peer} is frozen after evidence of misbehaviour, so no packet can be delivered.`);
    } else if (link.clientStatus !== "Active") {
      issues.push(`The light client of ${link.peer} couldn't be read.`);
    } else if (age !== null && pending > 0 && age > STUCK_PACKETS_MS) {
      issues.push(
        `${n(pending)} ${pending === 1 ? "packet to" : "packets to"} ${link.peer} ${pending === 1 ? "is" : "are"} waiting and the relayer has delivered nothing for ${formatAge(age)}.`
      );
    } else if (age !== null && trustingMs > 0 && age > trustingMs * REFRESH_SHARE) {
      issues.push(
        `The relayer hasn't updated the light client of ${link.peer} for ${formatAge(age)}. It expires in ${formatAge(Math.max(0, trustingMs - age))} unless it is updated.`
      );
    }
    if (issues.length === before) working++;

    if (!many) listed.push({ label: "Peer chain", value: link.peer });
    listed.push({
      label: label("Channels"),
      value: link.channels.map((c) => `${c.port} ${c.id}${c.state === OPEN ? "" : ` (${stateWord(c.state)})`}`).join(", "),
    });
    listed.push({
      label: label("Light client"),
      value: `${link.clientStatus ?? "Unreadable"}${age !== null ? `, updated ${formatAge(age)} ago` : ""}`,
    });
    if (link.clientStatus === "Active" && age !== null && trustingMs > 0) {
      listed.push({ label: label("Client expires"), value: `In ${formatAge(Math.max(0, trustingMs - age))} unless updated` });
    }
    if (link.channels.some((c) => c.pending !== null)) {
      listed.push({ label: label("Packets waiting"), value: n(pending) });
    }
  }

  const facts: ServiceFact[] = many ? [{ label: "Peer chains", value: `${n(working)} of ${n(input.links.length)} working` }] : [];
  if (input.links.length <= MAX_LISTED) facts.push(...listed);
  return report(issues.length ? "degraded" : "ok", issues.slice(0, 6), facts);
}
