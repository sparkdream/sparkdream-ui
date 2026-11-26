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
// The relayer pays a fee for every transaction it sends, from an account of
// its own on each chain. It registers nowhere, so its account here is taken
// from the last transaction that updated the light client: whoever signed
// that is the relayer. The card shows what that account holds against the
// fee it last paid, and says when it is running out, since a relayer with
// nothing to pay with stops as surely as one that has crashed.
//
// The federation module's record of a peer names the channels to use, and it
// can go stale: when a peer chain is reset and a new connection is made, the
// record still names the old channels. That shows from this chain alone, as
// open channels to the same chain on a later light client.
//
// The relayer has a second account, on the peer chain, which pays for what it
// delivers there. It is read the same way from the peer chain's own API,
// where the site knows it (PEER_CHAINS), by the peer's light client of this
// chain. The same API gives the peer chain's height, which catches a peer
// that was reset: a network reset keeps the chain id and starts a new chain,
// and the light client here then follows one that no longer exists. And it
// gives the other half of the link, the peer's light client of this chain,
// which the relayer must keep updated just the same: it is judged by the
// same rules as the client here, and it catches a reset of this chain the
// way the client here catches a reset of the peer.

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
  /** The account that last updated the light client. Null or absent when it couldn't be found. */
  relayer?: IbcRelayer | null;
  /**
   * The same on the peer chain: the account that last updated its light
   * client of this chain, read from the peer's own API. Null or absent when
   * that API isn't known (PEER_CHAINS) or the account couldn't be found.
   */
  peerRelayer?: IbcRelayer | null;
  /**
   * The other half of the link: the peer chain's light client of this chain,
   * read from the peer's own API. The relayer has to keep it updated too, or
   * nothing can be delivered there. Null or absent when that API isn't known
   * (PEER_CHAINS) or the connection doesn't name the client.
   */
  peerClient?: IbcPeerClient | null;
  /**
   * The highest block of the peer this chain's light client has seen, and
   * the peer chain's height now, from its own API. A chain can't be behind
   * what was already seen of it: if it is, it was reset (same chain id, a
   * new chain) and the link no longer leads anywhere. The peer's height is
   * given only when its node is at the chain's tip (a fresh latest block),
   * not while it is still syncing. Null or absent when unread.
   */
  clientHeight?: number | null;
  peerHeight?: number | null;
  /**
   * Open channels to the same peer chain on a light client created after the
   * one this link's channels use. The federation's record of a peer names
   * its channels, and nothing updates it when a new connection is made, so
   * after a peer is reset and reconnected the record goes on naming the old
   * ones. Empty or absent when there are none.
   */
  newerChannels?: { port: string; id: string }[];
  /** The peer chain's fee denomination and its display name, from the peer's registered identity. */
  peerFee?: { denom: string; symbol: string };
}

export interface IbcPeerClient {
  /** "Active", "Expired", "Frozen"; "Unknown" when the peer has no such client. Null when it couldn't be read. */
  status: string | null;
  /** When it last moved, epoch ms: this chain's block time at its latest height. */
  updatedAt: number | null;
  /** Its trusting period in seconds. 0 when unknown. */
  trustingSeconds: number;
  /** The highest block of this chain it has seen. Null or absent when unread. */
  height?: number | null;
}

export interface IbcRelayer {
  /** The account that signed the update. */
  address: string;
  /** The denomination its last update paid its fee in. */
  denom: string;
  /**
   * What is held in that denomination by whoever paid the fee: the signer,
   * or the account that pays on its behalf when the fee names one. In the
   * denomination's base units. Null when unread.
   */
  balance: string | null;
  /** The fee of its last client update, micro-units. Null when unknown. */
  lastFee: string | null;
}

// How far behind a light client's view a chain must be before it is called
// reset. A height is only taken from a node whose latest block is at most a
// couple of minutes old, and no chain here makes this many blocks in that
// time, so a node that merely lags another can't fall this far short.
export const RESET_MARGIN_BLOCKS = 1_000;

// A relayer with fewer transactions than this left to pay for is reported
// while it still works: an update of the client and a few packets use that
// many in a busy hour.
export const LOW_FUNDS_TXS = 20;

