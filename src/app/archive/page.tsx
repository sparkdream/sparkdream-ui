"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadManifest, type ManifestEntry } from "@/lib/archive";
import { useChainConfig } from "@/contexts/ChainConfigContext";

export default function ArchiveIndexPage() {
  const [snapshots, setSnapshots] = useState<ManifestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { config, ready: configReady } = useChainConfig();

  useEffect(() => {
    if (!configReady) return;
    loadManifest(config.remoteManifestUrl).then((m) => {
      setSnapshots(m.snapshots);
      setLoading(false);
    });
  }, [configReady, config.remoteManifestUrl]);

  const byChain = snapshots.reduce<Record<string, ManifestEntry[]>>((acc, s) => {
    (acc[s.chainId] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Archive</h1>
        <p className="text-sm opacity-70">
          Read-only snapshots of past testnets. No transactions are possible while
          viewing an archive — content is reconstructed from a recorded LCD dump.
        </p>
      </header>

      {loading && <p className="opacity-70">Loading…</p>}
      {!loading && snapshots.length === 0 && (
        <p className="opacity-70">
          No snapshots yet. Capture one with{" "}
          <code className="font-mono">npm run snapshot:capture -- --lcd &lt;url&gt;</code>.
        </p>
      )}

      {Object.entries(byChain).map(([chainId, entries]) => (
        <section key={chainId} className="space-y-2">
          <h2 className="text-lg font-medium font-mono">{chainId}</h2>
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/archive/${e.id}`}
                  className="block rounded border border-white/10 hover:border-white/30 px-3 py-2"
                >
                  <div className="font-mono text-sm">{e.id}</div>
                  <div className="text-xs opacity-70">
                    height {e.capturedHeight} · captured {new Date(e.capturedAtIso).toLocaleString()}
                    {e.label ? ` · ${e.label}` : ""}
                    {e.location === "remote" ? " · remote" : ""}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
