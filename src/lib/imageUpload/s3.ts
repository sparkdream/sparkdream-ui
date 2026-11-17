// The little of S3 that image uploads need (put, head, list by prefix), signed
// with AWS Signature Version 4 from node:crypto. Path-style addressing, as
// the snapshot scripts use with the same kind of bucket.

import { createHash, createHmac } from "node:crypto";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

const hex = (b: Buffer) => b.toString("hex");
const sha256Hex = (data: Uint8Array | string) => hex(createHash("sha256").update(data).digest());
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as SigV4 wants it ("/" kept only in paths). */
function encode(s: string, keepSlash = false): string {
  const out = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? out.replace(/%2F/g, "/") : out;
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** Sign one request. `now` is injectable so the signature can be tested. */
export function signS3(
  cfg: S3Config,
  req: { method: string; key?: string; query?: Record<string, string>; body?: Uint8Array; headers?: Record<string, string> },
  now: Date = new Date()
): SignedRequest {
  const endpoint = new URL(cfg.endpoint);
  const path = `/${encode(cfg.bucket)}${req.key ? `/${encode(req.key, true)}` : ""}`;
  const query = Object.entries(req.query || {})
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .sort()
    .join("&");
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(req.body || "");

  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    req.method,
    path,
    query,
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${cfg.secretKey}`, day), cfg.region), "s3"), "aws4_request");
  const signature = hex(hmac(key, toSign));

  const { host: _host, ...sent } = headers;
  void _host;
  return {
    url: `${endpoint.origin}${path}${query ? `?${query}` : ""}`,
    headers: {
      ...sent,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
  };
}

const TIMEOUT_MS = 30_000;

async function send(cfg: S3Config, req: Parameters<typeof signS3>[1]): Promise<Response> {
  const signed = signS3(cfg, req);
  return fetch(signed.url, {
    method: req.method,
    headers: signed.headers,
    body: req.body ? Buffer.from(req.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function putObject(cfg: S3Config, key: string, body: Uint8Array, contentType: string): Promise<void> {
  const res = await send(cfg, { method: "PUT", key, body, headers: { "content-type": contentType } });
  if (!res.ok) throw new Error(`storage refused the file (${res.status})`);
}

export async function objectExists(cfg: S3Config, key: string): Promise<boolean> {
  const res = await send(cfg, { method: "HEAD", key });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`storage did not answer (${res.status})`);
  return true;
}

export async function deleteObject(cfg: S3Config, key: string): Promise<void> {
  const res = await send(cfg, { method: "DELETE", key });
  if (!res.ok && res.status !== 404) throw new Error(`storage did not answer (${res.status})`);
}

/** An object's bytes, or null if there is none. */
export async function getObject(cfg: S3Config, key: string): Promise<Uint8Array | null> {
  const res = await send(cfg, { method: "GET", key });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`storage did not answer (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Keys under a prefix (first page only: callers count small sets). */
export async function listKeys(cfg: S3Config, prefix: string, maxKeys = 1000): Promise<string[]> {
  const res = await send(cfg, { method: "GET", query: { "list-type": "2", prefix, "max-keys": String(maxKeys) } });
  if (!res.ok) throw new Error(`storage did not answer (${res.status})`);
  const xml = await res.text();
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  );
}
