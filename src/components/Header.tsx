"use client";

import Link from "next/link";
import { useWallet } from "@/contexts/WalletContext";
import { truncateAddress } from "@/lib/utils";

export default function Header() {
  const { address, name, connected, connecting, connect, disconnect } = useWallet();

  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-white">
            Spark Dream
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/blog"
              className="text-sm text-zinc-400 transition-colors hover:text-white"
            >
              Blog
            </Link>
            {connected && (
              <>
                <Link
                  href="/blog/my-posts"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  My Posts
                </Link>
                <Link
                  href="/sessions"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Sessions
                </Link>
                <Link
                  href="/governance"
                  className="text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Governance
                </Link>
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {connected ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                {name && (
                  <div className="text-sm font-medium text-white">{name}</div>
                )}
                <div className="text-xs text-zinc-500">
                  {truncateAddress(address!)}
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
      </div>
    </header>
  );
}
