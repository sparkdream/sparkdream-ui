"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";
import {
  getGovProposal,
  getGovProposalTally,
  getGovProposalVotes,
  getGovProposalDeposits,
} from "@/lib/api";
import type {
  GovProposal,
  GovTallyResult,
  GovVote,
  GovDeposit,
} from "@/types/gov";
import CopyableAddress from "@/components/CopyableAddress";
import { formatTime } from "@/lib/utils";
import { ArchiveSectionShell, LoadError } from "../../_components";

function fmtCount(n: string): string {
  // Tally counts arrive as raw integers (uspark voting power). Show with commas.
  const num = Number(n);
  if (!Number.isFinite(num)) return n;
  return num.toLocaleString();
}

export default function ArchiveProposalDetail({
  params,
}: {
  params: Promise<{ snapshotId: string; id: string }>;
}) {
  const { snapshotId, id } = use(params);
  const { entry } = useArchive();
  const [proposal, setProposal] = useState<GovProposal | null>(null);
  const [tally, setTally] = useState<GovTallyResult | null>(null);
  const [votes, setVotes] = useState<GovVote[]>([]);
  const [deposits, setDeposits] = useState<GovDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, t, v, d] = await Promise.all([
          getGovProposal(id),
          getGovProposalTally(id).catch(() => null),
          getGovProposalVotes(id).catch(() => null),
          getGovProposalDeposits(id).catch(() => null),
        ]);
        if (cancelled) return;
        setProposal(p.proposal);
        setTally(t?.tally ?? null);
        setVotes(v?.votes ?? []);
        setDeposits(d?.deposits ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry, id]);

  return (
    <ArchiveSectionShell
      snapshotId={snapshotId}
      title={proposal?.title || `Proposal #${id}`}
    >
      <Link
        href={`/archive/${snapshotId}/governance`}
        className="text-sm opacity-70 hover:opacity-100 -mt-2 block"
      >
        ← back to governance
      </Link>
      {loading && <p className="opacity-70">Loading…</p>}
      {error && <LoadError msg={error} />}
      {proposal && (
        <>
          <div className="text-xs opacity-60 flex gap-3 flex-wrap">
            <span>#{proposal.id}</span>
            <span>status: {proposal.status.replace("PROPOSAL_STATUS_", "").toLowerCase()}</span>
            <span>proposer: <CopyableAddress address={proposal.proposer} /></span>
          </div>
          {proposal.summary && (
            <p className="text-sm whitespace-pre-wrap">{proposal.summary}</p>
          )}

          <section>
            <h2 className="text-sm font-medium opacity-70 mb-2">Timeline</h2>
            <dl className="text-xs grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              {proposal.submit_time && (
                <>
                  <dt className="opacity-70">submitted</dt>
                  <dd className="font-mono">{formatTime(proposal.submit_time)}</dd>
                </>
              )}
              {proposal.deposit_end_time && (
                <>
                  <dt className="opacity-70">deposit ends</dt>
                  <dd className="font-mono">{formatTime(proposal.deposit_end_time)}</dd>
                </>
              )}
              {proposal.voting_start_time && (
                <>
                  <dt className="opacity-70">voting started</dt>
                  <dd className="font-mono">{formatTime(proposal.voting_start_time)}</dd>
                </>
              )}
              {proposal.voting_end_time && (
                <>
                  <dt className="opacity-70">voting ended</dt>
                  <dd className="font-mono">{formatTime(proposal.voting_end_time)}</dd>
                </>
              )}
              {proposal.total_deposit?.length > 0 && (
                <>
                  <dt className="opacity-70">total deposit</dt>
                  <dd className="font-mono">
                    {proposal.total_deposit.map((c) => `${c.amount} ${c.denom}`).join(", ")}
                  </dd>
                </>
              )}
            </dl>
          </section>

          {tally && (
            <section>
              <h2 className="text-sm font-medium opacity-70 mb-2">Final tally</h2>
              <ul className="text-sm grid grid-cols-2 sm:grid-cols-4 gap-2">
                <li className="rounded border border-emerald-700/40 px-3 py-2">
                  <div className="text-xs opacity-70">Yes</div>
                  <div className="font-mono">{fmtCount(tally.yes_count)}</div>
                </li>
                <li className="rounded border border-red-700/40 px-3 py-2">
                  <div className="text-xs opacity-70">No</div>
                  <div className="font-mono">{fmtCount(tally.no_count)}</div>
                </li>
                <li className="rounded border border-red-900/60 px-3 py-2">
                  <div className="text-xs opacity-70">Veto</div>
                  <div className="font-mono">{fmtCount(tally.no_with_veto_count)}</div>
                </li>
                <li className="rounded border border-white/10 px-3 py-2">
                  <div className="text-xs opacity-70">Abstain</div>
                  <div className="font-mono">{fmtCount(tally.abstain_count)}</div>
                </li>
              </ul>
            </section>
          )}

          {votes.length > 0 && (
            <section>
              <h2 className="text-sm font-medium opacity-70 mb-2">Votes ({votes.length})</h2>
              <ul className="text-xs space-y-1">
                {votes.map((v) => (
                  <li key={v.voter} className="flex gap-3">
                    <CopyableAddress address={v.voter} />
                    <span className="opacity-70">
                      {v.options.map((o) => o.option.replace("VOTE_OPTION_", "")).join(", ").toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {deposits.length > 0 && (
            <section>
              <h2 className="text-sm font-medium opacity-70 mb-2">Deposits</h2>
              <ul className="text-xs space-y-1">
                {deposits.map((d, i) => (
                  <li key={`${d.depositor}-${i}`} className="flex gap-3">
                    <CopyableAddress address={d.depositor} />
                    <span className="opacity-70">
                      {d.amount.map((c) => `${c.amount} ${c.denom}`).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </ArchiveSectionShell>
  );
}
