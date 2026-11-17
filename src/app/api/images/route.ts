import { NextRequest, NextResponse } from "next/server";
import { acceptUpload, publicPolicy, uploadConfig } from "@/lib/imageUpload/server";
import type { SignedUploadAuth } from "@/lib/imageUpload/auth";

// Member image uploads (lib/imageUpload/policy.ts).
//
//   GET   the upload policy: whether uploads are on, and the size limits
//   POST  one image as the raw request body, with the member's signed upload
//         authorisation (base64 JSON) in the X-Upload-Auth header. With
//         ?kind=copy the body is the full-size file a permanent copy is made
//         from, which has its own size limit and is kept only until the
//         request for it closes.
//
// The image is stored only after a content scanner has cleared its bytes.
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  return NextResponse.json(publicPolicy(uploadConfig(), process.env), { headers: noStore });
}

export async function POST(request: NextRequest) {
  const fail = (status: number, message: string) =>
    NextResponse.json({ code: status, message }, { status, headers: noStore });
  const cfg = uploadConfig();
  if (!cfg) return fail(503, "Image uploads aren't available on this site.");

  let auth: SignedUploadAuth;
  try {
    auth = JSON.parse(Buffer.from(request.headers.get("x-upload-auth") || "", "base64").toString("utf8"));
  } catch {
    return fail(401, "Your upload permission is missing. Try again to sign one.");
  }

  // Refuse an oversized body from its declared length, then again while
  // reading, so a wrong or missing length can't make the server buffer it.
  const kind = request.nextUrl.searchParams.get("kind") === "copy" ? "copy" : "image";
  const limit = kind === "copy" ? cfg.copyMaxBytes : cfg.maxBytes;
  const tooLarge = () => fail(413, `The image is larger than ${Math.round(limit / 1000)} kB.`);
  if (Number(request.headers.get("content-length") || 0) > limit) return tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) return fail(400, "The file is empty.");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }

  const out = await acceptUpload(cfg, auth, bytes, new Date(), kind);
  if (!out.ok) return fail(out.status, out.message);
  return NextResponse.json({ url: out.url, sha256: out.sha256, used: out.used, quota: out.quota }, { headers: noStore });
}
