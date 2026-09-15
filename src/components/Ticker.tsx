"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  getCurrentSeason,
  getLatestBlockHeight,
  listFutarchyMarkets,
  listGovProposals,
  listProposals,
  listPosts,
  listForumPosts,
  listDisputes,
  listContributions,
  listFederationPeers,
} from "@/lib/api";
import type { CurrentSeasonResponse } from "@/types/season";
import type { GovProposal } from "@/types/gov";
import { GovProposalStatus } from "@/types/gov";
import type { Proposal } from "@/types/commons";
import { ProposalStatus } from "@/types/commons";
import { MarketStatus, type Market } from "@/types/futarchy";
import type { Post } from "@/types/blog";
import type { ForumPost } from "@/types/forum";
import type { Dispute } from "@/types/name";
import type { Contribution } from "@/types/reveal";
import type { Peer } from "@/types/federation";
import { describeProposalMessages, timeRemaining } from "@/lib/utils";
import { useChainConfig } from "@/contexts/ChainConfigContext";

const FALLBACK_POLL_MS = 6000;
const SEASON_POLL_MS = 30000;
const PROPOSAL_POLL_MS = 60000;

// How many open proposals of each kind the marquee carries before it starts
// dropping the older ones. Enough to show a busy governance cycle without
// pushing everything else off the loop.
const MAX_PROPOSALS_PER_KIND = 3;
const MAX_TITLE_CHARS = 52;

// Status labels for the ticker — short, uppercase to match the marquee voice.
// "1"/"SEASON_STATUS_*" forms both appear depending on whether the LCD encodes
// the proto enum as a number or its string form.
function seasonStatusLabel(status: string): string {
  switch (status) {
    case "1":
    case "SEASON_STATUS_ACTIVE":
      return "ACTIVE";
    case "2":
    case "SEASON_STATUS_ENDING":
      return "ENDING";
    case "3":
    case "SEASON_STATUS_MAINTENANCE":
      return "MAINTENANCE";
    case "4":
    case "SEASON_STATUS_COMPLETED":
      return "COMPLETED";
    case "5":
    case "SEASON_STATUS_NOMINATION":
      return "NOMINATION";
    default:
      return "—";
  }
}

const HOT_SEASON_STATUSES = new Set([
  "1",
  "SEASON_STATUS_ACTIVE",
  "2",
  "SEASON_STATUS_ENDING",
  "5",
  "SEASON_STATUS_NOMINATION",
]);

function seasonItem(season: CurrentSeasonResponse | null): ReactNode {
  if (!season) return <>Season <b>—</b></>;
  const label = seasonStatusLabel(season.status);
  const hot = HOT_SEASON_STATUSES.has(season.status);
  return (
    <>
      Season {season.number} · <b className={hot ? "hot" : undefined}>{label}</b>
    </>
  );
}

// A proposal earns a ticker line only while it is still open: collecting
// deposits or taking votes. Everything settled is history, and history belongs
// on /governance, not on the marquee. Both the "1" and "PROPOSAL_STATUS_*"
// forms appear depending on how the LCD encodes the proto enum.
const GOV_DEPOSIT_STATUSES = new Set<string>([
  "1",
  GovProposalStatus.DEPOSIT_PERIOD,
]);
const GOV_VOTING_STATUSES = new Set<string>([
  "2",
  GovProposalStatus.VOTING_PERIOD,
]);
const OPEN_GOV_STATUSES = new Set<string>([
  ...GOV_DEPOSIT_STATUSES,
  ...GOV_VOTING_STATUSES,
]);

// x/commons has a single open state: submitted, i.e. inside its voting window.
const OPEN_COMMONS_STATUSES = new Set<string>(["1", ProposalStatus.SUBMITTED]);

