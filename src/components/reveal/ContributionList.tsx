"use client";

import { useEffect, useState } from "react";
import {
  listContributions,
  listContributionsByContributor,
  listContributionsByStatus,
} from "@/lib/api";
import { useDisplayName } from "@/hooks/useDisplayName";
import { truncateAddress, timeAgo } from "@/lib/utils";
import {
  CONTRIBUTION_STATUS_LABELS,
  ContributionStatus,
  ContributionStatusValue,
  TRANCHE_STATUS_LABELS,
  TrancheStatus,
} from "@/types/reveal";
import type { Contribution } from "@/types/reveal";
import { formatDream } from "@/lib/reveal-fmt";

type Mode = "all" | "by-contributor" | "by-status";

export default function ContributionList({
  mode,
  contributor,
  status,
  onSelect,
}: {
  mode: Mode;
  contributor?: string;
  status?: keyof typeof ContributionStatus;
  onSelect: (c: Contribution) => void;
}) {
  const [items, setItems] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const promise =
      mode === "by-contributor" && contributor
        ? listContributionsByContributor(contributor, { limit: "50", reverse: true })
        : mode === "by-status" && status
          ? listContributionsByStatus(
              ContributionStatusValue[ContributionStatus[status]],
              { limit: "50", reverse: true }
            )
          : listContributions({ limit: "50", reverse: true });

    promise
      .then((res) => {
        if (cancelled) return;
        setItems(res.contributions || []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load contributions";
        if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
          setItems([]);
          setError(null);
        } else {
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, contributor, status]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        <div className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        <div className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="sd-hull-tile rounded-xl p-12 text-center text-sm text-zinc-400">
        No contributions yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((c) => (
        <ContributionCard key={c.id} contribution={c} onSelect={onSelect} />
      ))}
    </div>
  );
}

function ContributionCard({
  contribution,
  onSelect,
}: {
  contribution: Contribution;
  onSelect: (c: Contribution) => void;
}) {
  const { name } = useDisplayName(contribution.contributor);
  const statusLabel = CONTRIBUTION_STATUS_LABELS[contribution.status] || contribution.status;
  const trancheCount = contribution.tranches?.length || 0;
  const verifiedCount = (contribution.tranches || []).filter(
    (t) => t.status === TrancheStatus.VERIFIED
  ).length;
  const currentTranche = contribution.tranches?.[contribution.current_tranche];

  return (
    <button
      type="button"
      onClick={() => onSelect(contribution)}
      className="sd-hull-tile group block w-full rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-zinc-100">
              {contribution.project_name || `Contribution #${contribution.id}`}
            </h3>
            <span className={`sd-pill ${pillClassForStatus(contribution.status)}`}>
              {statusLabel}
            </span>
          </div>
          {contribution.description && (
            <p className="mt-1 line-clamp-2 text-sm text-zinc-400">
              {contribution.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>by {name || truncateAddress(contribution.contributor)}</span>
            <span>·</span>
            <span>
              {verifiedCount}/{trancheCount} tranche{trancheCount === 1 ? "" : "s"} verified
            </span>
            <span>·</span>
            <span>{formatDream(contribution.total_valuation)} DREAM total</span>
            {contribution.created_at && contribution.created_at !== "0" && (
              <>
                <span>·</span>
                <span>{timeAgo(contribution.created_at)}</span>
              </>
            )}
          </div>
          {currentTranche && (
            <div className="mt-2 text-xs text-zinc-400">
              Current: <span className="text-zinc-200">{currentTranche.name || `Tranche ${currentTranche.id}`}</span>
              <span className="text-zinc-500"> · {TRANCHE_STATUS_LABELS[currentTranche.status] || currentTranche.status}</span>
            </div>
          )}
        </div>
        <div className="text-xs font-mono text-zinc-500">#{contribution.id}</div>
      </div>
    </button>
  );
}

function pillClassForStatus(status: string): string {
  switch (status) {
    case ContributionStatus.PROPOSED:
      return "trust-prov";
    case ContributionStatus.IN_PROGRESS:
      return "trust-est";
    case ContributionStatus.COMPLETED:
      return "trust-core";
    case ContributionStatus.CANCELLED:
      return "tag-neutral";
    default:
      return "tag-neutral";
  }
}
