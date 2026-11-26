"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import type { ServiceReport, SiteStatusResponse } from "@/lib/serviceStatus";
import ServiceCard, { type CardRow } from "./ServiceCard";

// The server refreshes its checks every 15 seconds; asking more often than
// that would only return the same answer.
const POLL_MS = 30_000;

// Reports arrive by id. An id this build doesn't know (a newer server) is
// left out, never shown as a bare key.
const COPY: Record<string, { name: string; purpose: string }> = {
  explorer: { name: "Block explorer", purpose: "Where transaction, block and account links open." },
  scanners: { name: "Content scanners", purpose: "Check images and flagged posts before they are shown." },
  images: { name: "Image uploads", purpose: "Storing the pictures members add to dreams and profiles." },
  arweave: { name: "Permanent storage gateway", purpose: "Reading permanent copies and ar:// images." },
  relayer: { name: "IBC relayer", purpose: "Carrying transfers and federated posts between this chain and its peer chains." },
  bridges: { name: "Federation bridges", purpose: "Bringing posts in from other networks, such as Mastodon." },
  storage: { name: "Permanent copies", purpose: "Copying scanned images to Arweave when a member asks." },
  mirror: { name: "Archive mirror", purpose: "The copy of every block kept outside the deployment, from which the permanent archive is made." },
  archiver: { name: "Permanent block archive", purpose: "The copy of this chain's block history kept on Arweave." },
  archive: { name: "Archive snapshots", purpose: "The list of read-only snapshots on the Archive page." },
};
const ORDER = Object.keys(COPY);

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function rows(report: ServiceReport): CardRow[] {
  const out: CardRow[] = report.facts.map((f) => ({ label: f.label, value: f.value }));
  if (report.latency_ms !== null) out.push({ label: "Response time", value: `${report.latency_ms} ms` });
  return out;
}

/** The Other services section of the Status page, read from /api/status. */
export default function SiteStatusSection() {
  const { config } = useChainConfig();
  const [data, setData] = useState<SiteStatusResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setChecking(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as SiteStatusResponse);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      running.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
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
  }, [run]);

  const byId = new Map((data?.services ?? []).map((s) => [s.id, s]));
  // Before the first answer, show the services every site has so the page
  // doesn't jump; afterwards, exactly the ones the server reported.
  const ids = data ? ORDER.filter((id) => byId.has(id)) : ORDER.filter((id) => id !== "archive" && id !== "mirror");

  return (
    <section aria-labelledby="site-status" className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="site-status" className="text-lg font-semibold text-white">
          Other services
        </h2>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span aria-live="polite">
            {data ? `Checked ${new Date(data.generated_at).toLocaleTimeString()}` : failed ? "" : "Checking"}
          </span>
          <button type="button" className="sd-btn-ghost" onClick={() => void run()} disabled={checking}>
            {checking ? "Checking" : "Check again"}
          </button>
        </div>
      </div>

      {failed && (
        <p role="status" className="mb-4 text-sm" style={{ color: "var(--rose)" }}>
          These checks can&apos;t be loaded from this site right now.
          {data ? " The results below are the last ones received." : ""}
        </p>
      )}

      {(data || !failed) && (
        <div className="grid gap-4">
          {ids.map((id) => {
            const report = byId.get(id);
            return (
              <ServiceCard
                key={id}
                name={COPY[id].name}
                purpose={COPY[id].purpose}
                endpoint={id === "explorer" ? host(config.explorerUrl) : undefined}
                state={report?.state ?? null}
                issues={report?.issues ?? []}
                rows={report ? rows(report) : []}
              />
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        These are checked from this site&apos;s server, not your browser, and refreshed about every
        15 seconds. For image uploads and the explorer, working means the service answered, not that
        every feature behind it was exercised. For the permanent block archive, working means the
        archiver&apos;s latest checkpoint is recent and the range it names is on Arweave under the
        archiver&apos;s wallet, not that the whole copy was downloaded and verified. For permanent
        copies, working means an approved, funded storage operator and enough approved scanners are
        registered on chain, and that the operator&apos;s worker has checked in there recently. For a
        worker that has never checked in, the card shows when it last claimed or copied something
        and flags a request nobody has touched for a long while, which can also mean a file it
        can&apos;t fetch. For federation
        bridges, working means each bridge&apos;s operator and peer are active, the peer&apos;s server answers and the bridge
        brought a post in within the chain&apos;s inactivity limit, not that its daemon is running. The IBC relayer
        has no record on chain, so it is judged by what it leaves there: the light client it must
        keep updated, the channels, and packets still waiting. Only this chain&apos;s side is read. The
        archive mirror is shown as it last reported itself: the results of its hourly sync and its
        weekly rebuild check.
      </p>
    </section>
  );
}
