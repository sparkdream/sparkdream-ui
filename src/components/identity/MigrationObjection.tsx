"use client";

import CopyableAddress from "@/components/CopyableAddress";

/** JuryReview.challenger_claim of a review opened by MsgObjectMigration. */
export const MIGRATION_OBJECTION_CLAIM = "member_migration_objection";

export interface MigrationObjectionPayload {
  migration_id: string;
  from: string;
  to: string;
  reason: string;
}

/** Reads the review_deliverable JSON the chain writes for an objection, or null. */
export function parseMigrationObjection(claim: string | undefined, deliverable: string | undefined): MigrationObjectionPayload | null {
  if (claim !== MIGRATION_OBJECTION_CLAIM || !deliverable) return null;
  try {
    const p = JSON.parse(deliverable) as Record<string, unknown>;
    return {
      migration_id: String(p.migration_id ?? ""),
      from: String(p.from ?? ""),
      to: String(p.to ?? ""),
      reason: String(p.reason ?? ""),
    };
  } catch {
    return null;
  }
}

/** Jury-facing summary: the member (from) objects to a committee moving their membership to `to`. */
export default function MigrationObjectionSummary({ objection }: { objection: MigrationObjectionPayload }) {
  return (
    <div className="mt-1 space-y-1 text-xs text-zinc-400">
      <p>
        The Commons Governance Committee voted to move the membership at{" "}
        <CopyableAddress address={objection.from} className="font-mono text-zinc-300" /> to{" "}
        <CopyableAddress address={objection.to} className="font-mono text-zinc-300" /> (migration #
        {objection.migration_id}). The member objects.
      </p>
      {objection.reason && (
        <blockquote className="border-l-2 border-zinc-700 pl-2 text-zinc-300">{objection.reason}</blockquote>
      )}
      <p className="text-zinc-500">
        Upholding the objection stops the move and refunds the member&apos;s bond. Rejecting it lets the move go ahead
        and pays the bond to the new address. Inconclusive stops the move.
      </p>
    </div>
  );
}
