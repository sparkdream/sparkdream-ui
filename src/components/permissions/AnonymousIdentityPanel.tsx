"use client";

import { useEffect, useState } from "react";
import { useShieldIdentity, zkKeyFingerprint } from "@/hooks/useShieldIdentity";

const TRUST_NAMES = ["New", "Provisional", "Established", "Trusted", "Core"];

/** Set up or unlock the member's anonymous identity (x/shield). */
export default function AnonymousIdentityPanel() {
  const { status, trustLevel, unlock, register, clear, registeredKey, pendingKey, activatesAtEpoch } = useShieldIdentity();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fingerprints, setFingerprints] = useState<{ registered: string; pending: string }>({ registered: "", pending: "" });

  useEffect(() => {
    let live = true;
    Promise.all([
      registeredKey ? zkKeyFingerprint(registeredKey) : Promise.resolve(""),
      pendingKey ? zkKeyFingerprint(pendingKey) : Promise.resolve(""),
    ])
      .then(([registered, pending]) => live && setFingerprints({ registered, pending }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [registeredKey, pendingKey]);

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
        {status === "pending" && (
          <p className="text-zinc-300">
            Your key is registered and activates at epoch {activatesAtEpoch ?? "?"}. Every key change waits this long, so a
            new key can&apos;t act twice in a window that&apos;s already open.
          </p>
        )}
        {status === "mismatch" && (
          <div className="space-y-2">
            <p className="text-amber-400">
              {"This wallet's identity doesn't match the key registered on chain. Register it again to use it. A key change waits an activation delay and is limited to one per season."}
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
      {(fingerprints.registered || fingerprints.pending) && (
        <dl className="mt-4 space-y-1 text-xs text-zinc-500">
          {fingerprints.registered && (
            <div>
              <dt className="inline">Registered key fingerprint: </dt>
              <dd className="inline font-mono text-zinc-300">{fingerprints.registered}</dd>
            </div>
          )}
          {fingerprints.pending && (
            <div>
              <dt className="inline">Pending key fingerprint: </dt>
              <dd className="inline font-mono text-zinc-300">{fingerprints.pending}</dd>
            </div>
          )}
          <p>
            Co-signers of a multisig can compare it with <code className="text-zinc-400">sparkdreamd zk-key-fingerprint</code>{" "}
            before approving a registration.
          </p>
        </dl>
      )}
      {(registeredKey || pendingKey) && status !== "unavailable" && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!confirm("Clear your anonymous identity key? Do this if the key leaked. Registering a key again waits the activation delay.")) return;
              run(clear);
            }}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Clear key (if it leaked)
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
