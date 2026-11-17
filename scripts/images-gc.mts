// Clean up the member image bucket (src/lib/imageUpload).
//
// An uploaded image is kept once something on chain shows it: the content
// scanners then publish a verdict for its bytes. This script deletes
//
//   - images no scanner has ever seen on chain, once they are older than
//     --min-age-hours (uploaded but never published);
//   - images a scanner's latest verdict marks "removed" (the site hides an
//     image any trusted scanner has removed, so one is enough; a scanner
//     that later clears the image takes its own removal back);
//   - full-size files kept for a permanent copy to be made from (src/), once
//     no open request needs them: the copy was made and settled, the request
//     closed, or none was ever sent. This needs LCD_ENDPOINT; without it
//     they are left alone;
//   - quota markers from weeks that are over.
//
// It does not yet delete an image when the dream that showed it expires or
// is deleted: the verdict feed is append-only, so it can't tell.
//
// It only lists what it would delete unless --delete is given.
//
// Env: IMAGE_S3_BUCKET (required); IMAGE_S3_ENDPOINT, IMAGE_S3_REGION,
// IMAGE_S3_ACCESS_KEY, IMAGE_S3_SECRET_KEY (each falling back to S3_*);
// IMAGE_GC_FEED_URL: one or more scanner feed roots, comma separated
// (e.g. https://scan.example.com/); LCD_ENDPOINT: the chain's REST address,
// so an image that an open permanent-copy request still needs is kept
// (without it that check is skipped, and the script says so).
//
// Usage:
//   npm run images:gc                          # dry run
//   npm run images:gc -- --delete              # delete
//   npm run images:gc -- --min-age-hours 72

import { argv, env, exit } from "node:process";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

let doDelete = false;
let minAgeHours = 48;
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === "--delete") doDelete = true;
  else if (argv[i] === "--min-age-hours") minAgeHours = Number(argv[++i]);
  else {
    console.error("images-gc [--delete] [--min-age-hours N]");
    exit(argv[i] === "--help" || argv[i] === "-h" ? 0 : 2);
  }
}
if (!Number.isFinite(minAgeHours) || minAgeHours < 1) {
  console.error("--min-age-hours must be at least 1");
  exit(2);
}

const ENDPOINT = env.IMAGE_S3_ENDPOINT || env.S3_ENDPOINT;
const BUCKET = env.IMAGE_S3_BUCKET;
const ACCESS_KEY = env.IMAGE_S3_ACCESS_KEY || env.S3_ACCESS_KEY;
const SECRET_KEY = env.IMAGE_S3_SECRET_KEY || env.S3_SECRET_KEY;
const FEEDS = (env.IMAGE_GC_FEED_URL || "").split(/[\s,]+/).filter(Boolean);
const LCD = (env.LCD_ENDPOINT || "").replace(/\/+$/, "");
if (!ENDPOINT || !BUCKET || !ACCESS_KEY || !SECRET_KEY || FEEDS.length === 0) {
  console.error(
    "Missing env. Required: IMAGE_S3_BUCKET, IMAGE_GC_FEED_URL, and IMAGE_S3_ENDPOINT / IMAGE_S3_ACCESS_KEY / IMAGE_S3_SECRET_KEY (or S3_*).",
  );
  exit(2);
}

