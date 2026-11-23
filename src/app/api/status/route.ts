import { NextResponse } from "next/server";
import { getSiteStatus } from "@/lib/siteStatus";
import type { SiteStatusResponse } from "@/lib/serviceStatus";

// Health of the services behind this site other than the chain node, for the
// /status page (lib/siteStatus.ts). Checks are shared and cached for a few
// seconds server-side, so polling this can't be used to hammer them.
export const dynamic = "force-dynamic";

export async function GET() {
  const { generatedAt, services } = await getSiteStatus();
  const body: SiteStatusResponse = {
    v: 1,
    generated_at: new Date(generatedAt).toISOString(),
    services,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
