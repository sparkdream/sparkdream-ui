"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  checkChain,
  formatAge,
  worstState,
  type ChainStatus,
  type ProbeResult,
  type ServiceState,
} from "@/lib/serviceStatus";
import ServiceCard, { STATE_STYLE, type CardRow } from "./ServiceCard";

// Often enough that the page tracks an outage as it happens, rarely enough
// that leaving it open costs the node four small requests a quarter minute.
const POLL_MS = 15_000;

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
  const [checking, setChecking] = useState(false);
  const running = useRef(false);

  const run = useCallback(async () => {
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
  }, [config.rpcEndpoint, config.chainId]);

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

  const overall = status ? worstState(status.lcd, status.rpc) : null;

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
          <button type="button" className="sd-btn-ghost" onClick={() => void run()} disabled={checking}>
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
          state={status?.rpc.state ?? null}
          issues={status?.rpc.issues ?? []}
          rows={chainRows(status?.rpc ?? null, config.chainId)}
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        These checks cover the public node this app reads from and sends transactions through,
        whichever sentry is serving at the moment. The validators behind it have their own card below.
        These checks run from your browser, so a problem with your own connection shows up here too.
        The REST API is checked through this site, the way the app reads it.
      </p>
    </section>
  );
}
