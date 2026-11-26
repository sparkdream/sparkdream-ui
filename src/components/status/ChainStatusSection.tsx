"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  checkChain,
  describeLive,
  formatAge,
  probeLive,
  worstState,
  type ChainStatus,
  type LiveResult,
  type ProbeResult,
  type ServiceState,
} from "@/lib/serviceStatus";
import ServiceCard, { STATE_STYLE, type CardRow } from "./ServiceCard";

// Often enough that the page tracks an outage as it happens, rarely enough
// that leaving it open costs the node four small requests a quarter minute.
const POLL_MS = 15_000;
// The live connection is checked less often: each check holds a websocket
// open until a block arrives, which is more than a status page should ask of
// the node four times a minute.
const LIVE_EVERY_MS = 60_000;

const SUMMARY: Record<Exclude<ServiceState, "off">, string> = {
  ok: "The chain node is working",
  degraded: "The chain node is answering, with problems",
  unreachable: "The chain node can't be reached",
};

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function version(v: string): string {
  return v.startsWith("v") ? v : `v${v}`;
}

function chainRows(result: ProbeResult | null, expectedChainId: string): CardRow[] {
  const facts = result?.facts;
  if (!result || !facts) return [];
  const rows: CardRow[] = [
    {
      label: "Chain ID",
      value: (
        <span style={facts.chainId !== expectedChainId ? { color: "var(--amber)" } : undefined}>
          {facts.chainId || "unknown"}
        </span>
      ),
    },
  ];
  if (facts.moniker) rows.push({ label: "Node", value: facts.moniker });
  if (facts.appVersion) rows.push({ label: "Chain version", value: version(facts.appVersion) });
  if (facts.cometVersion) rows.push({ label: "CometBFT", value: version(facts.cometVersion) });
  rows.push({
    label: "Latest block",
    value: (
      <>
        {/^\d+$/.test(facts.height) ? Number(facts.height).toLocaleString("en-US") : "unknown"}
        {result.blockAgeMs !== null && (
          <span className="text-zinc-400">, {formatAge(result.blockAgeMs)} ago</span>
        )}
      </>
    ),
  });
  rows.push({ label: "Syncing", value: facts.syncing ? "Yes" : "No" });
  if (result.latencyMs !== null) rows.push({ label: "Response time", value: `${result.latencyMs} ms` });
  return rows;
}

/** The Chain section of the Status page: the LCD and the RPC this build uses. */
export default function ChainStatusSection() {
  const { config, ready } = useChainConfig();
  const [status, setStatus] = useState<ChainStatus | null>(null);
  // The RPC's websocket, checked beside the rest: it waits for a block, which the other checks shouldn't.
  const [live, setLive] = useState<LiveResult | null>(null);
  const liveRunning = useRef(false);
  const liveCheckedAt = useRef(0);
  const liveAbort = useRef<AbortController | null>(null);
  const [checking, setChecking] = useState(false);
  const running = useRef(false);

  // `force` is the "Check again" button; the timer's own rounds wait out LIVE_EVERY_MS.
  const runLive = useCallback(
    async (force: boolean) => {
      if (liveRunning.current) return;
      if (!force && Date.now() - liveCheckedAt.current < LIVE_EVERY_MS) return;
      liveRunning.current = true;
      liveCheckedAt.current = Date.now();
      const abort = new AbortController();
      liveAbort.current = abort;
      try {
        const result = await probeLive(config.rpcEndpoint, { signal: abort.signal });
        // A check cut short by leaving the page, or by a change of endpoint, learned nothing.
        if (!abort.signal.aborted) setLive(result);
      } finally {
        // Only the newest check may say that none is running: one that was cut
        // short finishes later, when its successor may already be under way.
        if (liveAbort.current === abort) liveRunning.current = false;
      }
    },
    [config.rpcEndpoint]
  );

  // A different endpoint is a different connection: forget the old answer and
  // stop a check still waiting on it. Leaving the page stops it too.
  useEffect(() => {
    setLive(null);
    liveCheckedAt.current = 0;
    return () => {
      liveAbort.current?.abort();
      liveAbort.current = null;
      liveRunning.current = false;
    };
  }, [config.rpcEndpoint]);

  const run = useCallback(async (force = false) => {
    void runLive(force);
    if (running.current) return;
    running.current = true;
    setChecking(true);
    try {
      setStatus(
        await checkChain({
          lcdBase: "/api/lcd",
          rpcEndpoint: config.rpcEndpoint,
          chainId: config.chainId,
        })
      );
    } finally {
      running.current = false;
      setChecking(false);
    }
  }, [config.rpcEndpoint, config.chainId, runLive]);

  // Wait for the runtime config so the check hits the endpoints the app really
  // uses, then repeat while the tab is visible and once more when it returns.
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      if (document.visibilityState === "visible") void run();
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ready, run]);

  // The live connection is part of the RPC's card. It is only judged when the
  // RPC itself answers: an unreachable node has already said why.
  const liveNote = describeLive(live);
  const rpcAnswers = !!status && status.rpc.state !== "unreachable";
  const rpc = status
    ? {
        ...status.rpc,
        state: rpcAnswers && liveNote.issue && status.rpc.state === "ok" ? ("degraded" as const) : status.rpc.state,
        issues: rpcAnswers && liveNote.issue ? [...status.rpc.issues, liveNote.issue] : status.rpc.issues,
      }
    : null;
  const overall = status && rpc ? worstState(status.lcd, rpc) : null;

  return (
    <section aria-labelledby="chain-status">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 id="chain-status" className="text-lg font-semibold text-white">
            Chain
          </h2>
          <span className="font-mono text-xs text-zinc-500">{config.chainId}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span aria-live="polite">
            {status
              ? `Checked ${new Date(status.checkedAt).toLocaleTimeString()}`
              : "Checking"}
          </span>
          <button type="button" className="sd-btn-ghost" onClick={() => void run(true)} disabled={checking}>
            {checking ? "Checking" : "Check again"}
          </button>
        </div>
      </div>

      {overall && overall !== "off" && (
        <p role="status" className="mb-4 text-sm" style={{ color: STATE_STYLE[overall].color }}>
          {SUMMARY[overall]}
        </p>
      )}

      <div className="grid gap-4">
        <ServiceCard
          name="REST API"
          purpose="Every read in the app: dreams, votes, balances, names."
          endpoint={host(config.lcdEndpoint)}
          state={status?.lcd.state ?? null}
          issues={status?.lcd.issues ?? []}
          rows={chainRows(status?.lcd ?? null, config.chainId)}
        />
        <ServiceCard
          name="RPC"
          purpose="Sending transactions and the live activity ticker."
          endpoint={host(config.rpcEndpoint)}
          state={rpc?.state ?? null}
          issues={rpc?.issues ?? []}
          rows={
            rpcAnswers
              ? [...chainRows(status?.rpc ?? null, config.chainId), { label: "Live updates", value: liveNote.value }]
              : chainRows(status?.rpc ?? null, config.chainId)
          }
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        These checks cover the public node this app reads from and sends transactions through,
        whichever sentry is serving at the moment. The validators behind it have their own card below.
        These checks run from your browser, so a problem with your own connection shows up here too.
        The REST API is checked through this site, the way the app reads it. The live
        connection is the one the activity ticker uses, and is checked once a minute: each
        check waits for a block to arrive.
      </p>
    </section>
  );
}
