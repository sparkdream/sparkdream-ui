"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import CollectionList from "@/components/collections/CollectionList";
import CollectionDetail from "@/components/collections/CollectionDetail";
import CreateCollectionForm from "@/components/collections/CreateCollectionForm";
import CuratorList from "@/components/collections/CuratorList";
import type { Collection } from "@/types/collect";

type View = "my-collections" | "create" | "browse" | "curators" | "detail";

export default function CollectionsPage() {
  const { connected, ready } = useWallet();

  const [view, setView] = useState<View>("browse");
  const [myOpen, setMyOpen] = useState(true);
  const [browseOpen, setBrowseOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const switchView = (v: View) => {
    setView(v);
    setSelectedCollectionId(null);
    setMobileSidebarOpen(false);
  };

  const handleSelectCollection = (c: Collection) => {
    setSelectedCollectionId(c.id);
    setView("detail");
    setMobileSidebarOpen(false);
  };

  const handleBackFromDetail = () => {
    setSelectedCollectionId(null);
    setView("my-collections");
  };

  const handleCreated = () => {
    setListKey((k) => k + 1);
    switchView("my-collections");
  };

  if (!ready) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8">
          <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-zinc-800/60" />
        </div>
        <div className="flex gap-6">
          <div className="hidden w-56 shrink-0 md:block">
            <div className="h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
          </div>
          <div className="flex-1">
            <div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
          </div>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-white">Collections</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">
            Connect your wallet to manage and browse collections
          </p>
        </div>
      </div>
    );
  }

  const viewLabels: Record<View, string> = {
    "my-collections": "My Collections / Collections",
    create: "My Collections / Create",
    browse: "Browse / Public Collections",
    curators: "Browse / Curators",
    detail: "Collection Detail",
  };

  const sidebarContent = (
    <nav className="space-y-1">
      {/* My Collections section */}
      <div>
        <button
          onClick={() => setMyOpen(!myOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>My Collections</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${myOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {myOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("my-collections")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "my-collections" || view === "detail"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              Collections
            </button>

            <button
              onClick={() => switchView("create")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "create"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create
            </button>
          </div>
        )}
      </div>

      {/* Browse section */}
      <div className="pt-2">
        <button
          onClick={() => setBrowseOpen(!browseOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>Browse</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${browseOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {browseOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("browse")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "browse"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              Public Collections
            </button>

            <button
              onClick={() => switchView("curators")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "curators"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              Curators
            </button>
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Collections</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Curated sets of NFTs, links, and on-chain references
        </p>
      </div>

      {/* Mobile sidebar toggle */}
      <div className="mb-4 md:hidden">
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-sm text-zinc-300"
        >
          <span>{viewLabels[view]}</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${mobileSidebarOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {mobileSidebarOpen && (
          <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
            {sidebarContent}
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <div className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-24 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            {sidebarContent}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {view === "my-collections" && (
            <CollectionList key={`my-${listKey}`} mode="my" onSelect={handleSelectCollection} />
          )}
          {view === "create" && (
            <CreateCollectionForm onCreated={handleCreated} />
          )}
          {view === "browse" && (
            <CollectionList key={`public-${listKey}`} mode="public" onSelect={handleSelectCollection} />
          )}
          {view === "curators" && <CuratorList />}
          {view === "detail" && selectedCollectionId && (
            <CollectionDetail collectionId={selectedCollectionId} onBack={handleBackFromDetail} />
          )}
        </div>
      </div>
    </div>
  );
}
