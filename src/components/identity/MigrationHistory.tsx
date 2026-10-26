"use client";

import { formatTime, truncateAddress } from "@/lib/utils";
import type { MemberMigration } from "@/types/rep";
import { MIGRATION_PATH_LABELS, MIGRATION_STATUS_LABELS } from "@/types/rep";
import { Panel } from "./shared";

/** Every migration touching the address, newest first. *_at fields are unix seconds. */
export default function MigrationHistory({ migrations }: { migrations: MemberMigration[] }) {
  if (migrations.length === 0) return null;
  return (
    <Panel title="Migration history">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-normal">#</th>
              <th className="py-1 pr-3 font-normal">Kind</th>
              <th className="py-1 pr-3 font-normal">From</th>
              <th className="py-1 pr-3 font-normal">To</th>
              <th className="py-1 pr-3 font-normal">Status</th>
              <th className="py-1 font-normal">When</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {migrations.map((m) => (
              <tr key={m.id} className="border-t border-zinc-800 align-top">
                <td className="py-1.5 pr-3">{m.id}</td>
                <td className="py-1.5 pr-3">{MIGRATION_PATH_LABELS[m.path ?? ""] ?? m.path}</td>
                <td className="py-1.5 pr-3 font-mono" title={m.from_address}>{truncateAddress(m.from_address)}</td>
                <td className="py-1.5 pr-3 font-mono" title={m.to_address}>{truncateAddress(m.to_address)}</td>
                <td className="py-1.5 pr-3">
                  {MIGRATION_STATUS_LABELS[m.status ?? ""] ?? m.status}
                  {m.failure_reason && <div className="text-zinc-500">{m.failure_reason}</div>}
                </td>
                <td className="py-1.5">{formatTime(m.finalized_at && m.finalized_at !== "0" ? m.finalized_at : m.requested_at ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
