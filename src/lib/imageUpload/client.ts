// Browser side of member image uploads (see policy.ts): shrink the picture,
// get the member's signed authorisation once per session, send the bytes.

import type { StdSignature } from "@cosmjs/amino";
import { DEFAULT_ARWEAVE_GATEWAY } from "@/lib/storageRules";
import { AUTH_MAX_AGE_MS, uploadAuthMessage } from "./policy";

export interface UploadPolicy {
  enabled: boolean;
  max_bytes: number;
  max_side: number;
  /** Largest full-size file this site keeps for a permanent copy to be made from. 0 when it keeps none. */
  copy_max_bytes: number;
  /** Where ar:// images are read from, with {id} for the Arweave id. */
  arweave_gateway: string;
  /** False when the site's operator has switched permanent copies off. */
  permanent_copies: boolean;
  /** The server's clock (ms) when the policy was sent. */
  server_time?: number;
}

// Permanent copies default to on: a policy that can't be read must not hide
// a chain feature, only this site's own uploads.
const OFF: UploadPolicy = { enabled: false, max_bytes: 0, max_side: 0, copy_max_bytes: 0, arweave_gateway: DEFAULT_ARWEAVE_GATEWAY, permanent_copies: true };

let policyCache: Promise<UploadPolicy> | null = null;
// How far the server's clock is ahead of this browser's, in ms. The server
// judges an authorisation's expiry by its own clock, so the expiry is written
// in server time: a browser clock that is off must not make uploads fail.
let clockOffset = 0;
const serverNow = () => Date.now() + clockOffset;

/** Whether this site takes uploads, and its limits. Off if it can't be read. */
export function loadUploadPolicy(): Promise<UploadPolicy> {
  if (!policyCache) {
    policyCache = fetch("/api/images", { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? (r.json() as Promise<UploadPolicy>) : Promise.reject(new Error("unavailable"))))
      .then((p) => {
        if (typeof p.server_time === "number" && Number.isFinite(p.server_time)) clockOffset = p.server_time - Date.now();
        return { ...OFF, ...p };
      })
      .catch(() => {
        policyCache = null;
        return OFF;
      });
  }
  return policyCache;
}

// ---- Shrinking ------------------------------------------------------------------

// Longest side and quality, tried in order until the result fits. Most
// photos fit at the first or second step.
const STEPS: [side: number, quality: number][] = [
  [1600, 0.82],
  [1600, 0.7],
  [1280, 0.72],
  [1024, 0.7],
  [800, 0.65],
  [640, 0.6],
];

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Re-encode a picture as a still WebP (JPEG where the browser can't write
 * WebP) small enough to store. Drawing it to a canvas also drops its
 * metadata, location included. Throws if the file isn't a picture the browser
 * can read or it can't be made small enough.
 */
export async function shrinkImage(file: Blob, policy: UploadPolicy): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This file isn't a picture this browser can read.");
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    for (const [side, quality] of STEPS) {
      const scale = Math.min(1, Math.min(side, policy.max_side) / longest);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't prepare the picture.");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let blob = await encode(canvas, "image/webp", quality);
      // A browser that can't write WebP hands back a PNG instead.
      if (!blob || blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg", quality);
      if (blob && blob.size <= policy.max_bytes) return blob;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("The picture couldn't be made small enough to upload.");
}

// ---- The signed authorisation ---------------------------------------------------

interface StoredAuth {
  message: string;
  signature: StdSignature;
  expires: number;
}

const authKey = (chainId: string, address: string) => `image-upload-auth:${chainId}:${address}`;

function storedAuth(chainId: string, address: string): StoredAuth | null {
  try {
    const raw = sessionStorage.getItem(authKey(chainId, address));
    const auth = raw ? (JSON.parse(raw) as StoredAuth) : null;
    // Leave a margin so it doesn't lapse while the upload is on its way.
    return auth && auth.expires - serverNow() > 5 * 60 * 1000 ? auth : null;
  } catch {
    return null;
  }
}

export function forgetUploadAuth(chainId: string, address: string): void {
  try {
    sessionStorage.removeItem(authKey(chainId, address));
  } catch {
    // Nothing stored, nothing to forget.
  }
}

/** The member's upload authorisation: asked of the wallet once, then kept for the tab. */
async function uploadAuth(chainId: string, address: string): Promise<StoredAuth> {
  const cached = storedAuth(chainId, address);
  if (cached) return cached;
  if (!window.keplr) throw new Error("Keplr is needed to upload images.");
  // The policy read sets the clock offset; a minute is left for the trip.
  await loadUploadPolicy();
  const expires = serverNow() + AUTH_MAX_AGE_MS - 60_000;
  const message = uploadAuthMessage({ chainId, address, expires: new Date(expires).toISOString() });
  const signature = await window.keplr.signArbitrary(chainId, address, message);
  const auth = { message, signature, expires };
  try {
    sessionStorage.setItem(authKey(chainId, address), JSON.stringify(auth));
  } catch {
    // Storage blocked: the wallet is just asked again next time.
  }
  return auth;
}

async function authHeader(chainId: string, address: string): Promise<string> {
  const auth = await uploadAuth(chainId, address);
  return btoa(
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ message: auth.message, signature: auth.signature })))
  );
}

// ---- Upload ---------------------------------------------------------------------

export interface Uploaded {
  url: string;
  sha256: string;
  used: number;
  quota: number;
}

/**
 * Send bytes that are ready to store for `address`: a dream's image, already
 * shrunk, or with `kind: "copy"` the full-size file a permanent copy is made
 * from, already prepared for the storage profile. The server stores them
 * only once a content scanner has cleared them, so this can take several
 * seconds. Throws an Error whose message can be shown to the member.
 */
export async function uploadBlob(
  blob: Blob,
  opts: { chainId: string; address: string; kind?: "image" | "copy" }
): Promise<Uploaded> {
  const policy = await loadUploadPolicy();
  if (!policy.enabled) throw new Error("Image uploads aren't available on this site.");
  const send = async () => {
    const header = await authHeader(opts.chainId, opts.address);
    return fetch(opts.kind === "copy" ? "/api/images?kind=copy" : "/api/images", {
      method: "POST",
      headers: { "content-type": blob.type || "application/octet-stream", "x-upload-auth": header },
      body: blob,
      signal: AbortSignal.timeout(120_000),
    });
  };
  let res: Response;
  try {
    res = await send();
    if (res.status === 401) {
      // A stale or rejected authorisation: sign a fresh one, once.
      forgetUploadAuth(opts.chainId, opts.address);
      res = await send();
    }
  } catch (err) {
    if (err instanceof Error && /reject|denied|cancel/i.test(err.message)) throw new Error("The upload wasn't signed.");
    throw new Error("The upload didn't go through. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as Partial<Uploaded> & { message?: string };
  if (!res.ok || !body.url) throw new Error(body.message || "The upload didn't go through. Try again later.");
  return body as Uploaded;
}

/** Shrink a picture to a small still WebP and upload it for `address`. */
export async function uploadImage(file: Blob, opts: { chainId: string; address: string }): Promise<Uploaded> {
  const policy = await loadUploadPolicy();
  if (!policy.enabled) throw new Error("Image uploads aren't available on this site.");
  return uploadBlob(await shrinkImage(file, policy), opts);
}
