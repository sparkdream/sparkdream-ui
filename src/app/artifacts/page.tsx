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
import AuctionList from "@/components/artifacts/AuctionList";
import ClassList from "@/components/artifacts/ClassList";
import ClassDetail from "@/components/artifacts/ClassDetail";
import CreateClassForm from "@/components/artifacts/CreateClassForm";
import EditionDetail from "@/components/artifacts/EditionDetail";
import InboxPanel from "@/components/artifacts/InboxPanel";
import MarketList from "@/components/artifacts/MarketList";
import MyTokens from "@/components/artifacts/MyTokens";
import OffersView from "@/components/artifacts/OffersView";
import RedeemScanner from "@/components/artifacts/RedeemScanner";
import RentalsView from "@/components/artifacts/RentalsView";
import TokenDetail from "@/components/artifacts/TokenDetail";

type View =
  | "browse"
  | "market"
  | "auctions"
  | "my-listings"
  | "mine"
  | "offers"
  | "rentals"
  | "inbox"
  | "my-classes"
  | "create"
  | "redeem";
const VIEWS: View[] = ["browse", "market", "auctions", "my-listings", "mine", "offers", "rentals", "inbox", "my-classes", "create", "redeem"];

// What the URL can address: a list view, a class (?class=3), a token
// (?token=3/7) or an edition (?edition=3/2). The door scanner is
// ?view=redeem&class=3. Ids are uint64, so only digits are accepted.
interface Route {
  view: View;
  classId: string | null;
  token: { classId: string; tokenId: string } | null;
  edition?: { classId: string; editionId: string } | null;
}

function parseRoute(sp: URLSearchParams): Route {
  const v = sp.get("view") as View | null;
  const view = v && VIEWS.includes(v) ? v : "browse";
  const c = sp.get("class");
  const t = sp.get("token");
  const e = sp.get("edition");
  const tm = t ? /^(\d+)\/(\d+)$/.exec(t) : null;
  const em = e ? /^(\d+)\/(\d+)$/.exec(e) : null;
  return {
    view,
    classId: c && /^\d+$/.test(c) ? c : null,
    token: tm ? { classId: tm[1], tokenId: tm[2] } : null,
    edition: em ? { classId: em[1], editionId: em[2] } : null,
  };
}

function routeToQuery(r: Route): string {
  const sp = new URLSearchParams();
  if (r.view !== "browse") sp.set("view", r.view);
  if (r.token) sp.set("token", `${r.token.classId}/${r.token.tokenId}`);
  else if (r.edition) sp.set("edition", `${r.edition.classId}/${r.edition.editionId}`);
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
  const openEdition = (classId: string, editionId: string) =>
    go({ view: route.view === "redeem" ? "browse" : route.view, classId: null, token: null, edition: { classId, editionId } });
  const openRedeem = (classId: string) => go({ view: "redeem", classId, token: null });
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

  const detail = route.token || route.edition || (route.classId && route.view !== "redeem");
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
        {item("auctions", "Auctions", "M14 3l7 7-4 4-7-7 4-4zM10 7l-7 7 4 4 7-7M4 21h10")}
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
        {item("offers", "Offers", "M12 3v18M7 8l5-5 5 5M5 21h14")}
        {item("rentals", "Rentals", "M7 11V7a5 5 0 0110 0v4M5 11h14v10H5z")}
      </SidebarSection>
    </>
  );

  const listView = !detail && !["create", "inbox", "redeem", "offers", "rentals"].includes(route.view);
  const toolbar = listView ? (
    <ContentToolbar
      segments={
        <>
          <button className={route.view === "browse" ? "on" : ""} onClick={() => switchView("browse")}>Classes</button>
          <button className={route.view === "market" ? "on" : ""} onClick={() => switchView("market")}>Market</button>
          <button className={route.view === "auctions" ? "on" : ""} onClick={() => switchView("auctions")}>Auctions</button>
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
        onOpenToken={openToken}
      />
    );
  } else if (route.edition) {
    body = (
      <EditionDetail
        key={`${route.edition.classId}/${route.edition.editionId}`}
        classId={route.edition.classId}
        editionId={route.edition.editionId}
        onBack={back}
        onOpenClass={openClass}
      />
    );
  } else if (route.view === "redeem") {
    body = connected
      ? <RedeemScanner key={route.classId || ""} classId={route.classId} onBack={back} onOpenToken={openToken} onPickClass={openRedeem} />
      : needWallet("Connect your wallet to redeem tickets.");
  } else if (route.classId) {
    body = (
      <ClassDetail
        key={route.classId}
        classId={route.classId}
        onBack={back}
        onSelectToken={openToken}
        onOpenEdition={openEdition}
        onOpenRedeem={openRedeem}
        onOpenClass={openClass}
      />
    );
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
      case "auctions":
        body = <AuctionList mode="all" search={search} sort={sort} onSelectToken={openToken} />;
        break;
      case "my-listings":
        body = connected ? (
          <div className="space-y-6">
            <MarketList mode="mine" search={search} sort={sort} onSelectToken={openToken} />
            <AuctionList mode="mine" search={search} sort={sort} onSelectToken={openToken} />
          </div>
        ) : (
          needWallet("Connect your wallet to see your listings.")
        );
        break;
      case "mine":
        body = connected
          ? <MyTokens search={search} onSelectToken={openToken} onOpenEdition={openEdition} />
          : needWallet("Connect your wallet to see your artifacts.");
        break;
      case "offers":
        body = connected ? <OffersView onSelectToken={openToken} onOpenClass={openClass} /> : needWallet("Connect your wallet to see your offers.");
        break;
      case "rentals":
        body = connected ? <RentalsView onSelectToken={openToken} /> : needWallet("Connect your wallet to see your rentals.");
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
