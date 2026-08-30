"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  getCurrentSeason,
  getLatestBlockHeight,
  listGovProposals,
  listProposals,
} from "@/lib/api";
import type { CurrentSeasonResponse } from "@/types/season";
import type { GovProposal } from "@/types/gov";
import { GovProposalStatus } from "@/types/gov";
import type { Proposal } from "@/types/commons";
import { ProposalStatus } from "@/types/commons";
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

function govItem(p: GovProposal): ReactNode {
  const depositing = GOV_DEPOSIT_STATUSES.has(p.status);
  // Proposers usually set a title; fall back to the inner message types so a
  // title-less proposal still says what it would do (e.g. "Rep Param Change").
  const what = shorten(p.title || describeProposalMessages(p.messages));
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

function commonsItem(p: Proposal): ReactNode {
  const what = shorten(describeProposalMessages(p.messages));
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
function proposalItems(gov: GovProposal[], community: Proposal[]): ReactNode[] {
  return [
    ...gov
      .filter((p) => OPEN_GOV_STATUSES.has(p.status))
      .slice(0, MAX_PROPOSALS_PER_KIND)
      .map(govItem),
    ...community
      .filter((p) => OPEN_COMMONS_STATUSES.has(p.status))
      .slice(0, MAX_PROPOSALS_PER_KIND)
      .map(commonsItem),
  ];
}

function buildItems(
  height: string | null,
  season: CurrentSeasonResponse | null,
  gov: GovProposal[],
  community: Proposal[]
): ReactNode[] {
  return [
    <>Block <b>{height ?? "—"}</b></>,
    seasonItem(season),
    <>14 posts in last 24h</>,
    ...proposalItems(gov, community),
    <>Naming dispute #3 · resolved</>,
    <>12 active session keys</>,
    <>Futarchy market: treasury allocation · $2,840 TVL</>,
    <>Reveal round closes in <b className="hot">3h 42m</b></>,
    <>Federation · 4 peer chains online</>,
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
      const [gov, community] = await Promise.allSettled([
        listGovProposals(undefined, { reverse: true, limit: "20" }),
        listProposals(undefined, { reverse: true, limit: "20" }),
      ]);
      if (cancelled) return;
      if (gov.status === "fulfilled") setGovProposals(gov.value.proposals || []);
      if (community.status === "fulfilled") {
        setCommunityProposals(community.value.proposals || []);
      }
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

  const items = buildItems(height, season, govProposals, communityProposals);

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
