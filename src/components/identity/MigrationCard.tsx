"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { RepIdentityMsgTypeUrls } from "@/lib/tx";
import { acceptDeadline, pathDelay, type MigrationParams } from "@/lib/migration";
import { formatDurationApprox, formatSpark } from "@/lib/utils";
import type { MemberMigration } from "@/types/rep";
import { MIGRATION_PATH_LABELS, MIGRATION_STATUS_LABELS, MigrationPath, MigrationStatus } from "@/types/rep";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import { INPUT_CLASS } from "@/components/permissions/fields";
import FundAddressHint from "./FundAddressHint";
import { Deadline, Panel } from "./shared";

/**
 * One pending migration, seen from the old address ("from") or the new one
 * ("to"), with the actions the chain allows that side: the new address
 * accepts; either side cancels a KEY migration (only governance cancels a
 * recovery, only the committee or governance a committee migration); the old
 * address objects to an accepted committee migration.
 */
export default function MigrationCard({
  migration: m,
  side,
  params,
  nowMs,
  disabled,
  onChanged,
}: {
  migration: MemberMigration;
  side: "from" | "to";
  params: MigrationParams;
  nowMs: number;
  /** Session mode: show state, hide actions. */
  disabled?: boolean;
  onChanged: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const tx = useTxAction();
  const [objecting, setObjecting] = useState(false);
  const [reason, setReason] = useState("");

  const id = BigInt(m.id);
  const isKey = m.path === MigrationPath.KEY;
  const isRecovery = m.path === MigrationPath.RECOVERY;
  const isCouncil = m.path === MigrationPath.COUNCIL;
  const requested = m.status === MigrationStatus.REQUESTED;
  const accepted = m.status === MigrationStatus.ACCEPTED;

  const accept = () =>
    tx.run("accept", async () => {
      await signAndBroadcast([
        { typeUrl: RepIdentityMsgTypeUrls.AcceptMigration, value: { newAddress: signerAddress, migrationId: id } },
      ]);
      onChanged();
    });

  const cancel = () => {
    if (!confirm("Cancel this migration? The membership stays where it is.")) return;
    void tx.run("cancel", async () => {
      await signAndBroadcast([
        { typeUrl: RepIdentityMsgTypeUrls.CancelMigration, value: { signer: signerAddress, migrationId: id } },
      ]);
      onChanged();
    });
  };

  const object = () =>
    tx.run("object", async () => {
      if (!reason.trim()) throw new Error("Say why you object, for the jury");
      await signAndBroadcast([
        {
          typeUrl: RepIdentityMsgTypeUrls.ObjectMigration,
          value: { member: signerAddress, migrationId: id, reason: reason.trim() },
        },
      ]);
      setObjecting(false);
      onChanged();
    });

  const title =
    side === "to"
      ? `A membership is moving to this address (${MIGRATION_PATH_LABELS[m.path ?? ""] ?? m.path})`
      : `Your membership is moving (${MIGRATION_PATH_LABELS[m.path ?? ""] ?? m.path})`;

  return (
    <Panel title={title} tone={side === "from" && !isKey ? "warn" : undefined}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-zinc-500">From</dt>
          <dd><CopyableAddress address={m.from_address} className="font-mono text-zinc-300" /></dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">To</dt>
          <dd><CopyableAddress address={m.to_address} className="font-mono text-zinc-300" /></dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Status</dt>
          <dd className="text-zinc-300">{MIGRATION_STATUS_LABELS[m.status ?? ""] ?? m.status}</dd>
        </div>
        {requested && (
          <div>
            <dt className="text-xs text-zinc-500">Accept by</dt>
            <dd className="text-zinc-300"><Deadline at={acceptDeadline(m, params)} nowMs={nowMs} /></dd>
          </div>
        )}
        {accepted && (
          <div>
            <dt className="text-xs text-zinc-500">Moves on</dt>
            <dd className="text-zinc-300"><Deadline at={Number(m.executes_at ?? 0)} nowMs={nowMs} /></dd>
          </div>
        )}
        {m.status === MigrationStatus.OBJECTED && (
          <div>
            <dt className="text-xs text-zinc-500">Jury review</dt>
            <dd className="text-zinc-300">
              #{m.jury_review_id}, bond {formatSpark(m.objection_bond ?? "0")} SPARK
            </dd>
          </div>
        )}
        {m.evidence_uri && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-zinc-500">Committee evidence</dt>
            <dd className="break-all text-zinc-300">
              {/^https?:\/\//.test(m.evidence_uri) ? (
                <a href={m.evidence_uri} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                  {m.evidence_uri}
                </a>
              ) : (
                m.evidence_uri
              )}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4 space-y-2 text-xs text-zinc-400">
        {side === "to" && requested && (
          <p>
            {`Accepting moves the membership here ${formatDurationApprox(pathDelay(params, m.path))} later: reputation, DREAM, trust level, names, roles and council seats.`}
            {!isKey && " The anonymous identity key is cleared and the old address's session keys are revoked, so set them up again from here."}
            {" "}Make sure this is an address you control and intend to keep.
          </p>
        )}
        {side === "from" && requested && isKey && (
          <p>
            Now connect the new address in your wallet and accept on this page. Until it accepts, nothing moves.
          </p>
        )}
        {side === "from" && isRecovery && (
          <p className="text-amber-300">
            A recovery code for this membership was used. If that wasn&apos;t you, only a governance proposal can cancel
            it: raise it with the community now.
          </p>
        )}
        {side === "from" && isCouncil && requested && (
          <p className="text-amber-300">
            The Commons Governance Committee is moving this membership. Once the new address accepts, you can object and
            a jury decides.
          </p>
        )}
        {m.failure_reason && <p>Reason: {m.failure_reason}</p>}
      </div>

      {side === "from" && requested && <FundAddressHint target={m.to_address} />}

      {!disabled && (
        <div className="mt-4 flex flex-wrap gap-2">
          {side === "to" && requested && (
            <button type="button" onClick={accept} disabled={tx.busy} className="sd-btn sd-btn-primary">
              {tx.pending === "accept" ? "Accepting…" : "Accept"}
            </button>
          )}
          {isKey && (requested || accepted) && (
            <button type="button" onClick={cancel} disabled={tx.busy} className="sd-btn sd-btn-secondary">
              {tx.pending === "cancel" ? "Cancelling…" : "Cancel migration"}
            </button>
          )}
          {side === "from" && isCouncil && accepted && !objecting && (
            <button type="button" onClick={() => setObjecting(true)} className="sd-btn sd-btn-secondary">
              Object
            </button>
          )}
        </div>
      )}

      {objecting && !disabled && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-zinc-400">
            Objecting pauses the move and puts it before a jury. You post a bond of{" "}
            {formatSpark(params.objectionBond)}{" "}
            SPARK: refunded if the jury sides with you or can&apos;t decide, paid to the new address if it upholds the move.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why this move is wrong"
            className={INPUT_CLASS}
          />
          <div className="flex gap-2">
            <button type="button" onClick={object} disabled={tx.busy} className="sd-btn sd-btn-primary">
              {tx.pending === "object" ? "Signing…" : "Object and post bond"}
            </button>
            <button type="button" onClick={() => setObjecting(false)} className="sd-btn sd-btn-secondary">
              Back
            </button>
          </div>
        </div>
      )}

      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </Panel>
  );
}
