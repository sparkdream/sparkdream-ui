/* eslint-disable @typescript-eslint/no-explicit-any */
// Upload a captured snapshot directory to an S3-compatible bucket (4everland,
// R2, etc.) and rewrite manifests.json so the frontend reads from the bucket
// instead of the local public/archive tree. The remote manifests.json is also
// uploaded so the production frontend can pick it up via
// NEXT_PUBLIC_REMOTE_MANIFEST_URL without a redeploy.
//
// Env vars (all required):
//   S3_ENDPOINT     e.g. https://endpoint.4everland.co
//   S3_REGION       defaults to "us-west-2"
//   S3_BUCKET       bucket name
//   S3_ACCESS_KEY
//   S3_SECRET_KEY
//   S3_PUBLIC_BASE  public URL prefix used in manifests.json,
//                   e.g. https://my-bucket.4everbucket.com
//
// Usage:
//   npm run snapshot:upload -- --id <snapshotId>
//   npm run snapshot:upload -- --id <snapshotId> --concurrency 16

import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, relative, sep, posix } from "node:path";
import { argv, env, exit, cwd } from "node:process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

interface Args {
  id?: string;
  concurrency: number;
}

function parseArgs(): Args {
  const a: Args = { concurrency: 8 };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--id") a.id = next();
    else if (t === "--concurrency") a.concurrency = Number(next());
    else if (t === "--help" || t === "-h") {
      console.log(
        "snapshot-upload --id <snapshotId> [--concurrency 8]\n\n" +
          "Required env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_BASE\n" +
          "Optional env: S3_REGION (default us-west-2)",
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

if (!ENDPOINT || !BUCKET || !ACCESS_KEY || !SECRET_KEY || !PUBLIC_BASE) {
  console.error(
    "Missing env vars. Required: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_BASE",
  );
  exit(2);
}

const client = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

const ARCHIVE_DIR = join(cwd(), "public", "archive");
const SNAPSHOT_DIR = join(ARCHIVE_DIR, SNAPSHOT_ID);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function uploadFile(
  localPath: string,
  bucketKey: string,
  cacheControl: string,
): Promise<void> {
  const body = await readFile(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: bucketKey,
      Body: body,
      ContentType: "application/json",
      CacheControl: cacheControl,
    }),
  );
}

async function main(): Promise<void> {
  try {
    await stat(SNAPSHOT_DIR);
  } catch {
    console.error(`Snapshot directory not found: ${SNAPSHOT_DIR}`);
    exit(1);
  }

  console.log(`Uploading ${SNAPSHOT_ID}`);
  console.log(`  to:        ${ENDPOINT}/${BUCKET}/${SNAPSHOT_ID}/`);
  console.log(`  publicly:  ${PUBLIC_BASE}/${SNAPSHOT_ID}/`);

  const files: { local: string; key: string }[] = [];
  for await (const p of walk(SNAPSHOT_DIR)) {
    // Convert OS-specific separators to forward slashes for the S3 key.
    const rel = relative(SNAPSHOT_DIR, p).split(sep).join(posix.sep);
    files.push({ local: p, key: `${SNAPSHOT_ID}/${rel}` });
  }
  console.log(`  files:     ${files.length}`);

  let done = 0;
  const errors: string[] = [];
  const queue = files.slice();
  const workers = Array.from({ length: Math.max(1, args.concurrency) }, async () => {
    while (queue.length) {
      const f = queue.shift();
      if (!f) return;
      try {
        // Snapshot content is immutable by snapshot-id, so safe to cache long.
        await uploadFile(f.local, f.key, "public, max-age=31536000, immutable");
        done++;
        if (done % 20 === 0 || done === files.length) {
          console.log(`  uploaded ${done}/${files.length}`);
        }
      } catch (err: any) {
        errors.push(`${f.key}: ${err?.message ?? err}`);
      }
    }
  });
  await Promise.all(workers);

  if (errors.length) {
    console.error(`\n${errors.length} upload failures:`);
    for (const e of errors.slice(0, 20)) console.error("  " + e);
    exit(1);
  }

  // Mark the entry remote in the local manifests.json so dev also reads from
  // the bucket (and to keep the on-disk record honest).
  const manifestPath = join(ARCHIVE_DIR, "manifests.json");
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as { snapshots: any[] };
  const entry = manifest.snapshots.find((s) => s.id === SNAPSHOT_ID);
  if (!entry) {
    console.error(`\nNo entry for ${SNAPSHOT_ID} in ${manifestPath}`);
    exit(1);
  }
  entry.location = "remote";
  entry.remoteBase = PUBLIC_BASE;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Upload manifests.json itself — short TTL since this is the index that
  // changes when new snapshots are added.
  await uploadFile(manifestPath, "manifests.json", "public, max-age=60");

  console.log(`\nDone. Snapshot ${SNAPSHOT_ID} is live at ${PUBLIC_BASE}/${SNAPSHOT_ID}/`);
  console.log(
    `Set in Akash SDL:\n  NEXT_PUBLIC_REMOTE_MANIFEST_URL=${PUBLIC_BASE}/manifests.json`,
  );
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
