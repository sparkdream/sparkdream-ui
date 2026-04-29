"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getCurrentSeason, getLatestBlockHeight } from "@/lib/api";
import type { CurrentSeasonResponse } from "@/types/season";
import { useChainConfig } from "@/contexts/ChainConfigContext";

const FALLBACK_POLL_MS = 6000;
const SEASON_POLL_MS = 30000;

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

function buildItems(
  height: string | null,
  season: CurrentSeasonResponse | null
): ReactNode[] {
  return [
    <>Block <b>{height ?? "—"}</b></>,
    seasonItem(season),
    <>14 posts in last 24h</>,
    <>Proposal #17 · mint curve · <b className="hot">VOTING</b></>,
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

  const items = buildItems(height, season);

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
