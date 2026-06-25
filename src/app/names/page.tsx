"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import NameLookup from "@/components/names/NameLookup";
import MyNames from "@/components/names/MyNames";
import DisputeList from "@/components/names/DisputeList";

type View = "lookup" | "my-names" | "disputes";

export default function NamesPage() {
  const { connected, ready } = useWallet();
  const [view, setView] = useState<View>("lookup");
  const [resolveOpen, setResolveOpen] = useState(true);
  const [manageOpen, setManageOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const switchView = (v: View) => {
    setView(v);
    setMobileSidebarOpen(false);
  };

  if (!ready) {
    return (
      <div className="sd-page">
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

  const viewLabels: Record<View, string> = {
    lookup: "Resolve / Lookup",
    "my-names": "Manage / My names",
    disputes: "Manage / Disputes",
  };

  const sidebarContent = (
    <nav className="space-y-1">
      {/* Resolve section */}
      <div>
        <button
          onClick={() => setResolveOpen(!resolveOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>Resolve</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${resolveOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {resolveOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("lookup")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "lookup"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              Lookup
            </button>
          </div>
        )}
      </div>

      {/* Manage section */}
      <div className="pt-2">
        <button
          onClick={() => setManageOpen(!manageOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>Manage</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${manageOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {manageOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("my-names")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "my-names"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : connected
                    ? "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                    : "cursor-not-allowed text-zinc-600"
              }`}
              disabled={!connected}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
              </svg>
              My names
            </button>

            <button
              onClick={() => switchView("disputes")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "disputes"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : connected
                    ? "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                    : "cursor-not-allowed text-zinc-600"
              }`}
              disabled={!connected}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              Disputes
            </button>
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <div className="sd-page">
      <header className="sd-page-header">
        <span className="crumb">System</span>
        <h1>Names</h1>
        <p>Register and resolve human-readable names onchain</p>
      </header>

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
          {view === "lookup" && <NameLookup />}
          {view === "my-names" && connected && <MyNames />}
          {view === "disputes" && connected && <DisputeList />}
          {(view === "my-names" || view === "disputes") && !connected && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
              <p className="text-zinc-400">
                Connect your wallet to manage names
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
