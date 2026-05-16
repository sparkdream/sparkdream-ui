"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import { listGovProposals } from "@/lib/api";
import type { GovProposal } from "@/types/gov";
import { ArchiveSectionShell, EmptyState, LoadError } from "../_components";

function statusBadge(status: string): { label: string; cls: string } {
  const key = status.replace("PROPOSAL_STATUS_", "").toLowerCase();
  const cls =
    key === "passed"
      ? "bg-emerald-900/40 text-emerald-300"
      : key === "rejected"
        ? "bg-red-900/40 text-red-300"
        : key === "failed"
          ? "bg-zinc-800 text-zinc-400"
          : key === "voting_period"
            ? "bg-indigo-900/40 text-indigo-300"
            : "bg-zinc-800 text-zinc-400";
  return { label: key.replace(/_/g, " "), cls };
}

export default function ArchiveGovernanceList({
  params,
}: {
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = use(params);
  const { entry } = useArchive();
  const [proposals, setProposals] = useState<GovProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    listGovProposals()
      .then((res) => {
        if (!cancelled) setProposals(res.proposals ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  return (
    <ArchiveSectionShell snapshotId={snapshotId} title="Governance">
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {!loading && !error && proposals.length === 0 && <EmptyState what="proposals" />}
      <ul className="space-y-2">
        {proposals.map((p) => {
          const b = statusBadge(p.status);
          return (
            <li key={p.id}>
              <Link
                href={`/archive/${snapshotId}/governance/${p.id}`}
                className="block rounded border border-white/10 hover:border-white/30 px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-medium">
                    #{p.id} {p.title || "(no title)"}
                  </div>
                  <span className={`text-xs rounded px-2 py-0.5 ${b.cls}`}>{b.label}</span>
                </div>
                {p.summary && (
                  <div className="text-xs opacity-70 mt-1 line-clamp-2">{p.summary}</div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </ArchiveSectionShell>
  );
}
