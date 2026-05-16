import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ManifestEntry, ManifestFile } from "@/lib/archive";

export const dynamic = "force-dynamic";

// Returns the snapshot manifest reconciled against the filesystem so that
// directories deleted manually disappear from the picker. Remote entries
// in manifests.json are passed through untouched.
export async function GET() {
  const archiveDir = join(process.cwd(), "public", "archive");

  let registry: ManifestFile = { snapshots: [] };
  try {
    const raw = await readFile(join(archiveDir, "manifests.json"), "utf8");
    registry = JSON.parse(raw);
  } catch {
    // No manifests.json yet — empty registry.
  }

  let dirNames = new Set<string>();
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true });
    dirNames = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    // No archive dir — nothing to reconcile.
  }

  const live: ManifestEntry[] = [];
  for (const entry of registry.snapshots) {
    if (entry.location === "remote") {
      live.push(entry);
      continue;
    }
    if (!dirNames.has(entry.id)) continue;
    try {
      await stat(join(archiveDir, entry.id, "manifest.json"));
      live.push(entry);
    } catch {
      // Dir exists but manifest.json is gone — treat as dead.
    }
  }

  return NextResponse.json({ snapshots: live });
}