function shorten(text: string): string {
  const t = text.trim();
  if (!t) return "Proposal";
  return t.length > MAX_TITLE_CHARS
    ? `${t.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
    : t;
}

function govItem(p: GovProposal, dream: string): ReactNode {
  const depositing = GOV_DEPOSIT_STATUSES.has(p.status);
  // Proposers usually set a title; fall back to the inner message types so a
  // title-less proposal still says what it would do (e.g. "Rep Param Change").
  const what = shorten(p.title || describeProposalMessages(p.messages, dream));
  const left = timeRemaining(
    depositing ? p.deposit_end_time : p.voting_end_time
  );
  return (
    <Link className="sd-ticker-link" href="/governance?view=chain-proposals">
      Chain proposal #{p.id} · {what} ·{" "}
      <b className="hot">{depositing ? "DEPOSIT" : "VOTING"}</b>
      {left ? ` · ${left}` : ""}
    </Link>
  );
}

function commonsItem(p: Proposal, dream: string): ReactNode {
  const what = shorten(describeProposalMessages(p.messages, dream));
  const left = timeRemaining(p.voting_deadline);
  return (
    <Link className="sd-ticker-link" href="/governance?view=community-proposals">
      {p.council_name} #{p.id} · {what} · <b className="hot">VOTING</b>
      {left ? ` · ${left}` : ""}
    </Link>
  );
}

// Only proposals a reader can still act on. Nothing open means no proposal
// items at all — the ticker just carries its other lines rather than padding
// itself out with settled votes or a placeholder.
function proposalItems(gov: GovProposal[], community: Proposal[], dream: string): ReactNode[] {
  return [
    ...gov
      .filter((p) => OPEN_GOV_STATUSES.has(p.status))
      .slice(0, MAX_PROPOSALS_PER_KIND)
      .map((p) => govItem(p, dream)),
    ...community
      .filter((p) => OPEN_COMMONS_STATUSES.has(p.status))
      .slice(0, MAX_PROPOSALS_PER_KIND)
      .map((p) => commonsItem(p, dream)),
  ];
}

// Live futarchy line: the largest active market plus the active-set TVL.
// Returns null when nothing is live — the marquee drops the slot entirely
// rather than padding it with a placeholder.
function futarchyItem(markets: Market[], displayDenom: string): ReactNode | null {
  const active = markets.filter((m) => m.status === MarketStatus.ACTIVE);
  if (active.length === 0) return null;
  // BigInt literals need ES2020; this project targets ES2017 — use the
  // constructor form (same pattern as WalletContext's deposit-floor math).
  let tvl = BigInt(0);
  let top = active[0];
  let topLiq = BigInt(-1);
  for (const m of active) {
    const ini = BigInt(m.initial_liquidity || "0");
    const wd = BigInt(m.liquidity_withdrawn || "0");
    const rem = ini > wd ? ini - wd : BigInt(0);
    tvl += rem;
    if (rem > topLiq) {
      topLiq = rem;
      top = m;
    }
  }
  const tvlWhole = Number(tvl) / 1_000_000;
  return (
    <Link className="sd-ticker-link" href="/futarchy">
      Futarchy · {top.symbol || `market #${top.index}`} ·{" "}
      {active.length} live ·{" "}
      <b className="hot">
        {tvlWhole.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
        {displayDenom} TVL
      </b>
    </Link>
  );
}

// Posts (blog + forum) published in the last 24h, counted from the created_at
// stamps of the newest pages. Null while the fetches haven't settled.
function postsItem(blog: Post[], forum: ForumPost[]): ReactNode {
  const cutoff = Date.now() / 1000 - 86_400;
  let n = 0;
  for (const p of blog) if (Number(p.created_at) >= cutoff) n++;
  for (const p of forum) if (Number(p.created_at) >= cutoff) n++;
  return <>Posts 24h · <b>{n.toLocaleString("en-US")}</b></>;
}

// Open x/name disputes. `ListDispute` paginates the whole collection and
// resolution only flips `active` to false (the record is kept for history),
// so the list has to be filtered or every dispute ever filed reads as open.
// The slot is dropped entirely when there are none — the marquee carries no
// placeholder history.
function disputesItem(disputes: Dispute[]): ReactNode | null {
  const open = disputes.filter((d) => d.active).length;
  if (open === 0) return null;
  return <>Name disputes · <b className="hot">{open} open</b></>;
}