const client = new S3Client({
  endpoint: ENDPOINT,
  region: env.IMAGE_S3_REGION || env.S3_REGION || "us-west-2",
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

// ---- What the scanners have seen ------------------------------------------------

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

const seen = new Set<string>(); // sha256 some scanner has a verdict for
const removed = new Set<string>(); // sha256 some scanner's latest verdict removes
for (const feed of FEEDS) {
  // A feed is append-only and in order, so a later line for the same file
  // replaces the scanner's earlier verdict.
  const latest = new Map<string, string>();
  const root = feed.replace(/\/+$/, "");
  const manifest = (await (await get(`${root}/manifest.json`)).json()) as { latest_segment?: number };
  // A feed that can't be read in full stops the run: deleting on a partial
  // view would take images that are in use.
  for (let n = 1; n <= (manifest.latest_segment || 1); n++) {
    const res = await fetch(`${root}/segments/${String(n).padStart(6, "0")}.jsonl`, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 404 && n === 1) break; // a feed with no verdicts yet
    if (!res.ok) throw new Error(`${root} segment ${n}: ${res.status}`);
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      const a = JSON.parse(line) as { verdict?: string; subject?: { sha256?: string } };
      const sha = a.subject?.sha256?.toLowerCase();
      if (!sha) continue;
      latest.set(sha, a.verdict || "");
    }
  }
  for (const [sha, verdict] of latest) {
    seen.add(sha);
    if (verdict === "removed") removed.add(sha);
  }
}

// ---- What is in the bucket ------------------------------------------------------

async function list(prefix: string): Promise<{ key: string; modified: Date; size: number }[]> {
  const out: { key: string; modified: Date; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents || []) {
      if (o.Key && o.LastModified) out.push({ key: o.Key, modified: o.LastModified, size: o.Size || 0 });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

if (!LCD) {
  console.warn(
    "LCD_ENDPOINT is not set: images waiting for a permanent copy are not protected, and full-size copy files (src/) are not cleaned up.",
  );
}
const now = Date.now();
const cutoff = now - minAgeHours * 60 * 60 * 1000;
const thisWeek = Math.floor(now / (7 * 24 * 60 * 60 * 1000));
const doomed: { key: string; why: string; size: number }[] = [];

// An image a permanent-copy request names as a source stays while the
// request is open: the operator still has to fetch it from here. Asked of
// the chain only for images that would otherwise be deleted.
const backends: string[] = [];
if (LCD) {
  const res = (await (await get(`${LCD}/sparkdream/storage/v1/backends`)).json()) as { backends?: { name?: string }[] };
  for (const b of res.backends || []) if (b.name) backends.push(b.name);
}
const OPEN = new Set(["REQUEST_STATUS_PENDING", "REQUEST_STATUS_CLAIMED", "REQUEST_STATUS_COMPLETED"]);
async function copyIsOpen(sha: string): Promise<boolean> {
  for (const backend of backends) {
    const res = await fetch(`${LCD}/sparkdream/storage/v1/request_by_hash/${encodeURIComponent(backend)}/${sha}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404 || res.status === 501) continue; // no request for it
    // An answer that can't be read stops the run, like a feed that can't.
    if (!res.ok) throw new Error(`${backend} request for ${sha}: ${res.status}`);
    const { request } = (await res.json()) as { request?: { status?: string } };
    if (request?.status && OPEN.has(request.status)) return true;
  }
  return false;
}

for (const o of await list("img/")) {
  const sha = /^img\/([0-9a-f]{64})\.[a-z]+$/.exec(o.key)?.[1];
  if (!sha) continue; // not ours: leave it
  if (removed.has(sha)) doomed.push({ key: o.key, why: "removed by a scanner", size: o.size });
  else if (!seen.has(sha) && o.modified.getTime() < cutoff && !(await copyIsOpen(sha))) {
    doomed.push({ key: o.key, why: `never published (uploaded ${o.modified.toISOString()})`, size: o.size });
  }
}
for (const o of await list("src/")) {
  const sha = /^src\/([0-9a-f]{64})\.[a-z]+$/.exec(o.key)?.[1];
  if (!sha) continue;
  if (removed.has(sha)) doomed.push({ key: o.key, why: "removed by a scanner", size: o.size });
  // Whether a request still needs the file is only known from the chain.
  else if (LCD && o.modified.getTime() < cutoff && !(await copyIsOpen(sha))) {
    doomed.push({ key: o.key, why: "no open permanent-copy request needs it", size: o.size });
  }
}
for (const prefix of ["quota/", "srcquota/"]) {
  for (const o of await list(prefix)) {
    const week = Number(/^(?:src)?quota\/(\d+)\//.exec(o.key)?.[1]);
    // Keep last week's too, in case a clock is slightly off.
    if (Number.isFinite(week) && week < thisWeek - 1) doomed.push({ key: o.key, why: "quota marker of a past week", size: o.size });
  }
}

for (const d of doomed) console.log(`${doDelete ? "delete" : "would delete"}  ${d.key}  (${d.why})`);
const bytes = doomed.reduce((n, d) => n + d.size, 0);
console.log(`${doomed.length} objects, ${(bytes / 1000).toFixed(0)} kB${doDelete ? "" : ". Dry run: pass --delete to remove them."}`);

if (doDelete) {
  // The storage answers 200 even when it could not delete some keys, and
  // lists those in Errors.
  let failed = 0;
  for (let i = 0; i < doomed.length; i += 500) {
    const res = await client.send(
      new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: doomed.slice(i, i + 500).map((d) => ({ Key: d.key })) } }),
    );
    for (const e of res.Errors || []) {
      failed++;
      console.error(`not deleted  ${e.Key}  (${e.Code || "error"}${e.Message ? `: ${e.Message}` : ""})`);
    }
  }
  console.log(`${doomed.length - failed} deleted${failed ? `, ${failed} could not be deleted` : ""}.`);
  if (failed) exit(1);
}
