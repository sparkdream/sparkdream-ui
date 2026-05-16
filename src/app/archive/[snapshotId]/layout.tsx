"use client";

import { use } from "react";
import Link from "next/link";
import { ArchiveProvider, useArchive } from "@/contexts/ArchiveContext";

function ArchiveBanner() {
  const { entry, manifestReady } = useArchive();
  if (!manifestReady) return null;
  if (!entry) {
    return (
      <div className="bg-red-900/40 border-b border-red-700/50 px-4 py-2 text-sm">
        Snapshot not found in manifests.json.
      </div>
    );
  }
  return (
    <div className="bg-amber-900/40 border-b border-amber-700/50 px-4 py-2 text-sm flex items-center justify-between">
      <div>
        <span className="font-mono">{entry.id}</span>
        <span className="opacity-70">
          {" · "}height {entry.capturedHeight}
          {" · "}captured {new Date(entry.capturedAtIso).toLocaleString()}
          {entry.label ? ` · ${entry.label}` : ""}
        </span>
      </div>
      <Link href="/archive" className="opacity-70 hover:opacity-100 underline">
        leave archive
      </Link>
    </div>
  );
}

export default function ArchiveSnapshotLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ snapshotId: string }>;
}) {
  const { snapshotId } = use(params);
  return (
    <ArchiveProvider snapshotId={snapshotId}>
      <ArchiveBanner />
      {children}
    </ArchiveProvider>
  );
}