// Nearest deadline across in-progress reveal tranches, expressed against the
// live height. Deadlines are block heights; ~2s/block matches this
// devnet-family chain. Only the deadline that matches the tranche's current
// status is considered (a REVEALED tranche's long-gone stake deadline is
// meaningless). Dropped when nothing is in progress.
function revealItem(
  contributions: Contribution[],
  height: string | null
): ReactNode | null {
  // The marquee's height state is locale-formatted ("118,743"); strip the
  // separators before arithmetic or Number() yields NaN.
  const now = Number(String(height ?? "").replace(/[^0-9]/g, ""));
  if (!Number.isFinite(now) || now <= 0) return null;
  let best: { label: string; blocks: number } | null = null;
  for (const c of contributions) {
    if (c.status !== "CONTRIBUTION_STATUS_IN_PROGRESS") continue;
    for (const t of c.tranches || []) {
      let kind: string | null = null;
      let raw: string | undefined;
      if (t.status === "TRANCHE_STATUS_STAKING") {
        kind = "stake close";
        raw = t.stake_deadline;
      } else if (t.status === "TRANCHE_STATUS_BACKED") {
        kind = "reveal close";
        raw = t.reveal_deadline;
      } else if (t.status === "TRANCHE_STATUS_REVEALED") {
        kind = "verify close";
        raw = t.verification_deadline;
      }
      if (!kind) continue;
      const deadline = Number(raw || 0);
      if (!Number.isFinite(deadline) || deadline <= 0) continue;
      const blocks = deadline - now;
      if (!Number.isFinite(blocks) || blocks <= 0) continue;
      if (!best || blocks < best.blocks) best = { label: `${kind} · #${c.id}/${t.id}`, blocks };
    }
  }
  if (!best) return null;
  const hours = (best.blocks * 2) / 3600;
  const when =
    hours >= 24
      ? `≈${Math.round(hours / 24)}d`
      : hours >= 1
        ? `≈${Math.round(hours)}h`
        : `≈${Math.max(1, Math.round((best.blocks * 2) / 60))}m`;
  return <>Reveal · {best.label} · <b className="hot">{when}</b></>;
}

// Active federation peers. Zero peers drops the slot.
function federationItem(peers: Peer[]): ReactNode | null {
  const active = peers.filter((p) => p.status === "PEER_STATUS_ACTIVE").length;
  if (active === 0) return null;
  return <>Federation · <b>{active}</b> peer{active === 1 ? "" : "s"} online</>;
}

function buildItems(
  height: string | null,
  season: CurrentSeasonResponse | null,
  gov: GovProposal[],
  community: Proposal[],
  futMarkets: Market[],
  posts: { blog: Post[]; forum: ForumPost[] },
  disputes: Dispute[],
  reveal: Contribution[],
  peers: Peer[],
  dream: string,
  displayDenom: string
): ReactNode[] {
  const fut = futarchyItem(futMarkets, displayDenom);
  const disp = disputesItem(disputes);
  const rev = revealItem(reveal, height);
  const fed = federationItem(peers);
  return [
    <>Block <b>{height ?? "—"}</b></>,
    seasonItem(season),
    postsItem(posts.blog, posts.forum),
    ...proposalItems(gov, community, dream),
    ...(disp ? [disp] : []),
    ...(fut ? [fut] : []),
    ...(rev ? [rev] : []),
    ...(fed ? [fed] : []),
  ];
}

function rpcToWs(rpc: string): string {
  return rpc.replace(/^http/, "ws").replace(/\/+$/, "") + "/websocket";
}

function format(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : raw;
}

