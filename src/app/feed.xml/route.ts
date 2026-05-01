import { NextRequest, NextResponse } from "next/server";
import {
  listPosts,
  listGovProposals,
  listFutarchyMarkets,
  listContributions,
} from "@/lib/api";
import { defaults } from "@/lib/chain";
import { buildRssFeed, type FeedItem } from "@/lib/rss";
import { PostStatus } from "@/types/blog";

export const dynamic = "force-dynamic";
// 60s edge cache so feed readers polling every minute don't hammer the LCD.
export const revalidate = 60;

function truncate(s: string, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const feedUrl = `${origin}/feed.xml`;

  // Fetch the four streams in parallel; each is best-effort so a single
  // slow/down endpoint doesn't black out the feed.
  const [postsRes, govRes, marketsRes, contribRes] = await Promise.all([
    listPosts({ limit: "30", reverse: true }).catch(() => null),
    listGovProposals(undefined, { limit: "20", reverse: true }).catch(() => null),
    listFutarchyMarkets({ limit: "20", reverse: true }).catch(() => null),
    listContributions({ limit: "20", reverse: true }).catch(() => null),
  ]);

  const items: FeedItem[] = [];

  for (const p of postsRes?.post || []) {
    if (p.status === PostStatus.DELETED || p.status === PostStatus.HIDDEN) continue;
    items.push({
      id: `sparkdream:post:${p.id}`,
      title: p.title || `Dream #${p.id}`,
      link: `${origin}/imaginarium/${p.id}`,
      description: truncate(p.body || "", 600),
      pubDate: p.created_at,
      author: p.creator,
      categories: ["Imaginarium", ...(p.tags || [])],
    });
  }

  for (const pr of govRes?.proposals || []) {
    items.push({
      id: `sparkdream:gov-proposal:${pr.id}`,
      title: pr.title ? `Proposal #${pr.id}: ${pr.title}` : `Proposal #${pr.id}`,
      link: `${origin}/governance`,
      description: truncate(pr.summary || "", 600),
      pubDate: pr.submit_time,
      author: pr.proposer,
      categories: ["Governance", `Status: ${pr.status}`],
    });
  }

  for (const m of marketsRes?.market || []) {
    // Markets don't expose a created_at; we omit pubDate so readers fall back
    // to the build date, which keeps them visible without lying about timing.
    items.push({
      id: `sparkdream:futarchy-market:${m.index}`,
      title: m.question
        ? `Market: ${m.question}`
        : `Futarchy market #${m.index}`,
      link: `${origin}/futarchy`,
      description: truncate(
        `${m.question || ""}${m.symbol ? ` (${m.symbol})` : ""}`,
        600
      ),
      author: m.creator,
      categories: ["Futarchy", `Status: ${m.status}`],
    });
  }

  for (const c of contribRes?.contributions || []) {
    items.push({
      id: `sparkdream:reveal-contribution:${c.id}`,
      title: c.project_name
        ? `Reveal: ${c.project_name}`
        : `Reveal contribution #${c.id}`,
      link: `${origin}/reveal`,
      description: truncate(c.description || "", 600),
      pubDate: c.created_at,
      author: c.contributor,
      categories: ["Reveal", `Status: ${c.status}`],
    });
  }

  // Sort newest first; items without a pubDate sink to the bottom.
  items.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate as string).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate as string).getTime() : 0;
    return tb - ta;
  });

  const xml = buildRssFeed(
    {
      title: `${defaults.chainName} — onchain updates`,
      link: origin,
      feedUrl,
      description: `Recent onchain activity on ${defaults.chainName}: dreams, governance proposals, futarchy markets, and reveal contributions.`,
    },
    items.slice(0, 50)
  );

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