/** A micro-denominated amount with up to two decimals ("9.85"). */
function units(micro: string): string {
  const v = BigInt(micro);
  const whole = v / BigInt(1_000_000);
  const cents = ((v % BigInt(1_000_000)) / BigInt(10_000)).toString().padStart(2, "0").replace(/0+$/, "");
  return cents ? `${whole.toLocaleString("en-US")}.${cents}` : whole.toLocaleString("en-US");
}

export interface IbcInput {
  /** Null when the chain has no federation module to name its peers. */
  links: IbcLink[] | null;
  /**
   * This chain's height now, given only when its node is at the tip. A peer's
   * light client that has seen a block well beyond it followed an earlier
   * chain under this chain id: this chain was reset since. Null or absent
   * when unread.
   */
  thisHeight?: number | null;
  /**
   * The chain's own fee denomination and its display name ("uspark...",
   * "SPARK"), which is a millionth of the display unit. A relayer paying in
   * anything else has its amounts shown as they are, in base units.
   */
  fee?: { denom: string; symbol: string };
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

    // Seen from this chain alone: a later connection to the same chain is in
    // use beside the one the peer's record names.
    const newer = link.newerChannels ?? [];
    if (newer.length > 0) {
      const list = (cs: { port: string; id: string }[]) => cs.map((c) => `${c.port} ${c.id}`).join(", ");
      issues.push(
        `The record of ${link.peer} names ${list(link.channels)}, but newer open channels to the same chain exist (${list(newer)}). The record most likely still points at a connection that was replaced, and needs updating to the new channels.`
      );
    }
    // The peer's API may be a node a few blocks behind the one the relayer
    // reads, so a small shortfall proves nothing. The caller gives a height
    // only from a node at the chain's tip, where a large one can't happen.
    const reset =
      link.clientHeight != null &&
      link.peerHeight != null &&
      link.peerHeight > 0 &&
      link.peerHeight + RESET_MARGIN_BLOCKS < link.clientHeight;
    if (reset) {
      issues.push(
        `${link.peer} is at block ${n(link.peerHeight!)}, behind block ${n(link.clientHeight!)} that this chain's light client has already seen of it. The peer chain was reset since, so this link carries nothing and can't be revived: a new connection is needed.`
      );
    }
    if (reset) {
      // The client's own state is beside the point once its chain is gone.
    } else if (link.clientStatus === "Expired") {
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
    // The same from the other side: the peer's light client has seen more of
    // this chain than there now is, so this chain is the one that was reset.
    const theirSeen = link.peerClient?.height ?? null;
    const resetHere =
      !reset && theirSeen !== null && input.thisHeight != null && input.thisHeight > 0 && input.thisHeight + RESET_MARGIN_BLOCKS < theirSeen;
    if (resetHere) {
      issues.push(
        `This chain is at block ${n(input.thisHeight!)}, behind block ${n(theirSeen!)} that ${link.peer}'s light client has already seen of it. This chain was reset since, so this link carries nothing and can't be revived: a new connection is needed.`
      );
    }
    // The peer's light client of this chain, judged by the same rules. After
    // a reset of either chain its state is explained by the reset.
    const theirs = reset || resetHere ? null : link.peerClient;
    const theirAge = theirs?.updatedAt != null ? Math.max(0, input.now - theirs.updatedAt) : null;
    const theirTrustingMs = (theirs?.trustingSeconds ?? 0) * 1000;
    if (theirs?.status === "Expired") {
      issues.push(
        `${link.peer}'s light client of this chain has expired: nothing updated it within its trusting period, so no packet can be delivered there until that chain's governance revives it.`
      );
    } else if (theirs?.status === "Frozen") {
      issues.push(`${link.peer}'s light client of this chain is frozen after evidence of misbehaviour, so no packet can be delivered there.`);
    } else if (theirs?.status === "Active" && theirAge !== null && theirTrustingMs > 0 && theirAge > theirTrustingMs * REFRESH_SHARE) {
      issues.push(
        `The relayer hasn't updated ${link.peer}'s light client of this chain for ${formatAge(theirAge)}. It expires in ${formatAge(Math.max(0, theirTrustingMs - theirAge))} unless it is updated.`
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
    if (newer.length > 0) {
      listed.push({ label: label("Newer channels"), value: newer.map((c) => `${c.port} ${c.id}`).join(", ") });
    }
    if (link.peerHeight != null && link.peerHeight > 0) {
      listed.push({
        label: label("Peer chain height"),
        value: link.clientHeight != null ? `${n(link.peerHeight)}, the light client has seen ${n(link.clientHeight)}` : n(link.peerHeight),
      });
    }
    if (link.clientStatus === "Active" && age !== null && trustingMs > 0) {
      listed.push({ label: label("Client expires"), value: `In ${formatAge(Math.max(0, trustingMs - age))} unless updated` });
    }
    if (theirSeen !== null && input.thisHeight != null && input.thisHeight > 0) {
      listed.push({
        label: label("This chain's height"),
        value: `${n(input.thisHeight)}, the peer's light client has seen ${n(theirSeen)}`,
      });
    }
    if (link.peerClient) {
      const c = link.peerClient;
      const state = c.status === "Unknown" ? "Not found on the peer" : (c.status ?? "Unreadable");
      const seen = c.updatedAt != null ? Math.max(0, input.now - c.updatedAt) : null;
      listed.push({
        label: label("Peer's light client"),
        value: `${state}${c.status !== "Unknown" && seen !== null ? `, updated ${formatAge(seen)} ago` : ""}`,
      });
      if (c.status === "Active" && seen !== null && c.trustingSeconds > 0) {
        listed.push({
          label: label("Peer's client expires"),
          value: `In ${formatAge(Math.max(0, c.trustingSeconds * 1000 - seen))} unless updated`,
        });
      }
    }
    // The relayer's account on each side: here, and on the peer chain where
    // that chain's API is known. `where` reads "for Devnet" / "on Devnet".
    const account = (
      r: IbcRelayer | null | undefined,
      fee: IbcInput["fee"],
      names: { who: string; funds: string },
      where: string,
      stops: string
    ) => {
      if (!r) return;
      listed.push({ label: label(names.who), value: r.address });
      if (r.balance === null || !/^\d+$/.test(r.balance)) return;
      const txs = r.lastFee && /^[1-9]\d*$/.test(r.lastFee) ? Number(BigInt(r.balance) / BigInt(r.lastFee)) : null;
      const native = fee && r.denom === fee.denom;
      const held = native ? `${units(r.balance)} ${fee!.symbol}` : `${n(Number(r.balance))} ${r.denom}`;
      let enough = "";
      if (txs !== null) enough = txs >= 10_000 ? ", over 10,000 more transactions" : `, about ${n(txs)} more ${txs === 1 ? "transaction" : "transactions"}`;
      listed.push({ label: label(names.funds), value: `${held}${enough}` });
      let issue = "";
      if (/^0+$/.test(r.balance) || txs === 0) {
        issue = `The relayer's account ${where} can't pay for a transaction, so ${stops} until it is funded.`;
      } else if (txs !== null && txs < LOW_FUNDS_TXS) {
        issue = `The relayer's account ${where} has fees for about ${n(txs)} more ${txs === 1 ? "transaction" : "transactions"}. It needs funding.`;
      }
      if (issue) {
        issues.push(issue);
        // The first problem of a link that was counted as working takes it out.
        if (issues.length === before + 1) working--;
      }
    };
    account(link.relayer, input.fee, { who: "Relayer", funds: "Relayer funds" }, `for ${link.peer}`, "nothing is relayed");
    account(
      link.peerRelayer,
      link.peerFee,
      { who: "Relayer on the peer", funds: "Its funds there" },
      `on ${link.peer}`,
      "nothing is delivered there"
    );
    if (link.channels.some((c) => c.pending !== null)) {
      listed.push({ label: label("Packets waiting"), value: n(pending) });
    }
  }

  const facts: ServiceFact[] = many ? [{ label: "Peer chains", value: `${n(working)} of ${n(input.links.length)} working` }] : [];
  if (input.links.length <= MAX_LISTED) facts.push(...listed);
  return report(issues.length ? "degraded" : "ok", issues.slice(0, 6), facts);
}
