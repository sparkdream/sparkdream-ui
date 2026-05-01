// RSS 2.0 feed builder. Used by /feed.xml and any future per-module feeds.

const XML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPE[c]);
}

// Strip control characters that are illegal in XML 1.0. Cosmos data is mostly
// user-provided, so be defensive.
export function sanitizeXml(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

export interface FeedItem {
  /** Stable identifier — shows up as <guid isPermaLink="false">. */
  id: string;
  title: string;
  link: string;
  description: string;
  /** Publication date as a Date or ISO string. Falsy values are omitted. */
  pubDate?: Date | string;
  /** Optional category labels (rendered as multiple <category> elements). */
  categories?: string[];
  /** Optional author display string. RSS expects an email; we use dc:creator
      below for free-form author names so this stays empty by default. */
  author?: string;
}

export interface FeedOptions {
  title: string;
  link: string;
  description: string;
  /** Self-referential URL of this feed; required for autodiscovery. */
  feedUrl: string;
  /** Optional language tag — defaults to en. */
  language?: string;
}

function toRfc822(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return date.toUTCString();
}

export function buildRssFeed(opts: FeedOptions, items: FeedItem[]): string {
  const lastBuildDate = new Date().toUTCString();
  const itemsXml = items
    .map((it) => {
      const parts: string[] = [];
      parts.push(`<title>${escapeXml(sanitizeXml(it.title))}</title>`);
      parts.push(`<link>${escapeXml(it.link)}</link>`);
      parts.push(
        `<guid isPermaLink="false">${escapeXml(it.id)}</guid>`
      );
      parts.push(
        `<description>${escapeXml(sanitizeXml(it.description))}</description>`
      );
      if (it.pubDate) {
        const rfc = toRfc822(it.pubDate);
        if (rfc) parts.push(`<pubDate>${rfc}</pubDate>`);
      }
      if (it.author) {
        parts.push(`<dc:creator>${escapeXml(sanitizeXml(it.author))}</dc:creator>`);
      }
      for (const cat of it.categories || []) {
        parts.push(`<category>${escapeXml(sanitizeXml(cat))}</category>`);
      }
      return `<item>${parts.join("")}</item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${escapeXml(opts.title)}</title>
<link>${escapeXml(opts.link)}</link>
<description>${escapeXml(opts.description)}</description>
<language>${escapeXml(opts.language || "en")}</language>
<lastBuildDate>${lastBuildDate}</lastBuildDate>
<atom:link href="${escapeXml(opts.feedUrl)}" rel="self" type="application/rss+xml" />
${itemsXml}
</channel>
</rss>`;
}
