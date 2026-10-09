import type { Metadata } from "next";
import Link from "next/link";
import { defaults } from "@/lib/chain";
import Dedication from "./Dedication";

export const metadata: Metadata = {
  title: `Open content (CC0) — ${defaults.chainName}`,
  description: `Everything published on ${defaults.chainName} is dedicated to the public domain under CC0 1.0.`,
};

const section = { marginBottom: 28 } as const;
const h2 = { fontSize: 16, fontWeight: 600, marginBottom: 10 } as const;
const p = { fontSize: 14, lineHeight: 1.65, marginBottom: 12, color: "var(--ink-soft)" } as const;
const list = { fontSize: 14, lineHeight: 1.7, paddingLeft: 22, marginBottom: 12, color: "var(--ink-soft)", listStyle: "disc" } as const;
const link = { color: "var(--violet-hi)", textDecoration: "underline" } as const;

export default function LicensePage() {
  return (
    <div className="sd-page" style={{ maxWidth: 760 }}>
      <header className="sd-page-header">
        <h1>Everything here is public domain</h1>
        <p>
          Every dream, post, reply, collection, profile and proposal on {defaults.chainName} is dedicated to the
          public domain under CC0 1.0. Anyone may copy, adapt, translate, sell or build on any of it, for any
          purpose, without asking.
        </p>
      </header>

      <section style={section}>
        <h2 style={h2}>What you agree to</h2>
        <Dedication />
        <ul style={{ ...list, marginTop: 14 }}>
          <li>
            <strong>Only post what you have the right to give away.</strong> Your own words, images and code are
            fine. Someone else&rsquo;s copyrighted work is not yours to dedicate, even with credit. Link to it
            instead of copying it in.
          </li>
          <li>
            <strong>It covers everything you publish,</strong> anonymous posts included. A collection item that
            points at an NFT or a web page dedicates what you wrote about it, not the work it points at.
          </li>
          <li>
            <strong>It can&rsquo;t be taken back.</strong> CC0 is irrevocable, and a committed block is permanent.
            Editing or deleting a post doesn&rsquo;t withdraw earlier versions.
          </li>
          <li>
            <strong>Credit is a courtesy, not a condition.</strong> The chain records who wrote what and this app
            shows it; reusers are encouraged, not required, to say where something came from.
          </li>
          <li>
            <strong>Moderation is separate.</strong> Sentinels and councils can still hide content that breaks
            community rules, including work posted without the right to dedicate it.
          </li>
        </ul>
        <p style={p}>
          Members sign this agreement on-chain when they accept their invitation. Everyone else makes it by
          publishing.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Why</h2>
        <p style={p}>
          {defaults.chainName} is a commons. Content someone has to license back from its author is not a commons;
          it is private property stored in a public place. Public-domain content needs no permission layer, cannot
          be enclosed again by a later vote, and moves between federated chains under one rule everyone already
          knows. And anything written to a public chain is copied to every node and archive anyway; CC0 says
          plainly what that means.
        </p>
        <p style={p}>
          The license is fixed in the chain&rsquo;s code, not a governance setting: changing it would take a chain
          upgrade every validator adopts.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Content from other networks</h2>
        <p style={p}>
          Content bridged in from elsewhere must already be public domain. On Mastodon and other fediverse servers,
          follow the Spark Dream bridge account to opt in, then tag a post:
        </p>
        <ul style={list}>
          <li>
            <code>#cc0</code>: you dedicate your own work under{" "}
            <a style={link} href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">
              CC0 1.0
            </a>
            .
          </li>
          <li>
            <code>#publicdomain</code>: the work is already free of known copyright (
            <a style={link} href="https://creativecommons.org/publicdomain/mark/1.0/" target="_blank" rel="noopener noreferrer">
              Public Domain Mark
            </a>
            ).
          </li>
        </ul>
        <p style={p}>
          Untagged posts are never relayed. Every federated item shows the license it arrived under on the{" "}
          <Link style={link} href="/federation">
            Federation
          </Link>{" "}
          page.
        </p>
      </section>

      <section style={section}>
        <h2 style={h2}>Code</h2>
        <p style={p}>
          Code revealed through{" "}
          <Link style={link} href="/reveal">
            Reveal
          </Link>{" "}
          is released, once fully revealed, under a public-domain or permissive open-source license: CC0, the
          Unlicense, 0BSD, MIT, Apache 2.0, BSD or ISC.
        </p>
      </section>

      <p style={{ fontSize: 12, color: "var(--ink-dim)", lineHeight: 1.6 }}>
        This page describes the chain&rsquo;s policy and is not legal advice. The{" "}
        <a style={link} href="https://creativecommons.org/publicdomain/zero/1.0/legalcode" target="_blank" rel="noopener noreferrer">
          CC0 legal code
        </a>{" "}
        is the authoritative text.
      </p>
    </div>
  );
}
