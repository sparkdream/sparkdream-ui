"use client";

import Link from "next/link";
import { useArchive } from "@/contexts/ArchiveContext";

export function ArchiveSectionShell({
  snapshotId,
  title,
  children,
}: {
  snapshotId: string;
  title: string;
  children: React.ReactNode;
}) {
  const { entry, manifestReady } = useArchive();
  if (!manifestReady) return <div className="p-6 opacity-70">Loading manifest…</div>;
  if (!entry) {
    return (
      <div className="p-6">
        Snapshot <code className="font-mono">{snapshotId}</code> not found.
      </div>
    );
  }
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <Link
        href={`/archive/${snapshotId}`}
        className="text-sm opacity-70 hover:opacity-100"
      >
        ← back to snapshot
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function EmptyState({ what }: { what: string }) {
  return <p className="opacity-70">No {what} captured in this snapshot.</p>;
}

export function LoadError({ msg }: { msg: string }) {
  return <p className="text-red-400">{msg}</p>;
}
