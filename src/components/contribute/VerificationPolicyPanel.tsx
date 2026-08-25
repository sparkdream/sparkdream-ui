"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { RepMsgTypeUrls } from "@/lib/tx";
import type { RepProject, VerificationPolicy } from "@/types/rep";
import { ProjectStatus, REVIEW_PROCESS_LABELS, ReviewProcess } from "@/types/rep";
import { reviewProcessFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/project";

interface Props {
  project: RepProject;
  isOpsCommitteeMember: boolean;
  onChanged: () => void;
}

// Chain-side ceiling from x/rep/types/accountability_defaults.go.
const MAX_VERIFIER_COUNT = 10;

// LegacyDec on the wire is always an 18-decimal string, and sign bytes are
// compared against exactly what the chain would render. Padded from the typed
// text rather than through Number.toFixed, which turns "0.1" into
// "0.100000000000000006" and fails sigverify.
function toDecString(input: string): string {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(input.trim());
  if (!m) return "0.000000000000000000";
  const whole = m[1] || "0";
  const frac = (m[2] || "").slice(0, 18).padEnd(18, "0");
  return `${whole}.${frac}`;
}

/**
 * A project's verification policy: how many bonded reviewers its initiatives
 * need, and the reputation bar those reviewers must clear.
 *
 * Settable while the project is ACTIVE rather than fixed at creation (chain
 * commit 70dce72), because the reviewer roster grows over time and a project
 * made before it existed would otherwise be stranded on conviction-only
 * permanently. Each initiative snapshots min_verifier_count when its review
 * window opens, so raising the bar never applies retroactively and lowering it
 * cannot rescue work already under review.
 */
export default function VerificationPolicyPanel({
  project,
  isOpsCommitteeMember,
  onChanged,
}: Props) {
  const { address, signAndBroadcast } = useWallet();
  const policy: VerificationPolicy | undefined = project.verification_policy;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [defaultReview, setDefaultReview] = useState<string>(
    policy?.default_review || ReviewProcess.CONVICTION_ONLY,
  );
  const [minVerifierCount, setMinVerifierCount] = useState<string>(
    String(policy?.min_verifier_count ?? 0),
  );
  const [minVerifierReputation, setMinVerifierReputation] = useState<string>(
    policy?.min_verifier_reputation ?? "0",
  );
  const [requiresDomainRep, setRequiresDomainRep] = useState<boolean>(
    policy?.requires_domain_rep ?? false,
  );
  const [requiresCreatorApproval, setRequiresCreatorApproval] = useState<boolean>(
    policy?.requires_creator_approval ?? false,
  );

  const canEdit =
    !!address &&
    project.status === ProjectStatus.ACTIVE &&
    (address === project.creator || isOpsCommitteeMember);

  const handleSave = async () => {
    if (!address) return;
    const count = Number(minVerifierCount);
    if (!Number.isInteger(count) || count < 0 || count > MAX_VERIFIER_COUNT) {
      setError(`Reviewers must be a whole number from 0 to ${MAX_VERIFIER_COUNT}`);
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await signAndBroadcast([
        {
          typeUrl: RepMsgTypeUrls.SetVerificationPolicy,
          value: {
            creator: address,
            projectId: BigInt(project.id),
            policy: {
              defaultReview: reviewProcessFromJSON(defaultReview),
              requiresDomainRep,
              minVerifierReputation: toDecString(minVerifierReputation),
              minVerifierCount: count,
              // The windows are clamped chain-side to max(global, project), so
              // sending the project's current values (or zero, which clamps up
              // to the chain default) never shortens either one.
              reviewPeriodEpochs: BigInt(policy?.review_period_epochs ?? "0"),
              challengePeriodEpochs: BigInt(policy?.challenge_period_epochs ?? "0"),
              requiresCreatorApproval,
            },
          },
        },
      ]);
      setOpen(false);
      onChanged();
    } catch (err) {
      console.error("Set verification policy failed:", err);
      setError(err instanceof Error ? err.message : "Failed to set the verification policy");
    } finally {
      setBusy(false);
    }
  };

  const required = policy?.min_verifier_count ?? 0;

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Review</h4>
        <span className="text-xs text-zinc-300">
          {required > 0
            ? `${required} bonded reviewer${required === 1 ? "" : "s"} must approve`
            : "Conviction only"}
        </span>
        {policy?.requires_domain_rep && (
          <span className="text-xs text-zinc-500">reviewers need reputation in the tags</span>
        )}
        {canEdit && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="sd-btn sd-btn-secondary ml-auto"
          >
            Edit policy
          </button>
        )}
      </div>

      {required === 0 && (
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          Initiatives above the chain-wide budget threshold still need one reviewer verdict.
          A project policy can demand more than that, never fewer.
        </p>
      )}

      {open && (
        <div className="mt-2.5 space-y-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Reviewers required</span>
              <input
                type="text"
                inputMode="numeric"
                value={minVerifierCount}
                onChange={(e) => setMinVerifierCount(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Minimum reviewer reputation</span>
              <input
                type="text"
                inputMode="decimal"
                value={minVerifierReputation}
                onChange={(e) => setMinVerifierReputation(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Default review process</span>
            <select
              value={defaultReview}
              onChange={(e) => setDefaultReview(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
            >
              {Object.entries(REVIEW_PROCESS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={requiresDomainRep}
              onChange={(e) => setRequiresDomainRep(e.target.checked)}
            />
            Reviewers need their reputation in the initiative&apos;s own tags
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={requiresCreatorApproval}
              onChange={(e) => setRequiresCreatorApproval(e.target.checked)}
            />
            Creator approval required
          </label>
          <p className="text-xs leading-relaxed text-zinc-500">
            Applies to initiatives whose review window opens from now on. Work already under
            review keeps the bar it was submitted against, so a policy change cannot rescue
            or retroactively block it. Up to {MAX_VERIFIER_COUNT} reviewers.
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="sd-btn sd-btn-primary"
            >
              {busy ? "Saving..." : "Save policy"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="sd-btn sd-btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
