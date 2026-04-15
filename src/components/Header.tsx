"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { truncateAddress } from "@/lib/utils";
import SessionModeSwitcher from "@/components/SessionModeSwitcher";

function NavLink({ href, exact, children, onClick }: { href: string; exact?: boolean; children: React.ReactNode; onClick?: () => void }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : (pathname === href || pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      className={`text-sm transition-colors ${
        active ? "text-white" : "text-zinc-400 hover:text-white"
      }`}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

export default function Header() {
  const { address, signerAddress, name, connected, connecting, connect, disconnect, sessionActive } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = (
    <>
      <NavLink href="/blog" exact onClick={() => setMenuOpen(false)}>
        Blog
      </NavLink>
      {connected && (
        <>
          <NavLink href="/governance" onClick={() => setMenuOpen(false)}>
            Governance
          </NavLink>
          <NavLink href="/collections" onClick={() => setMenuOpen(false)}>
            Collections
          </NavLink>
          <NavLink href="/contribute" onClick={() => setMenuOpen(false)}>
            Contribute
          </NavLink>
          <NavLink href="/sessions" onClick={() => setMenuOpen(false)}>
            Sessions
          </NavLink>
        </>
      )}
    </>
  );

  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex h-16 max-w-5xl items-center px-4">
        <Link href="/" className="shrink-0 text-lg font-bold text-white">
          Spark Dream
        </Link>
        <nav className="ml-6 hidden items-center gap-3 md:flex">
          {navLinks}
        </nav>

        {/* Spacer pushes wallet area to the right */}
        <div className="min-w-6 flex-1" />

        {/* Desktop wallet area */}
        <div className="hidden shrink-0 items-center gap-3 md:flex">
          {connected ? (
            <div className="flex items-center gap-3">
              <SessionModeSwitcher />
              <div className="text-right">
                {name && (
                  <div className="text-sm font-medium text-white">{name}</div>
                )}
                <div className="text-xs text-zinc-500">
                  {sessionActive
                    ? truncateAddress(signerAddress!)
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
                      ? truncateAddress(signerAddress!)
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
