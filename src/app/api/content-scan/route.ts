import { NextRequest, NextResponse } from "next/server";
import { getVerdictIndex, lookup } from "@/lib/contentScan/feedIndex";

// Relays the trusted content scanners' signed verdicts for the subjects a page
// shows: ?record=blog/post/12&record=...&uri=https://... The browser verifies
// every signature and combines the verdicts itself (lib/contentScan/client.ts),
// so this is a relay, like anyone's merged feed (docs/content-scanning.md §5.4).
// With no subjects it returns only the freshness data.
export const dynamic = "force-dynamic";

const MAX_SUBJECTS = 200;

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams;
  const records = [...new Set(qs.getAll("record"))].slice(0, MAX_SUBJECTS);
  const uris = [...new Set(qs.getAll("uri"))].slice(0, MAX_SUBJECTS);
  try {
    const snap = await getVerdictIndex();
    return NextResponse.json(
      {
        v: 1,
        // Same source as /api/config: verdicts naming another chain are ignored.
        chain_id: process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || "",
        generated_at: new Date(snap.generatedAt).toISOString(),
        workers: snap.setup.workers.map((w) => w.address),
        quorum: snap.setup.quorum,
        elevated_quorum: snap.setup.elevatedQuorum,
        heights: snap.heights,
        latest_height: snap.latestHeight,
        max_lag_blocks: snap.maxLagBlocks,
        errors: snap.errors,
        attestations: lookup(snap, records, uris),
      },
      // Short: a removal should reach readers within a minute or so.
      { headers: { "Cache-Control": "public, max-age=30" } }
    );
  } catch (err) {
    return NextResponse.json(
      { code: 503, message: err instanceof Error ? err.message : "Scanner verdicts unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
