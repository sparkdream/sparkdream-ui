"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { truncateAddress } from "@/lib/utils";

export default function SessionModeSwitcher() {
  const {
    signerAddress,
    sessionActive,
    activeSession,
    availableSessions,
    activateSession,
    deactivateSession,
  } = useWallet();
  const [open, setOpen] = useState(false);

  if (!signerAddress || availableSessions.length === 0) return null;

  return (
    <div className="relative">
      {sessionActive && activeSession ? (
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-900/20 px-2.5 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-900/30"
        >
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          <span className="flex flex-col leading-tight">
            <span>Acting as</span>
            <span>{truncateAddress(activeSession.granter)}</span>
          </span>
        </button>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
        >
          Session Keys ({availableSessions.length})
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <div className="mb-2 text-xs font-medium text-zinc-400">
            Available Sessions
          </div>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {availableSessions.map((session) => {
              const isActive =
                activeSession?.granter === session.granter;
              return (
                <button
                  key={`${session.granter}-${session.grantee}`}
                  onClick={() => {
                    if (isActive) {
                      deactivateSession();
                    } else {
                      activateSession(session);
                    }
                    setOpen(false);
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                    isActive
                      ? "border border-amber-500/30 bg-amber-900/20 text-amber-300"
                      : "border border-zinc-800 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  <div className="font-mono">
                    {truncateAddress(session.granter)}
                  </div>
                  <div className="mt-0.5 text-zinc-500">
                    {session.allowed_msg_types.length} msg type
                    {session.allowed_msg_types.length !== 1 ? "s" : ""}
                    {session.expiration && (
                      <> &middot; expires {new Date(session.expiration).toLocaleDateString()}</>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {sessionActive && (
            <button
              onClick={() => {
                deactivateSession();
                setOpen(false);
              }}
              className="mt-2 w-full rounded-lg border border-zinc-700 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              Deactivate Session Mode
            </button>
          )}
        </div>
      )}
    </div>
  );
}