export default function Ticker() {
  const { config } = useChainConfig();
  const [height, setHeight] = useState<string | null>(null);
  const [season, setSeason] = useState<CurrentSeasonResponse | null>(null);
  const [govProposals, setGovProposals] = useState<GovProposal[]>([]);
  const [communityProposals, setCommunityProposals] = useState<Proposal[]>([]);
  const [futMarkets, setFutMarkets] = useState<Market[]>([]);
  const [posts, setPosts] = useState<{ blog: Post[]; forum: ForumPost[] }>({ blog: [], forum: [] });
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [revealContribs, setRevealContribs] = useState<Contribution[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetchSeason = async () => {
      try {
        const res = await getCurrentSeason();
        if (!cancelled) setSeason(res);
      } catch {
        // Keep last value on transient errors.
      }
    };
    fetchSeason();
    const id = setInterval(fetchSeason, SEASON_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Independent settles: one endpoint being down shouldn't blank the other
    // kind of proposal, and a failed poll keeps the last good list.
    const fetchProposals = async () => {
      const [gov, community, futarchy, blog, forum, nameDisputes, reveal, fedPeers] = await Promise.allSettled([
        listGovProposals(undefined, { reverse: true, limit: "20" }),
        listProposals(undefined, { reverse: true, limit: "20" }),
        // 100 to match the futarchy page's own ceiling: the slot presents a
        // live count and a TVL total, so a smaller sample than the page it
        // links to would quietly disagree with it.
        listFutarchyMarkets({ limit: "100", reverse: true }),
        // 24h post counts: newest-first pages are enough — anything older
        // than the first out-of-window entry can't re-enter the window.
        listPosts({ limit: "100", reverse: true }),
        listForumPosts({ limit: "100", reverse: true }),
        listDisputes({ limit: "50", reverse: true }),
        listContributions({ limit: "50", reverse: true }),
        listFederationPeers({ limit: "100", reverse: true }),
      ]);
      if (cancelled) return;
      if (gov.status === "fulfilled") setGovProposals(gov.value.proposals || []);
      if (community.status === "fulfilled") {
        setCommunityProposals(community.value.proposals || []);
      }
      if (futarchy.status === "fulfilled") setFutMarkets(futarchy.value.market || []);
      if (blog.status === "fulfilled") setPosts((prev) => ({ ...prev, blog: blog.value.post || [] }));
      if (forum.status === "fulfilled") setPosts((prev) => ({ ...prev, forum: forum.value.post || [] }));
      if (nameDisputes.status === "fulfilled") setDisputes(nameDisputes.value.dispute || []);
      if (reveal.status === "fulfilled") setRevealContribs(reveal.value.contributions || []);
      if (fedPeers.status === "fulfilled") setPeers(fedPeers.value.peers || []);
    };
    fetchProposals();
    const id = setInterval(fetchProposals, PROPOSAL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const seed = async () => {
      try {
        const h = await getLatestBlockHeight();
        if (!cancelled) setHeight(format(h));
      } catch {
        // Ignore — WS or next poll will refresh.
      }
    };

    const startPollingFallback = () => {
      if (pollTimer) return;
      pollTimer = setInterval(seed, FALLBACK_POLL_MS);
    };

    const stopPollingFallback = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const connect = () => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(rpcToWs(config.rpcEndpoint));
      } catch {
        startPollingFallback();
        return;
      }
      ws = socket;

      socket.onopen = () => {
        attempt = 0;
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "subscribe",
            id: 0,
            params: { query: "tm.event='NewBlock'" },
          })
        );
      };

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const h: unknown = msg?.result?.data?.value?.block?.header?.height;
          if (typeof h === "string") {
            stopPollingFallback();
            if (!cancelled) setHeight(format(h));
          }
        } catch {
          // Ignore malformed frames.
        }
      };

      socket.onerror = () => {
        // Let onclose handle reconnect + fallback.
      };

      socket.onclose = () => {
        if (cancelled) return;
        startPollingFallback();
        attempt++;
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    seed();
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPollingFallback();
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
      }
    };
  }, [config.rpcEndpoint]);

  const items = buildItems(height, season, govProposals, communityProposals, futMarkets, posts, disputes, revealContribs, peers, config.dreamDisplayDenom, config.displayDenom);

  return (
    <div className="sd-ticker" aria-label="Onchain ticker">
      <div className="sd-ticker-track">
        {items.map((item, i) => (
          <span key={`a${i}`}>{item}</span>
        ))}
        {items.map((item, i) => (
          <span key={`b${i}`} aria-hidden="true">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
