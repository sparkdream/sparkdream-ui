"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  ContentPageLayout,
  ContentToolbar,
  SidebarSection,
} from "@/components/layout/ContentPageLayout";
import ConnectPrompt from "@/components/layout/ConnectPrompt";
import { useLocalStorageBoolean } from "@/hooks/useLocalStorageBoolean";
import { useSearchShortcut } from "@/hooks/useSearchShortcut";
import { getArtifactInbox } from "@/lib/artifactApi";
import ClassList from "@/components/artifacts/ClassList";
import ClassDetail from "@/components/artifacts/ClassDetail";
import CreateClassForm from "@/components/artifacts/CreateClassForm";
import InboxPanel from "@/components/artifacts/InboxPanel";
import MarketList from "@/components/artifacts/MarketList";
import MyTokens from "@/components/artifacts/MyTokens";
import TokenDetail from "@/components/artifacts/TokenDetail";

type View = "browse" | "market" | "my-listings" | "mine" | "inbox" | "my-classes" | "create";
const VIEWS: View[] = ["browse", "market", "my-listings", "mine", "inbox", "my-classes", "create"];

// What the URL can address: a list view, a class (?class=3) or a token
// (?token=3/7). Ids are uint64, so only digits are accepted.
interface Route {
  view: View;
  classId: string | null;
  token: { classId: string; tokenId: string } | null;
}

function parseRoute(sp: URLSearchParams): Route {
  const v = sp.get("view") as View | null;
  const view = v && VIEWS.includes(v) ? v : "browse";
  const c = sp.get("class");
  const t = sp.get("token");
  const tm = t ? /^(\d+)\/(\d+)$/.exec(t) : null;
  return {
    view,
    classId: c && /^\d+$/.test(c) ? c : null,
    token: tm ? { classId: tm[1], tokenId: tm[2] } : null,
  };
}

