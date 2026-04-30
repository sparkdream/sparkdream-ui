"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import {
  getContribution,
  getTrancheTally,
  listTrancheStakes,
} from "@/lib/api";
import { RevealMsgTypeUrls } from "@/lib/tx";
import CouncilActions from "@/components/reveal/CouncilActions";
import { useDisplayName } from "@/hooks/useDisplayName";
import { formatTime, timeAgo, truncateAddress } from "@/lib/utils";
import { dreamToMicro, formatDream } from "@/lib/reveal-fmt";
import {
  CONTRIBUTION_STATUS_LABELS,
  ContributionStatus,
  TRANCHE_STATUS_LABELS,
  TrancheStatus,
} from "@/types/reveal";
import type {
  Contribution,
  RevealStake,
  RevealTranche,
} from "@/types/reveal";

interface TrancheTally {
  yes_weight: string;
  no_weight: string;
  vote_count: number;
}

export default function ContributionDetail({
  contributionId,
  onBack,
}: {
  contributionId: string;
  onBack: () => void;
}) {
  const { address } = useWallet();
  const [contribution, setContribution] = useState<Contribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { name: contributorName } = useDisplayName(contribution?.contributor || "");

  useEffect(() => {
    let cancelled = false;
    getContribution(contributionId)
      .then((res) => {
        if (cancelled) return;
        setContribution(res.contribution);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load contribution";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contributionId, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        <div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  if (error || !contribution) {
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Back
        </button>
        <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error || "Contribution not found."}
        </div>
      </div>
    );
  }

  const isContributor = address && address === contribution.contributor;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      <div className="sd-hull-tile rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-zinc-100">
                {contribution.project_name || `Contribution #${contribution.id}`}
              </h2>
              <span className="sd-pill trust-est">
                {CONTRIBUTION_STATUS_LABELS[contribution.status] || contribution.status}
              </span>
            </div>
            {contribution.description && (
              <p className="mt-2 text-sm text-zinc-300">{contribution.description}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-zinc-400 sm:grid-cols-4">
              <Metric label="Contributor" value={contributorName || truncateAddress(contribution.contributor)} mono={!contributorName} />
              <Metric label="Total valuation" value={`${formatDream(contribution.total_valuation)} DREAM`} />
              <Metric label="Bond" value={`${formatDream(contribution.bond_remaining)} / ${formatDream(contribution.bond_amount)} DREAM`} />
              <Metric label="Holdback" value={`${formatDream(contribution.holdback_amount)} DREAM`} />
              <Metric label="Initial license" value={contribution.initial_license || "—"} />
              <Metric label="Final license" value={contribution.final_license || "—"} />
              {contribution.created_at && contribution.created_at !== "0" && (
                <Metric label="Created" value={formatTime(contribution.created_at)} />
              )}
              {contribution.approved_at && contribution.approved_at !== "0" && (
                <Metric label="Approved" value={formatTime(contribution.approved_at)} />
              )}
            </div>
          </div>
          {isContributor && contribution.status === ContributionStatus.PROPOSED && (
            <CancelButton contributionId={contribution.id} address={address!} onDone={refresh} />
          )}
        </div>
        {contribution.status === ContributionStatus.PROPOSED && (
          <CouncilActions
            kind="contribution"
            contributionId={contribution.id}
            onChanged={refresh}
          />
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Tranches ({contribution.tranches?.length || 0})
        </h3>
        {(contribution.tranches || []).map((tranche) => (
          <TrancheCard
            key={tranche.id}
            contributionId={contribution.id}
            contributor={contribution.contributor}
            tranche={tranche}
            onChanged={refresh}
            refreshKey={refreshKey}
          />
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-sm text-zinc-200 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function TrancheCard({
  contributionId,
  contributor,
  tranche,
  onChanged,
  refreshKey,
}: {
  contributionId: string;
  contributor: string;
  tranche: RevealTranche;
  onChanged: () => void;
  refreshKey: number;
}) {
  const { address } = useWallet();
  const [tally, setTally] = useState<TrancheTally | null>(null);
  const [stakes, setStakes] = useState<RevealStake[]>([]);

  const isContributor = address && address === contributor;
  const isStaker = stakes.some((s) => s.staker === address);

  useEffect(() => {
    let cancelled = false;
    listTrancheStakes(contributionId, tranche.id, { limit: "100" })
      .then((res) => {
        if (!cancelled) setStakes(res.stakes || []);
      })
      .catch(() => {
        if (!cancelled) setStakes([]);
      });
    if (
      tranche.status === TrancheStatus.REVEALED ||
      tranche.status === TrancheStatus.VERIFIED ||
      tranche.status === TrancheStatus.DISPUTED ||
      tranche.status === TrancheStatus.FAILED
    ) {
      getTrancheTally(contributionId, tranche.id)
        .then((res) => {
          if (!cancelled) setTally(res);
        })
        .catch(() => {
          if (!cancelled) setTally(null);
        });
    } else {
      setTally(null);
    }
    return () => {
      cancelled = true;
    };
  }, [contributionId, tranche.id, tranche.status, refreshKey]);

  const stakedPct = (() => {
    try {
      const threshold = BigInt(tranche.stake_threshold || "0");
      const staked = BigInt(tranche.dream_staked || "0");
      if (threshold === BigInt(0)) return 0;
      return Number((staked * BigInt(10000)) / threshold) / 100;
    } catch {
      return 0;
    }
  })();

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-zinc-500">#{tranche.id}</span>
            <h4 className="text-base font-semibold text-zinc-100">
              {tranche.name || `Tranche ${tranche.id}`}
            </h4>
            <span className={`sd-pill ${pillClassForTranche(tranche.status)}`}>
              {TRANCHE_STATUS_LABELS[tranche.status] || tranche.status}
            </span>
          </div>
          {tranche.description && (
            <p className="mt-1 text-sm text-zinc-400">{tranche.description}</p>
          )}
          {tranche.components && tranche.components.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tranche.components.map((comp) => (
                <span key={comp} className="sd-pill tag">
                  {comp}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>
            {formatDream(tranche.dream_staked)} / {formatDream(tranche.stake_threshold)} DREAM
          </span>
          <span>{stakedPct.toFixed(1)}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-rose-500"
            style={{ width: `${Math.min(100, stakedPct)}%` }}
          />
        </div>
      </div>

      {tally && (
        <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
          <Metric label="YES weight" value={`${formatDream(tally.yes_weight)} DREAM`} />
          <Metric label="NO weight" value={`${formatDream(tally.no_weight)} DREAM`} />
          <Metric label="Votes" value={String(tally.vote_count)} />
        </div>
      )}

      <TrancheDeadlines tranche={tranche} />

      {tranche.code_uri && (
        <div className="mt-3 space-y-1 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
          <div>
            <span className="text-zinc-500">Code: </span>
            <span className="font-mono text-zinc-200 break-all">{tranche.code_uri}</span>
          </div>
          {tranche.docs_uri && (
            <div>
              <span className="text-zinc-500">Docs: </span>
              <span className="font-mono text-zinc-200 break-all">{tranche.docs_uri}</span>
            </div>
          )}
          {tranche.commit_hash && (
            <div>
              <span className="text-zinc-500">Commit: </span>
              <span className="font-mono text-zinc-200">{tranche.commit_hash}</span>
            </div>
          )}
        </div>
      )}

      <TrancheActions
        contributionId={contributionId}
        tranche={tranche}
        isContributor={!!isContributor}
        isStaker={isStaker}
        onChanged={onChanged}
      />

      {tranche.status === TrancheStatus.DISPUTED && (
        <CouncilActions
          kind="dispute"
          contributionId={contributionId}
          trancheId={tranche.id}
          onChanged={onChanged}
        />
      )}

      {stakes.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
            {stakes.length} stake{stakes.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 space-y-1">
            {stakes.map((s) => (
              <StakeRow
                key={s.id}
                stake={s}
                trancheStatus={tranche.status}
                onChanged={onChanged}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function TrancheDeadlines({ tranche }: { tranche: RevealTranche }) {
  const items: { label: string; value: string }[] = [];
  if (tranche.stake_deadline && tranche.stake_deadline !== "0") {
    items.push({ label: "Stake deadline", value: `epoch ${tranche.stake_deadline}` });
  }
  if (tranche.reveal_deadline && tranche.reveal_deadline !== "0") {
    items.push({ label: "Reveal deadline", value: `epoch ${tranche.reveal_deadline}` });
  }
  if (tranche.verification_deadline && tranche.verification_deadline !== "0") {
    items.push({ label: "Verification deadline", value: `epoch ${tranche.verification_deadline}` });
  }
  if (items.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
      {items.map((it) => (
        <span key={it.label}>
          <span className="uppercase tracking-wide">{it.label}:</span>{" "}
          <span className="text-zinc-300">{it.value}</span>
        </span>
      ))}
    </div>
  );
}

function StakeRow({
  stake,
  trancheStatus,
  onChanged,
}: {
  stake: RevealStake;
  trancheStatus: string;
  onChanged: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { name } = useDisplayName(stake.staker);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isOwner = !!address && address === stake.staker;
  const canWithdraw =
    isOwner &&
    (trancheStatus === TrancheStatus.STAKING || trancheStatus === TrancheStatus.BACKED);

  const handleWithdraw = async () => {
    if (!address) return;
    setErr(null);
    setSubmitting(true);
    try {
      await signAndBroadcast([{
        typeUrl: RevealMsgTypeUrls.Withdraw,
        value: {
          staker: address,
          stake_id: BigInt(stake.id),
        },
      }]);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-zinc-900/60 px-2 py-1 text-xs">
      <span className="font-mono text-zinc-300">{name || truncateAddress(stake.staker)}</span>
      <span className="text-zinc-200">{formatDream(stake.amount)} DREAM</span>
      <span className="text-zinc-500">{timeAgo(stake.staked_at)}</span>
      {canWithdraw && (
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={submitting}
          className="rounded-md border border-zinc-700 bg-zinc-800/40 px-2 py-0.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-60"
        >
          {submitting ? "Withdrawing…" : "Withdraw"}
        </button>
      )}
      {err && <span className="text-[11px] text-red-400">{err}</span>}
    </div>
  );
}

function TrancheActions({
  contributionId,
  tranche,
  isContributor,
  isStaker,
  onChanged,
}: {
  contributionId: string;
  tranche: RevealTranche;
  isContributor: boolean;
  isStaker: boolean;
  onChanged: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const [open, setOpen] = useState<null | "stake" | "reveal" | "verify">(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Stake
  const [stakeAmount, setStakeAmount] = useState("");
  // Reveal
  const [codeUri, setCodeUri] = useState("");
  const [docsUri, setDocsUri] = useState("");
  const [commitHash, setCommitHash] = useState("");
  // Verify
  const [valueConfirmed, setValueConfirmed] = useState(true);
  const [qualityRating, setQualityRating] = useState(4);
  const [comments, setComments] = useState("");

  const reset = useCallback(() => {
    setOpen(null);
    setStakeAmount("");
    setCodeUri("");
    setDocsUri("");
    setCommitHash("");
    setComments("");
    setQualityRating(4);
    setValueConfirmed(true);
    setErr(null);
  }, []);

  const submitStake = async () => {
    if (!address) return;
    const micro = dreamToMicro(stakeAmount);
    if (!micro) {
      setErr("Enter a positive DREAM amount");
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      await signAndBroadcast([{
        typeUrl: RevealMsgTypeUrls.Stake,
        value: {
          staker: address,
          contribution_id: BigInt(contributionId),
          tranche_id: tranche.id,
          amount: micro,
        },
      }]);
      reset();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Stake failed");
    } finally {
      setSubmitting(false);
    }
  };

  const submitReveal = async () => {
    if (!address) return;
    if (!codeUri.trim() || !commitHash.trim()) {
      setErr("Code URI and commit hash are required");
      return;
    }
    setErr(null);
    setSubmitting(true);
    try {
      await signAndBroadcast([{
        typeUrl: RevealMsgTypeUrls.Reveal,
        value: {
          contributor: address,
          contribution_id: BigInt(contributionId),
          tranche_id: tranche.id,
          code_uri: codeUri.trim(),
          docs_uri: docsUri.trim(),
          commit_hash: commitHash.trim(),
        },
      }]);
      reset();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setSubmitting(false);
    }
  };

  const submitVerify = async () => {
    if (!address) return;
    setErr(null);
    setSubmitting(true);
    try {
      await signAndBroadcast([{
        typeUrl: RevealMsgTypeUrls.Verify,
        value: {
          voter: address,
          contribution_id: BigInt(contributionId),
          tranche_id: tranche.id,
          value_confirmed: valueConfirmed,
          quality_rating: qualityRating,
          comments,
        },
      }]);
      reset();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Verify failed");
    } finally {
      setSubmitting(false);
    }
  };

  const canStake =
    !!address &&
    !isContributor &&
    tranche.status === TrancheStatus.STAKING;
  const canReveal =
    !!address && isContributor && tranche.status === TrancheStatus.BACKED;
  const canVerify =
    !!address &&
    !isContributor &&
    isStaker &&
    tranche.status === TrancheStatus.REVEALED;

  if (!canStake && !canReveal && !canVerify) return null;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {canStake && (
          <button
            type="button"
            onClick={() => setOpen(open === "stake" ? null : "stake")}
            className="sd-btn sd-btn-primary text-xs"
          >
            Stake DREAM
          </button>
        )}
        {canReveal && (
          <button
            type="button"
            onClick={() => setOpen(open === "reveal" ? null : "reveal")}
            className="sd-btn sd-btn-primary text-xs"
          >
            Reveal code
          </button>
        )}
        {canVerify && (
          <button
            type="button"
            onClick={() => setOpen(open === "verify" ? null : "verify")}
            className="sd-btn sd-btn-primary text-xs"
          >
            Verify
          </button>
        )}
      </div>

      {open === "stake" && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <label className="block text-xs text-zinc-400">Amount (DREAM)</label>
          <input
            type="number"
            step="any"
            min="0"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            placeholder="e.g. 500"
          />
          <FormFooter
            onCancel={reset}
            onSubmit={submitStake}
            submitting={submitting}
            submitLabel="Stake"
            error={err}
          />
        </div>
      )}

      {open === "reveal" && (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <FormField label="Code URI (e.g. ipfs://…)">
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
              value={codeUri}
              onChange={(e) => setCodeUri(e.target.value)}
            />
          </FormField>
          <FormField label="Docs URI (optional)">
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
              value={docsUri}
              onChange={(e) => setDocsUri(e.target.value)}
            />
          </FormField>
          <FormField label="Commit hash">
            <input
              className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100 font-mono"
              value={commitHash}
              onChange={(e) => setCommitHash(e.target.value)}
            />
          </FormField>
          <FormFooter
            onCancel={reset}
            onSubmit={submitReveal}
            submitting={submitting}
            submitLabel="Reveal"
            error={err}
          />
        </div>
      )}

      {open === "verify" && (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={valueConfirmed}
              onChange={(e) => setValueConfirmed(e.target.checked)}
            />
            Code delivers what was promised
          </label>
          <FormField label="Quality rating (1–5)">
            <input
              type="number"
              min={1}
              max={5}
              className="w-24 rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
              value={qualityRating}
              onChange={(e) => setQualityRating(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
            />
          </FormField>
          <FormField label="Comments (optional)">
            <textarea
              rows={2}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </FormField>
          <FormFooter
            onCancel={reset}
            onSubmit={submitVerify}
            submitting={submitting}
            submitLabel="Submit verification"
            error={err}
          />
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-zinc-400">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function FormFooter({
  onCancel,
  onSubmit,
  submitting,
  submitLabel,
  error,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  error: string | null;
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      {error && (
        <div className="mr-auto text-xs text-red-400">{error}</div>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="sd-btn-ghost text-xs"
        disabled={submitting}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        className="sd-btn sd-btn-primary text-xs"
        disabled={submitting}
      >
        {submitting ? "Submitting…" : submitLabel}
      </button>
    </div>
  );
}

function CancelButton({
  contributionId,
  address,
  onDone,
}: {
  contributionId: string;
  address: string;
  onDone: () => void;
}) {
  const { signAndBroadcast } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  const handleCancel = async () => {
    setSubmitting(true);
    try {
      await signAndBroadcast([{
        typeUrl: RevealMsgTypeUrls.Cancel,
        value: {
          authority: address,
          contribution_id: BigInt(contributionId),
          reason: reason || "Cancelled by contributor",
        },
      }]);
      setOpen(false);
      setReason("");
      onDone();
    } catch (e) {
      console.error("Cancel failed:", e);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sd-btn-ghost text-xs"
      >
        Cancel contribution
      </button>
    );
  }

  return (
    <div className="w-72 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <FormField label="Reason">
        <input
          className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="sd-btn-ghost text-xs"
          disabled={submitting}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="sd-btn sd-btn-primary text-xs"
          disabled={submitting}
        >
          {submitting ? "Cancelling…" : "Confirm cancel"}
        </button>
      </div>
    </div>
  );
}

function pillClassForTranche(status: string): string {
  switch (status) {
    case TrancheStatus.STAKING:
      return "trust-prov";
    case TrancheStatus.BACKED:
      return "trust-est";
    case TrancheStatus.REVEALED:
      return "trust-trusted";
    case TrancheStatus.VERIFIED:
      return "trust-core";
    case TrancheStatus.DISPUTED:
      return "tag";
    case TrancheStatus.LOCKED:
      return "tag-neutral";
    case TrancheStatus.CANCELLED:
    case TrancheStatus.FAILED:
      return "tag-neutral";
    default:
      return "tag-neutral";
  }
}
