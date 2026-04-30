"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useWallet } from "@/contexts/WalletContext";
import { listPublicCollections } from "@/lib/api";
import CollectionList from "@/components/collections/CollectionList";
import CollectionDetail from "@/components/collections/CollectionDetail";
import CreateCollectionForm from "@/components/collections/CreateCollectionForm";
import CuratorList from "@/components/collections/CuratorList";
import {
  ContentPageLayout,
  ContentToolbar,
  SidebarSection,
} from "@/components/layout/ContentPageLayout";
import { truncateAddress } from "@/lib/utils";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useLocalStorageBoolean } from "@/hooks/useLocalStorageBoolean";
import { useSearchShortcut } from "@/hooks/useSearchShortcut";
import { CollectionStatus, CollectionType } from "@/types/collect";
import type { Collection } from "@/types/collect";

type View = "my-collections" | "create" | "browse" | "curators" | "detail";

export default function WondersPage() {
  const { connected, ready, sessionActive, activeSession } = useWallet();

  const [view, setView] = useState<View>("browse");
  const [browseOpen, setBrowseOpen] = useLocalStorageBoolean("collections-browse-open", true);
  const [myOpen, setMyOpen] = useLocalStorageBoolean("collections-my-open", true);
  const [tagsOpen, setTagsOpen] = useLocalStorageBoolean("collections-tags-open", true);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [filterType, setFilterType] = useState<string>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  useSearchShortcut(searchRef);

  // Page-level public collections feed for rail cards (Trending / Active curators).
  const [railCollections, setRailCollections] = useState<Collection[]>([]);

  // Tags surfaced in the sidebar, ranked by frequency across the rail feed.
  const tagList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of railCollections) {
      for (const t of c.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t);
  }, [railCollections]);

  useEffect(() => {
    listPublicCollections({ limit: "20", reverse: true })
      .then((res) => {
        const active = (res.collections || []).filter((c) => c.status !== CollectionStatus.HIDDEN);
        setRailCollections(active);
      })
      .catch(() => setRailCollections([]));
  }, [listKey]);

  const switchView = (v: View) => {
    setView(v);
    setSelectedCollectionId(null);
  };

  const handleSelectCollection = (c: Collection) => {
    setSelectedCollectionId(c.id);
    setView("detail");
  };

  const handleBackFromDetail = () => {
    setSelectedCollectionId(null);
    setView(view === "detail" ? "browse" : view);
  };

  const handleCreated = () => {
    setListKey((k) => k + 1);
    switchView("my-collections");
  };

  if (!ready) {
    return (
      <div className="sd-page">
        <div className="mb-8">
          <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-zinc-800/60" />
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="sd-page">
        <header className="sd-page-header">
          <h1>Wonders</h1>
          <p>Curated collections — NFTs, links, and onchain references</p>
        </header>
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">
            Connect your wallet to browse and curate Wonders
          </p>
        </div>
      </div>
    );
  }

  const sidebarFilters = (
    <>
      <SidebarSection
        label="Browse"
        open={browseOpen}
        onToggle={() => setBrowseOpen(!browseOpen)}
      >
        <button
          type="button"
          className={`sd-side-item collection-item${view === "browse" || view === "detail" ? " active" : ""}`}
          onClick={() => switchView("browse")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
          Public collections
        </button>
        <button
          type="button"
          className={`sd-side-item${view === "curators" ? " active" : ""}`}
          onClick={() => switchView("curators")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          Curators
        </button>
      </SidebarSection>

      <SidebarSection
        label="My Collections"
        open={myOpen}
        onToggle={() => setMyOpen(!myOpen)}
      >
        <button
          type="button"
          className={`sd-side-item collection-item${view === "my-collections" ? " active" : ""}`}
          onClick={() => switchView("my-collections")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          My collections
        </button>
      </SidebarSection>

      {tagList.length > 0 && (
        <SidebarSection
          label="Tags"
          open={tagsOpen}
          onToggle={() => setTagsOpen(!tagsOpen)}
        >
          <div className="sd-side-pills">
            {tagList.map((t) => {
              const isActive = tagFilter === t;
              const dim = tagFilter !== null && !isActive;
              return (
                <button
                  key={t}
                  type="button"
                  className="sd-pill tag"
                  style={{ opacity: dim ? 0.4 : 1, outline: isActive ? "1px solid currentColor" : "none" }}
                  onClick={() => setTagFilter(isActive ? null : t)}
                >
                  #{t}
                </button>
              );
            })}
          </div>
        </SidebarSection>
      )}
    </>
  );

  const primaryAction = connected
    ? { label: "New collection", variant: "collection" as const, onClick: () => switchView("create") }
    : null;

  const showToolbar = view !== "detail" && view !== "create";

  const toolbar = showToolbar ? (
    <ContentToolbar
      segments={
        <>
          <button
            className={view === "browse" ? "on" : ""}
            onClick={() => switchView("browse")}
          >
            Public collections
          </button>
          {connected && (
            <button
              className={view === "my-collections" ? "on" : ""}
              onClick={() => switchView("my-collections")}
            >
              My collections
            </button>
          )}
          <button
            className={view === "curators" ? "on" : ""}
            onClick={() => switchView("curators")}
          >
            Curators
          </button>
        </>
      }
      searchPlaceholder="Search collections, tags, or curators…"
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchRef={searchRef}
      sort={sort}
      onSortChange={setSort}
      extraFilters={
        view !== "curators" && (
          <select
            className="sd-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All types</option>
            <option value={CollectionType.NFT}>NFT</option>
            <option value={CollectionType.LINK}>Link</option>
            <option value={CollectionType.ONCHAIN}>Onchain</option>
            <option value={CollectionType.MIXED}>Mixed</option>
          </select>
        )
      }
      primaryAction={primaryAction}
    />
  ) : null;

  return (
    <ContentPageLayout
      title="Wonders"
      subtitle="Curated collections — NFTs, links, and onchain references"
      sidebar={sidebarFilters}
      toolbar={toolbar}
      railCards={
        <>
          <TrendingCollectionsCard
            collections={railCollections.slice(0, 5)}
            onSelect={handleSelectCollection}
          />
          <ActiveCuratorsCard collections={railCollections} />
          <SessionKeyCard
            sessionActive={sessionActive}
            granteeAddr={activeSession?.grantee || null}
          />
        </>
      }
    >
      {view === "my-collections" && (
        <CollectionList
          key={`my-${listKey}`}
          mode="my"
          filterType={filterType}
          tagFilter={tagFilter}
          onSelect={handleSelectCollection}
          onCreate={connected ? () => switchView("create") : undefined}
        />
      )}
      {view === "create" && (
        <CreateCollectionForm
          onCreated={handleCreated}
          onCancel={() => switchView("browse")}
        />
      )}
      {view === "browse" && (
        <CollectionList
          key={`public-${listKey}`}
          mode="public"
          filterType={filterType}
          tagFilter={tagFilter}
          onSelect={handleSelectCollection}
          onCreate={connected ? () => switchView("create") : undefined}
        />
      )}
      {view === "curators" && <CuratorList />}
      {view === "detail" && selectedCollectionId && (
        <CollectionDetail collectionId={selectedCollectionId} onBack={handleBackFromDetail} />
      )}
    </ContentPageLayout>
  );
}

function TrendingCollectionsCard({
  collections,
  onSelect,
}: {
  collections: Collection[];
  onSelect: (c: Collection) => void;
}) {
  return (
    <div className="sd-rail-card collections">
      <h5>
        Trending onchain
        <span className="live">
          <span className="d" />
          live
        </span>
      </h5>
      {collections.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-soft)", padding: "4px 0" }}>
          No collections yet.
        </div>
      )}
      {collections.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c)}
          className="sd-trend-row"
          style={{ background: "transparent", border: 0, width: "100%", textAlign: "left", cursor: "pointer" }}
        >
          <span className="num">{String(i + 1).padStart(2, "0")}</span>
          <span className="title">{c.name || `Collection #${c.id}`}</span>
          <span className="c">{c.item_count}</span>
        </button>
      ))}
    </div>
  );
}