function routeToQuery(r: Route): string {
  const sp = new URLSearchParams();
  if (r.view !== "browse") sp.set("view", r.view);
  if (r.token) sp.set("token", `${r.token.classId}/${r.token.tokenId}`);
  else if (r.classId) sp.set("class", r.classId);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default function ArtifactsPage() {
  return (
    <Suspense fallback={null}>
      <ArtifactsPageInner />
    </Suspense>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d={d} />
  </svg>
);

function ArtifactsPageInner() {
  const { address, connected, ready } = useWallet();
  const { config } = useChainConfig();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  const route = useMemo(() => parseRoute(new URLSearchParams(queryString)), [queryString]);

  // Pushes made from this page, so Back returns within it and never leaves
  // the site after a deep link.
  const pushes = useRef(0);
  const go = useCallback(
    (next: Route) => {
      pushes.current += 1;
      router.push(`/artifacts${routeToQuery(next)}`, { scroll: false });
    },
    [router]
  );

  const [browseOpen, setBrowseOpen] = useLocalStorageBoolean("artifacts-browse-open", true);
  const [mineOpen, setMineOpen] = useLocalStorageBoolean("artifacts-mine-open", true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);

  const [inbox, setInbox] = useState<{ address: string; count: number } | null>(null);
  useEffect(() => {
    if (!address) return;
    getArtifactInbox(address, { limit: "1" })
      .then((r) => setInbox({ address, count: r.inbox_count ?? (r.items || []).length }))
      .catch(() => setInbox(null));
  }, [address, route]);
  const inboxCount = address && inbox?.address === address ? inbox.count : null;

  const switchView = (view: View) => go({ view, classId: null, token: null });
  const openClass = (classId: string) => go({ view: route.view, classId, token: null });
  const openToken = (classId: string, tokenId: string) => go({ view: route.view, classId: null, token: { classId, tokenId } });
  const back = () => {
    if (pushes.current > 0) {
      pushes.current -= 1;
      router.back();
    } else {
      go({ view: route.view, classId: null, token: null });
    }
  };

  if (!ready) {
    return (
      <div className="sd-page">
        <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
      </div>
    );
  }

  const detail = route.token || route.classId;
  const item = (view: View, label: string, d: string, extra?: React.ReactNode) => (
    <button
      type="button"
      className={`sd-side-item artifact-item${route.view === view && !detail ? " active" : ""}`}
      onClick={() => switchView(view)}
    >
      <Icon d={d} />
      {label}
      {extra}
    </button>
  );

  const sidebar = (
    <>
      <SidebarSection label="Browse" open={browseOpen} onToggle={() => setBrowseOpen(!browseOpen)}>
        {item("browse", "Classes", "M6 3h12l3 6-9 12L3 9l3-6zM3 9h18")}
        {item("market", "Market", "M3 7h18l-2 12H5L3 7zm5 0V5a4 4 0 018 0v2")}
      </SidebarSection>
      <SidebarSection label="Yours" open={mineOpen} onToggle={() => setMineOpen(!mineOpen)}>
        {item("mine", "My artifacts", "M4 6h16v12H4zM4 10h16")}
        {item(
          "inbox",
          "Inbox",
          "M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6l2-8z",
          inboxCount ? <span className="ml-auto rounded-full px-1.5 text-[11px]" style={{ background: "var(--verdigris-soft)", color: "var(--verdigris-hi)" }}>{inboxCount}</span> : null
        )}
        {item("my-classes", "My classes", "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z")}
        {item("my-listings", "My listings", "M7 7h10M7 12h10M7 17h6")}
      </SidebarSection>
    </>
  );

  const listView = !detail && route.view !== "create" && route.view !== "inbox";
  const toolbar = listView ? (
    <ContentToolbar
      segments={
        <>
          <button className={route.view === "browse" ? "on" : ""} onClick={() => switchView("browse")}>Classes</button>
          <button className={route.view === "market" ? "on" : ""} onClick={() => switchView("market")}>Market</button>
          <button className={route.view === "mine" ? "on" : ""} onClick={() => switchView("mine")}>Mine</button>
        </>
      }
      searchPlaceholder={route.view === "browse" || route.view === "my-classes" ? "Search classes by name, symbol or #id…" : "Search by name or class/token…"}
      searchValue={search}
      onSearchChange={setSearch}
      searchRef={searchRef}
      sort={sort}
      onSortChange={setSort}
      primaryAction={{
        label: "New class",
        variant: "artifact",
        onClick: () => switchView("create"),
        disabled: !connected,
        title: connected ? "MsgCreateClass" : "Connect a wallet to create a class",
      }}
    />
  ) : null;

  const needWallet = (msg: string) => <ConnectPrompt message={msg} />;

  let body: React.ReactNode;
  if (route.token) {
    body = (
      <TokenDetail
        key={`${route.token.classId}/${route.token.tokenId}`}
        classId={route.token.classId}
        tokenId={route.token.tokenId}
        onBack={back}
        onOpenClass={openClass}
      />
    );
  } else if (route.classId) {
    body = <ClassDetail key={route.classId} classId={route.classId} onBack={back} onSelectToken={openToken} />;
  } else {
    switch (route.view) {
      case "browse":
        body = <ClassList mode="all" search={search} sort={sort} onSelect={openClass} onCreate={connected ? () => switchView("create") : undefined} />;
        break;
      case "my-classes":
        body = connected
          ? <ClassList mode="mine" search={search} sort={sort} onSelect={openClass} onCreate={() => switchView("create")} />
          : needWallet("Connect your wallet to see your classes.");
        break;
      case "market":
        body = <MarketList mode="all" search={search} sort={sort} onSelectToken={openToken} />;
        break;
      case "my-listings":
        body = connected
          ? <MarketList mode="mine" search={search} sort={sort} onSelectToken={openToken} />
          : needWallet("Connect your wallet to see your listings.");
        break;
      case "mine":
        body = connected ? <MyTokens search={search} onSelectToken={openToken} /> : needWallet("Connect your wallet to see your artifacts.");
        break;
      case "inbox":
        body = connected
          ? <InboxPanel onSelectClass={openClass} onSelectToken={openToken} />
          : needWallet("Connect your wallet to see your inbox.");
        break;
      case "create":
        body = connected
          ? <CreateClassForm onCreated={() => switchView("my-classes")} onCancel={() => switchView("browse")} />
          : needWallet("Connect your wallet to create a class.");
        break;
    }
  }

  return (
    <ContentPageLayout
      title="Artifacts"
      subtitle="Onchain tokens: collectibles, badges and editions. Everything here is public domain."
      sidebar={sidebar}
      toolbar={toolbar}
      railCards={
        <div className="sd-rail-card artifacts">
          <h5>How it works</h5>
          <ol className="sd-rail-steps">
            <li><span className="n">01</span><span>Each token holds a small {config.displayDenom} deposit, returned to whoever burns it.</span></li>
            <li><span className="n">02</span><span>Tokens from people you don&apos;t know wait in your inbox until you accept them.</span></li>
            <li><span className="n">03</span><span>Owning a token doesn&apos;t grant copyright.</span></li>
          </ol>
        </div>
      }
    >
      {body}
    </ContentPageLayout>
  );
}
