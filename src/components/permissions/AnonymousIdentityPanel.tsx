"use client";

import { useState } from "react";
import { useShieldIdentity } from "@/hooks/useShieldIdentity";

const TRUST_NAMES = ["New", "Provisional", "Established", "Trusted", "Core"];

/** Set up or unlock the member's anonymous identity (x/shield). */
export default function AnonymousIdentityPanel() {
  const { status, trustLevel, unlock, register } = useShieldIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "loading") return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="anonymous" className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-lg font-semibold text-white">Anonymous identity</h2>
      <p className="mt-1 text-sm text-zinc-400">
        {"Lets you post, reply, vote and curate as Anonymous. A zero-knowledge proof shows you're a member at a given trust level without revealing which member you are."}
      </p>
      <p className="mt-2 text-xs text-zinc-500">
        {"The identity comes from a signature your wallet makes over a fixed message, so the same wallet recovers it on any device. Only sign that message on this app: anyone holding the signature can link your anonymous activity to you."}
      </p>

      <div className="mt-4 text-sm">
        {status === "unavailable" && (
          <p className="text-zinc-400">Anonymous actions are for active members, signing with their own wallet (not a session key).</p>
        )}
        {status === "unregistered" && (
          <button type="button" disabled={busy} onClick={() => run(register)} className="sd-btn sd-btn-primary">
            {busy ? "Setting up…" : "Set up anonymous identity"}
          </button>
        )}
        {status === "mismatch" && (
          <div className="space-y-2">
            <p className="text-amber-400">
              {"This wallet's identity doesn't match the key registered on chain. Register it again to use it."}
            </p>
            <button type="button" disabled={busy} onClick={() => run(register)} className="sd-btn sd-btn-primary">
              {busy ? "Registering…" : "Register again"}
            </button>
          </div>
        )}
        {status === "locked" && (
          <div className="space-y-2">
            <p className="text-zinc-300">Your anonymous identity is registered.</p>
            <button type="button" disabled={busy} onClick={() => run(unlock)} className="sd-btn sd-btn-secondary">
              {busy ? "Unlocking…" : "Unlock for this tab"}
            </button>
          </div>
        )}
        {status === "ready" && (
          <p className="text-zinc-300">
            Ready. You can act anonymously
            {trustLevel !== null && trustLevel >= 0 ? ` at trust level ${TRUST_NAMES[trustLevel]}` : ""}. New
            registrations take effect from the next block.
          </p>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
