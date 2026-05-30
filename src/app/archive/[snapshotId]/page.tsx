"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import type { ManifestEntry } from "@/lib/archive";

interface SectionInfo {
  slug: string;
  label: string;
  desc: string;
  indexFiles: string[];
}

const SECTIONS: SectionInfo[] = [
  {
    slug: "imaginarium",
    label: "Imaginarium",
    desc: "Long-form posts & replies",
    indexFiles: ["posts"],
  },
  {
    slug: "wonders",
    label: "Wonders",
    desc: "Curated collections",
    indexFiles: ["collections"],
  },
  {
    slug: "swarm",
    label: "Swarm",
    desc: "Forum threads & replies",
    indexFiles: ["forum-threads"],
  },
  {
    slug: "governance",
    label: "Governance",
    desc: "On-chain & commons proposals",
    indexFiles: ["gov-proposals", "commons-proposals"],
  },
  {
    slug: "futarchy",
    label: "Futarchy",
    desc: "Conditional markets",
    indexFiles: ["futarchy-markets"],
  },
];

// Index files live alongside the lcd/ tree. For remote snapshots they're in the
// bucket, not baked into the deployment image — fetch them from remoteBase, the
// same place the section pages read their lcd/ data from. (Hardcoding the local
// /archive path here is why remote snapshots showed 0 for every section.)
function indexBase(entry: ManifestEntry): string {
  if (entry.location === "remote") {
    if (!entry.remoteBase) {
      throw new Error(`Snapshot ${entry.id} is remote but has no remoteBase`);
    }
    return `${entry.remoteBase.replace(/\/$/, "")}/${entry.id}/index`;
  }
  return `/archive/${entry.id}/index`;
}

async function loadIndexCount(base: string, name: string): Promise<number> {
  const res = await fetch(`${base}/${name}.json`);
  if (!res.ok) return 0;
  const ids = (await res.json()) as string[];
  return ids.length;
}

export default function ArchiveSnapshotLanding({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = use(params);
  const { entry, manifestReady } = useArchive();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [memberCount, setMemberCount] = useState<number | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    (async () => {
      const base = indexBase(entry);
      const all = new Set(SECTIONS.flatMap((s) => s.indexFiles));
      const pairs = await Promise.all(
        [...all].map(async (n) => [n, await loadIndexCount(base, n)] as const),
      );
      const members = await loadIndexCount(base, "members");
      if (cancelled) return;
      setCounts(Object.fromEntries(pairs));
      setMemberCount(members);
    })();
    return () => {
      cancelled = true;
    };
  }, [entry, snapshotId]);

  if (!manifestReady) return <div className="p-6 opacity-70">Loading manifest…</div>;
  if (!entry) {
    return (
      <div className="p-6">
        Snapshot <code className="font-mono">{snapshotId}</code> not found.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{entry.chainId}</h1>
        <p className="text-sm opacity-70 font-mono">{entry.id}</p>
        <p className="text-xs opacity-60">
          height {entry.capturedHeight} · captured {new Date(entry.capturedAtIso).toLocaleString()}
          {memberCount !== null ? ` · ${memberCount} members` : ""}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const total = s.indexFiles.reduce((acc, n) => acc + (counts[n] ?? 0), 0);
          const disabled = total === 0;
          const body = (
            <div className="flex items-baseline justify-between">
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="text-xs opacity-70">{s.desc}</div>
              </div>
              <div className="font-mono text-lg opacity-80">{total}</div>
            </div>
          );
          return disabled ? (
            <div
              key={s.slug}
              className="rounded border border-white/5 px-4 py-3 opacity-40"
              title="No captured data in this snapshot"
            >
              {body}
            </div>
          ) : (
            <Link
              key={s.slug}
              href={`/archive/${snapshotId}/${s.slug}`}
              className="rounded border border-white/10 hover:border-white/30 px-4 py-3"
            >
              {body}
            </Link>
          );
        })}
      </section>
    </div>
  );
}
