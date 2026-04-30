"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useCommonsCouncil } from "@/hooks/useCommonsCouncil";
import { CommonsMsgTypeUrls, RevealMsgTypeUrls } from "@/lib/tx";
import { DisputeVerdictValue } from "@/types/reveal";

type OpenForm = "approve" | "reject" | "dispute";

interface BaseProps {
  contributionId: string;
  onChanged: () => void;
}

interface ContributionProps extends BaseProps {
  kind: "contribution";
}

interface DisputeProps extends BaseProps {
  kind: "dispute";
  trancheId: number;
}

/**
 * Wraps a reveal council message (MsgApprove / MsgReject / MsgResolveDispute) in
 * a Commons Council MsgSubmitProposal. Visible only to Commons Operations
 * Committee members. Council members must vote on the proposal before it
 * executes.
 */
export default function CouncilActions(props: ContributionProps | DisputeProps) {
  const { address, signAndBroadcast } = useWallet();
  const { councilPolicyAddress, isOpsCommitteeMember, loading } = useCommonsCouncil(address);

  const [open, setOpen] = useState<OpenForm | null>(null);
  const [reason, setReason] = useState("");
  const [verdict, setVerdict] = useState<"ACCEPT" | "IMPROVE" | "REJECT">("ACCEPT");
  const [metadata, setMetadata] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading || !isOpsCommitteeMember || !councilPolicyAddress || !address) return null;

  const reset = () => {
    setOpen(null);
    setReason("");
    setMetadata("");
    setVerdict("ACCEPT");
    setErr(null);
  };

  const submit = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      const innerMessages: { typeUrl: string; value: Uint8Array }[] = [];
      if (open === "approve") {
        const { MsgApprove } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/tx"
        );
        innerMessages.push({
          typeUrl: RevealMsgTypeUrls.Approve,
          value: MsgApprove.encode(
            MsgApprove.fromPartial({
              authority: councilPolicyAddress,
              proposer: address,
              contributionId: BigInt(props.contributionId),
            })
          ).finish(),
        });
      } else if (open === "reject") {
        if (!reason.trim()) throw new Error("Reason is required for rejection");
        const { MsgReject } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/tx"
        );
        innerMessages.push({
          typeUrl: RevealMsgTypeUrls.Reject,
          value: MsgReject.encode(
            MsgReject.fromPartial({
              authority: councilPolicyAddress,
              proposer: address,
              contributionId: BigInt(props.contributionId),
              reason: reason.trim(),
            })
          ).finish(),
        });
      } else if (open === "dispute" && props.kind === "dispute") {
        if (verdict !== "ACCEPT" && !reason.trim()) {
          throw new Error("Reason is required for IMPROVE or REJECT verdicts");
        }
        const { MsgResolveDispute } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/tx"
        );
        innerMessages.push({
          typeUrl: RevealMsgTypeUrls.ResolveDispute,
          value: MsgResolveDispute.encode(
            MsgResolveDispute.fromPartial({
              authority: councilPolicyAddress,
              proposer: address,
              contributionId: BigInt(props.contributionId),
              trancheId: props.trancheId,
              verdict: DisputeVerdictValue[verdict],
              reason: reason.trim(),
            })
          ).finish(),
        });
      } else {
        throw new Error("No action selected");
      }

      const defaultMetadata =
        open === "approve"
          ? `Approve reveal contribution #${props.contributionId}`
          : open === "reject"
            ? `Reject reveal contribution #${props.contributionId}: ${reason}`
            : props.kind === "dispute"
              ? `Resolve dispute on contribution #${props.contributionId} tranche ${props.trancheId}: ${verdict}${reason ? ` — ${reason}` : ""}`
              : `Reveal council action #${props.contributionId}`;

      await signAndBroadcast([{
        typeUrl: CommonsMsgTypeUrls.SubmitProposal,
        value: {
          proposer: address,
          policyAddress: councilPolicyAddress,
          messages: innerMessages,
          metadata: metadata.trim() || defaultMetadata,
        },
      }]);

      reset();
      props.onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (props.kind === "dispute") {
    return (
      <div className="mt-3 space-y-2">
        {open !== "dispute" ? (
          <button
            type="button"
            onClick={() => setOpen("dispute")}
            className="sd-btn-ghost text-xs"
          >
            Resolve dispute (Council proposal)
          </button>
        ) : (
          <DisputeForm
            verdict={verdict}
            setVerdict={setVerdict}
            reason={reason}
            setReason={setReason}
            metadata={metadata}
            setMetadata={setMetadata}
            submitting={submitting}
            err={err}
            onCancel={reset}
            onSubmit={submit}
          />
        )}
      </div>
    );
  }

  // approve / reject — render side by side
  return (
    <div className="mt-3 space-y-2">
      {!open ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpen("approve")}
            className="sd-btn sd-btn-primary text-xs"
          >
            Approve (Council proposal)
          </button>
          <button
            type="button"
            onClick={() => setOpen("reject")}
            className="sd-btn-ghost text-xs"
          >
            Reject (Council proposal)
          </button>
        </div>
      ) : (
        <ApproveRejectForm
          mode={open as "approve" | "reject"}
          reason={reason}
          setReason={setReason}
          metadata={metadata}
          setMetadata={setMetadata}
          submitting={submitting}
          err={err}
          onCancel={reset}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

function ApproveRejectForm({
  mode,
  reason,
  setReason,
  metadata,
  setMetadata,
  submitting,
  err,
  onCancel,
  onSubmit,
}: {
  mode: "approve" | "reject";
  reason: string;
  setReason: (v: string) => void;
  metadata: string;
  setMetadata: (v: string) => void;
  submitting: boolean;
  err: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="text-xs text-zinc-400">
        This submits a Commons Council proposal — council members must vote to{" "}
        <span className="text-zinc-200">{mode === "approve" ? "approve" : "reject"}</span>{" "}
        before the action executes.
      </div>
      {mode === "reject" && (
        <Field label="Reason (required)">
          <input
            className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why should this contribution be rejected?"
          />
        </Field>
      )}
      <Field label="Proposal metadata (optional)">
        <input
          className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
          value={metadata}
          onChange={(e) => setMetadata(e.target.value)}
          placeholder="Auto-generated if blank"
        />
      </Field>
      <FormFooter
        onCancel={onCancel}
        onSubmit={onSubmit}
        submitting={submitting}
        submitLabel={mode === "approve" ? "Submit approval proposal" : "Submit rejection proposal"}
        err={err}
      />
    </div>
  );
}

function DisputeForm({
  verdict,
  setVerdict,
  reason,
  setReason,
  metadata,
  setMetadata,
  submitting,
  err,
  onCancel,
  onSubmit,
}: {
  verdict: "ACCEPT" | "IMPROVE" | "REJECT";
  setVerdict: (v: "ACCEPT" | "IMPROVE" | "REJECT") => void;
  reason: string;
  setReason: (v: string) => void;
  metadata: string;
  setMetadata: (v: string) => void;
  submitting: boolean;
  err: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="text-xs text-zinc-400">
        Submitted as a Commons Council proposal. Verdict applies once the council passes the proposal.
      </div>
      <Field label="Verdict">
        <div className="flex gap-2">
          {(["ACCEPT", "IMPROVE", "REJECT"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVerdict(v)}
              className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                verdict === v
                  ? "border-indigo-500/60 bg-indigo-600/15 text-indigo-300"
                  : "border-zinc-700 bg-zinc-800/40 text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`Reason${verdict === "ACCEPT" ? " (optional)" : " (required)"}`}>
        <textarea
          rows={2}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Field label="Proposal metadata (optional)">
        <input
          className="w-full rounded-md border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-sm text-zinc-100"
          value={metadata}
          onChange={(e) => setMetadata(e.target.value)}
        />
      </Field>
      <FormFooter
        onCancel={onCancel}
        onSubmit={onSubmit}
        submitting={submitting}
        submitLabel="Submit dispute resolution"
        err={err}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-zinc-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function FormFooter({
  onCancel,
  onSubmit,
  submitting,
  submitLabel,
  err,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  err: string | null;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      {err && <div className="mr-auto text-xs text-red-400">{err}</div>}
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="sd-btn-ghost text-xs"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="sd-btn sd-btn-primary text-xs"
      >
        {submitting ? "Submitting…" : submitLabel}
      </button>
    </div>
  );
}
