"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@/contexts/WalletContext";
import { truncateAddress } from "@/lib/utils";
import SessionModeSwitcher from "@/components/SessionModeSwitcher";

export default function Header() {
  const { address, signerAddress, name, connected, connecting, connect, disconnect, sessionActive } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = (
    <>
      {connected && (
        <Link
          href="/blog/my-posts"
          className="text-sm text-zinc-400 transition-colors hover:text-white"
          onClick={() => setMenuOpen(false)}
        >
          My Posts
        </Link>
      )}
      <Link
        href="/blog"
        className="text-sm text-zinc-400 transition-colors hover:text-white"
        onClick={() => setMenuOpen(false)}
      >
        Blog
      </Link>
      {connected && (
        <>
          <Link
            href="/governance"
            className="text-sm text-zinc-400 transition-colors hover:text-white"
            onClick={() => setMenuOpen(false)}
          >
            Governance
          </Link>
          <Link
            href="/reputation"
            className="text-sm text-zinc-400 transition-colors hover:text-white"
            onClick={() => setMenuOpen(false)}
          >
            Reputation
          </Link>
          <Link
            href="/sessions"
            className="text-sm text-zinc-400 transition-colors hover:text-white"
            onClick={() => setMenuOpen(false)}
          >
            Sessions
          </Link>
        </>
      )}
    </>
  );

  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-white">
            Spark Dream
          </Link>
          <nav className="hidden items-center gap-4 md:flex">
            {navLinks}
          </nav>
        </div>

        {/* Desktop wallet area */}
        <div className="hidden items-center gap-3 md:flex">
          {connected ? (
            <div className="flex items-center gap-3">
              <SessionModeSwitcher />
              <div className="text-right">
                {name && (
                  <div className="text-sm font-medium text-white">{name}</div>
                )}
                <div className="text-xs text-zinc-500">
                  {sessionActive
                    ? `${truncateAddress(signerAddress!)} → ${truncateAddress(address!)}`
                    : truncateAddress(address!)}
                </div>
              </div>
              <button
                onClick={disconnect}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center justify-center rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white md:hidden"
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="border-t border-zinc-800 px-4 pb-4 pt-3 md:hidden">
          <nav className="flex flex-col gap-3">
            {navLinks}
          </nav>
          <div className="mt-4 border-t border-zinc-800 pt-4">
            {connected ? (
              <div className="flex flex-col gap-3">
                <SessionModeSwitcher />
                <div>
                  {name && (
                    <div className="text-sm font-medium text-white">{name}</div>
                  )}
                  <div className="text-xs text-zinc-500">
                    {sessionActive
                      ? `${truncateAddress(signerAddress!)} → ${truncateAddress(address!)}`
                      : truncateAddress(address!)}
                  </div>
                </div>
                <button
                  onClick={() => { disconnect(); setMenuOpen(false); }}
                  className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => { connect(); setMenuOpen(false); }}
                disabled={connecting}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {connecting ? "Connecting..." : "Connect Wallet"}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
