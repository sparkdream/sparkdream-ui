/* eslint-disable @typescript-eslint/no-explicit-any */
// Delete a snapshot everywhere: removes the local directory (if present),
// removes the bucket prefix (if the entry is remote), removes the entry from
// manifests.json, and re-uploads manifests.json to the bucket so the
// production frontend stops listing it.
//
// Env vars: same as snapshot-upload (only required when the entry is remote
// or when any remote entry remains in manifests.json — in that case we need
// to re-upload manifests.json):
//   S3_ENDPOINT, S3_REGION (optional, default us-west-2), S3_BUCKET,
//   S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_BASE
//
// Usage:
//   npm run snapshot:delete -- --id <snapshotId>

import { readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { argv, env, exit, cwd } from "node:process";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

interface Args {
  id?: string;
}

function parseArgs(): Args {
  const a: Args = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--id") a.id = next();
    else if (t === "--help" || t === "-h") {
      console.log(
        "snapshot-delete --id <snapshotId>\n\n" +
          "Removes the snapshot from disk, from the bucket (if remote), and\n" +
          "from manifests.json (both local and bucket copies).",
      );
      exit(0);
    } else {
      console.error(`Unknown arg: ${t}`);
      exit(2);
    }
  }
  if (!a.id) {
    console.error("Missing --id");
    exit(2);
  }
  return a;
}

const args = parseArgs();
const SNAPSHOT_ID = args.id!;

const ENDPOINT = env.S3_ENDPOINT;
const REGION = env.S3_REGION || "us-west-2";
const BUCKET = env.S3_BUCKET;
const ACCESS_KEY = env.S3_ACCESS_KEY;
const SECRET_KEY = env.S3_SECRET_KEY;
const PUBLIC_BASE = env.S3_PUBLIC_BASE?.replace(/\/$/, "");

function buildClient(): S3Client {
  if (!ENDPOINT || !BUCKET || !ACCESS_KEY || !SECRET_KEY) {
    console.error(
      "Bucket operation requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY.",
    );
    exit(2);
  }
  return new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: true,
  });
}

async function deleteBucketPrefix(prefix: string): Promise<number> {
  const client = buildClient();
  let total = 0;
  let continuationToken: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const contents = list.Contents ?? [];
    if (contents.length > 0) {
      // DeleteObjects accepts up to 1000 keys per call.
      for (let i = 0; i < contents.length; i += 1000) {
        const batch = contents.slice(i, i + 1000);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: {
              Objects: batch.map((o) => ({ Key: o.Key! })),
              Quiet: true,
            },
          }),
        );
        total += batch.length;
      }
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  return total;
}

async function uploadManifest(localPath: string): Promise<void> {
  if (!PUBLIC_BASE) {
    console.error("Missing S3_PUBLIC_BASE — cannot upload manifests.json.");
    exit(2);
  }
  const client = buildClient();
  const body = await readFile(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: "manifests.json",
      Body: body,
      ContentType: "application/json",
      CacheControl: "public, max-age=60",
    }),
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const archiveDir = join(cwd(), "public", "archive");
  const snapshotDir = join(archiveDir, SNAPSHOT_ID);
  const manifestPath = join(archiveDir, "manifests.json");

  let manifest: { snapshots: any[] } = { snapshots: [] };
  if (await pathExists(manifestPath)) {
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      manifest = { snapshots: [] };
    }
  }
  const entry = manifest.snapshots.find((s) => s.id === SNAPSHOT_ID);
  const wasRemote = entry?.location === "remote";

  // 1. Remove local files.
  if (await pathExists(snapshotDir)) {
    await rm(snapshotDir, { recursive: true, force: true });
    console.log(`Removed local directory ${snapshotDir}`);
  } else {
    console.log("No local directory to remove.");
  }

  // 2. Remove bucket prefix (if remote — or always, in case of orphaned data).
  if (wasRemote) {
    const removed = await deleteBucketPrefix(`${SNAPSHOT_ID}/`);
    console.log(`Removed ${removed} object(s) from bucket prefix ${SNAPSHOT_ID}/`);
  } else if (entry) {
    console.log("Entry is local-only; skipping bucket cleanup.");
  } else {
    // No entry in manifest, but the user may have asked us to clean up an
    // orphaned bucket prefix. Try, but quietly skip if creds aren't set.
    if (ENDPOINT && BUCKET && ACCESS_KEY && SECRET_KEY) {
      const removed = await deleteBucketPrefix(`${SNAPSHOT_ID}/`);
      if (removed > 0) {
        console.log(
          `Removed ${removed} orphaned object(s) from bucket prefix ${SNAPSHOT_ID}/`,
        );
      }
    }
  }

  // 3. Drop the entry from manifests.json.
  if (entry) {
    manifest.snapshots = manifest.snapshots.filter((s) => s.id !== SNAPSHOT_ID);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("Removed entry from local manifests.json.");
  } else {
    console.log(`No manifests.json entry for ${SNAPSHOT_ID}.`);
  }

  // 4. Re-upload manifests.json if any remote entries remain (or if we just
  // deleted a remote entry — production needs to stop listing it).
  const stillHasRemote = manifest.snapshots.some((s) => s.location === "remote");
  if (wasRemote || stillHasRemote) {
    await uploadManifest(manifestPath);
    console.log("Re-uploaded manifests.json to bucket.");
  }

  console.log(`\nDone. Snapshot ${SNAPSHOT_ID} purged.`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
