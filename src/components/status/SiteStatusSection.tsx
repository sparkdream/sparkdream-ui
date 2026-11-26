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
  validators: { name: "Validators", purpose: "The nodes that make the chain's blocks, behind the node this app reads." },
  governance: { name: "Chain governance", purpose: "Whether a vote, a passed decision or an upgrade needs someone to act." },
  certificates: { name: "Certificates", purpose: "The TLS certificates of the addresses this app is reached and reads through." },
  explorer: { name: "Block explorer", purpose: "Where transaction, block and account links open." },
  scanners: { name: "Content scanners", purpose: "Check images and flagged posts before they are shown." },
  images: { name: "Image uploads", purpose: "Storing the pictures members add to dreams and profiles." },
  arweave: { name: "Permanent storage gateway", purpose: "Reading permanent copies and ar:// images." },
  relayer: { name: "IBC relayer", purpose: "Carrying transfers and federated posts between this chain and its peer chains." },
  shield: { name: "Anonymous actions", purpose: "Posting, replying and reacting without revealing who did it." },
  bridges: { name: "Federation bridges", purpose: "Bringing posts in from other networks, such as Mastodon, and verifying them." },
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

/** The Network and services section of the Status page, read from /api/status. */
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
      const res = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
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
          Network and services
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
        15 seconds. Working means the check passed, not that every feature behind a service was
        exercised. A worker that runs on someone&apos;s own machine (a scanner, a bridge, a relayer,
        a storage or archive worker) is judged by what it leaves on the chain or publishes, so a
        card can lag behind a worker that has only just stopped. A session key is what an operator
        grants its worker; a card that shows none may belong to a worker that signs with its
        operator&apos;s own key, which is not a fault.
      </p>
    </section>
  );
}
