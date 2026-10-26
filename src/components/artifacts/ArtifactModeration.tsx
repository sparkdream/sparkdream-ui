"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import { useIsEligibleSentinel } from "@/hooks/useIsEligibleSentinel";
import { useCommonsCouncil } from "@/hooks/useCommonsCouncil";
import { useTxAction } from "@/hooks/useTxAction";
import ActionBanner from "@/components/ActionBanner";
import BlockTime from "@/components/BlockTime";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { invalidateArtifacts } from "@/lib/artifactApi";
import { MODERATION_REASONS, MODERATION_REASON_LABELS } from "@/types/collect";
import { HideOutcome, type HideRecord } from "@/types/artifact";
import { hideTargetKindFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/types";
import type {
  MsgAppealHide,
  MsgHideContent,
  MsgUnhideContent,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import type { ModerationReason } from "@sparkdreamnft/sparkdreamjs/sparkdream/common/v1/moderation_reason";
import { fieldCls, txFailure } from "./shared";

// Hide target per kind; an edition's id travels in token_id.
const TARGET_KIND = {
  class: "HIDE_TARGET_KIND_CLASS",
  token: "HIDE_TARGET_KIND_TOKEN",
  edition: "HIDE_TARGET_KIND_EDITION",
} as const;

interface Props {
  kind: keyof typeof TARGET_KIND;
  classId: string;
  /** The token id, or the edition id for kind "edition". */
  tokenId?: string;
  /** Hide records for this target, from hide_records_by_target. */
  records: HideRecord[];
  /** Whether the target is currently hidden (status HIDDEN). */
  hidden: boolean;
  /** Who may appeal: the class owner (class or edition hide) or the token holder (token hide). */
  appellant: string | null;
  onChanged: () => void;
}

/**
 * Sentinel and council moderation for one class, token or edition: hide (sentinel or
 * Commons Operations), unhide before appeal, and the owner's appeal through
 * the x/rep jury. The chain picks the authority path itself: an eligible
 * sentinel hides on its bond, otherwise the Commons Operations authority.
 */
export default function ArtifactModeration({ kind, classId, tokenId, records, hidden, appellant, onChanged }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const { isMine } = useMyAliases();
  const isSentinel = useIsEligibleSentinel(address);
  const { isOpsCommitteeMember } = useCommonsCouncil(address);
  const { pending, error, clearError, run } = useTxAction();

  const [hideOpen, setHideOpen] = useState(false);
  const [reason, setReason] = useState<number>(MODERATION_REASONS[0].value);
  const [reasonText, setReasonText] = useState("");
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState("");

  const active = records.find((r) => r.outcome === HideOutcome.PENDING) ?? null;
  const canHide = !!address && (isSentinel || isOpsCommitteeMember);
  const noun = kind;

  const done = async () => {
    invalidateArtifacts();
    onChanged();
  };

  const hide = () =>
    run("hide", async () => {
      if (!address) return;
      const value: MsgHideContent = {
        authority: address,
        targetKind: hideTargetKindFromJSON(TARGET_KIND[kind]),
        classId: BigInt(classId),
        tokenId: BigInt(kind === "class" ? "0" : tokenId || "0"),
        reason: reason as ModerationReason,
        reasonText: reasonText.trim(),
      };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.HideContent, value }]);
      setHideOpen(false);
      setReasonText("");
      await done();
    }, txFailure("Hide failed"));

  const unhide = (hideId: string) =>
    run("unhide", async () => {
      if (!address) return;
      const value: MsgUnhideContent = { authority: address, hideId: BigInt(hideId) };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.UnhideContent, value }]);
      await done();
    }, txFailure("Unhide failed"));

  const appeal = (hideId: string) =>
    run("appeal", async () => {
      if (!address) return;
      const value: MsgAppealHide = { appellant: address, hideId: BigInt(hideId), reason: appealReason.trim() };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.AppealHide, value }]);
      setAppealOpen(false);
      setAppealReason("");
      await done();
    }, txFailure("Appeal failed"));

  if (!active && !(canHide && !hidden)) return null;

  return (
    <div className="mt-3 space-y-2">
      {active && (
        <div className="rounded-lg border border-red-800/50 bg-red-900/15 px-3 py-2 text-xs text-red-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              This {noun} was hidden {active.sentinel ? "by a sentinel" : "by the council"}
              {active.reason && <> for {(MODERATION_REASON_LABELS[active.reason] || active.reason).toLowerCase()}</>}
              {active.reason_text ? `: ${active.reason_text}` : "."}
              {active.hidden_at && (
                <span className="text-red-400/70">
                  {" "}Hidden <BlockTime height={active.hidden_at} relative />.
                </span>
              )}
              {active.appealed && <span className="ml-1 text-amber-300">Appeal in progress.</span>}
            </span>
            <span className="flex shrink-0 gap-2">
              {!active.appealed && address && (isMine(active.sentinel) || isOpsCommitteeMember) && (
                <button
                  onClick={() => unhide(active.id)}
                  disabled={pending === "unhide"}
                  title={isMine(active.sentinel) ? "Undo your hide while the self-correct window is open" : "Unhide as the Commons Operations Committee"}
                  className="rounded-md border border-zinc-600 px-2.5 py-1 font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                >
                  {pending === "unhide" ? "Unhiding…" : "Unhide"}
                </button>
              )}
              {!active.appealed && address && isMine(appellant) && (
                <button
                  onClick={() => setAppealOpen((v) => !v)}
                  className="rounded-md border border-red-700/60 px-2.5 py-1 font-medium text-red-200 hover:bg-red-900/30"
                >
                  {appealOpen ? "Cancel" : "Appeal"}
                </button>
              )}
            </span>
          </div>
          {appealOpen && (
            <div className="mt-2 space-y-2">
              <p className="text-zinc-400">
                A jury reviews the appeal. Filing it takes the standard appeal bond, refunded if you win.
                If nobody appeals before the deadline, the {noun}&apos;s content is removed for good.{" "}
                {kind === "edition" ? "Units stay with their holders either way." : "You keep the token either way."}
              </p>
              <input
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                placeholder="Why should this be restored? (optional)"
                maxLength={256}
                className={fieldCls}
              />
              <button
                onClick={() => appeal(active.id)}
                disabled={pending === "appeal"}
                className="rounded-md border border-red-700/60 px-3 py-1.5 font-medium text-red-200 hover:bg-red-900/30 disabled:opacity-50"
              >
                {pending === "appeal" ? "Appealing…" : "File appeal"}
              </button>
            </div>
          )}
        </div>
      )}

      {!active && canHide && !hidden && (
        <div>
          {!hideOpen ? (
            <button
              onClick={() => setHideOpen(true)}
              className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-700 hover:bg-red-900/20"
              title={isSentinel ? "Hide as a sentinel. This commits part of your sentinel bond." : "Hide as the Commons Operations Committee"}
            >
              Hide {noun}
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <p className="text-xs text-zinc-400">
                {isSentinel
                  ? "You're acting as a sentinel. This commits part of your sentinel bond, and you can undo it within the self-correct window."
                  : "You're acting as the Commons Operations Committee. No bond is committed."}
                {" "}Ownership doesn&apos;t change. Only the content is withheld.
              </p>
              <select value={reason} onChange={(e) => setReason(Number(e.target.value))} className="sd-select">
                {MODERATION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <input
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Detail (optional)"
                maxLength={256}
                className={fieldCls}
              />
              <div className="flex gap-2">
                <button
                  onClick={hide}
                  disabled={pending === "hide"}
                  className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 hover:border-red-700 hover:bg-red-900/20 disabled:opacity-50"
                >
                  {pending === "hide" ? "Hiding…" : "Confirm hide"}
                </button>
                <button onClick={() => setHideOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-300">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}
