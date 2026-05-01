import type { Metadata } from "next";
import Link from "next/link";
import { defaults } from "@/lib/chain";
import CopyFeedUrl from "./CopyFeedUrl";

export const metadata: Metadata = {
  title: `RSS feed — ${defaults.chainName}`,
  description: `Subscribe to onchain updates from ${defaults.chainName} via RSS.`,
};

export default function RssPage() {
  return (
    <div className="sd-page">
      <header className="sd-page-header">
        <h1>RSS feed</h1>
        <p>Subscribe to onchain updates without polling the UI.</p>
      </header>
      <section
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "20px 22px",
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          Onchain activity feed
        </h2>
        <p style={{ color: "var(--ink-mute)", fontSize: 14, lineHeight: 1.55, marginBottom: 16 }}>
          Combined recent activity from {defaults.chainName}: new Imaginarium
          dreams, governance proposals, futarchy markets, and reveal
          contributions. Updated every minute.
        </p>
        <CopyFeedUrl path="/feed.xml" />
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "var(--ink-mute)" }}>
          New to RSS?
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>
          RSS is a long-standing standard for following content updates. You
          paste a feed URL into a <em>feed reader</em> app, and it fetches new
          items in the background — no email, no algorithm, no account.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>
          Three ways to try it:
        </p>
        <ol style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 22, marginBottom: 12 }}>
          <li>
            <strong>Browser preview:</strong> open{" "}
            <Link href="/feed.xml" style={{ color: "var(--accent)", textDecoration: "underline" }}>
              /feed.xml
            </Link>{" "}
            directly to see the raw XML the feed serves.
          </li>
          <li>
            <strong>Web reader (zero install):</strong> create a free account
            at a service like <code>feedly.com</code>, <code>inoreader.com</code>,
            or <code>theoldreader.com</code>, then paste the feed URL above.
          </li>
          <li>
            <strong>Native app:</strong> NetNewsWire (macOS/iOS),
            Reeder (Apple), or FeedBro (browser extension) all accept the
            same URL.
          </li>
        </ol>
        <p style={{ fontSize: 13, color: "var(--ink-mute)", lineHeight: 1.6 }}>
          Most readers also auto-discover the feed if you give them this
          site&rsquo;s home page — the autodiscovery link is in every page&rsquo;s
          HTML head.
        </p>
      </section>
    </div>
  );
}