function ActiveCuratorsCard({ collections }: { collections: Collection[] }) {
  const curators = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of collections) map.set(c.owner, (map.get(c.owner) || 0) + 1);
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [collections]);

  return (
    <div className="sd-rail-card">
      <h5>Active curators this week</h5>
      {curators.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ink-soft)", padding: "4px 0" }}>
          No curators yet.
        </div>
      ) : (
        curators.map(([addr, count], i) => (
          <CuratorRow key={addr} addr={addr} count={count} idx={i} />
        ))
      )}
    </div>
  );
}

function CuratorRow({ addr, count, idx }: { addr: string; count: number; idx: number }) {
  const { name } = useDisplayName(addr);
  const gradients = [
    "linear-gradient(135deg, var(--violet), var(--rose))",
    "linear-gradient(135deg, var(--green), var(--violet))",
    "linear-gradient(135deg, var(--amber), var(--rose))",
  ];
  const initial = (name || addr).charAt(name ? 0 : 8).toUpperCase();
  return (
    <div className="sd-member-row">
      <div className="sd-avatar sm" style={{ background: gradients[idx % gradients.length] }}>
        {initial}
      </div>
      <div className="info">
        <span className="addr">{name || truncateAddress(addr)}</span>
        <div className="meta">{count} {count === 1 ? "collection" : "collections"}</div>
      </div>
    </div>
  );
}

function SessionKeyCard({
  sessionActive,
  granteeAddr,
}: {
  sessionActive: boolean;
  granteeAddr: string | null;
}) {
  return (
    <div className="sd-rail-card">
      <h5>Your session key</h5>
      <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.55 }}>
        {sessionActive && granteeAddr ? (
          <>
            Granted to{" "}
            <span className="sd-pill trust-core" style={{ fontFamily: "var(--font-geist-mono)" }}>
              {truncateAddress(granteeAddr)}
            </span>{" "}
            with <span style={{ color: "var(--ink)" }}>CreateCollection · AddItem · Endorse</span>.
          </>
        ) : (
          <>
            No active session. Visit{" "}
            <Link href="/sessions" style={{ color: "var(--violet-hi)" }}>
              Sessions
            </Link>{" "}
            to create a scoped key for bots or agents.
          </>
        )}
      </div>
    </div>
  );
}
