"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { listPendingIdentityChallenges } from "@/lib/api";
import { FederationMsgTypeUrls } from "@/lib/tx";
import { timeAgo } from "@/lib/utils";
import CopyableAddress from "@/components/CopyableAddress";
import type { PendingIdentityChallenge } from "@/types/federation";

/**
 * Phase 2 of identity linking: someone on a peer chain has claimed an address
 * on THIS chain, and only the holder of that address can complete the link.
 *
 * The two phases are signed by different keys on different chains, which is
 * the whole point -- phase 1 proves control of the claimant address, phase 2
 * proves control of the claimed one. Signing MsgConfirmIdentityLink IS the
 * proof; there is nothing to type in.
 *
 * Challenges expire. A link left unconfirmed is pruned rather than lingering
 * as a half-made assertion, so this shows the deadline.
 */
export default function PendingIdentityChallenges() {
  const { address, signAndBroadcast } = useWallet();
  const { pending, error, clearError, run } = useTxAction();
  const [challenges, setChallenges] = useState<PendingIdentityChallenge[] | null>(null);
  // Captured when the list is fetched rather than read during render: the
  // React compiler treats Date.now() in render as impure, and an expiry
  // that silently advances between renders would be misleading anyway.
  // Re-checked on every reload, including after a confirm.
  const [fetchedAt, setFetchedAt] = useState(0);

  // Bumped after a confirm to refetch. Fetching inline in the effect rather
  // than calling a setState-ing callback keeps this off the
  // react-hooks/set-state-in-effect rule.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    listPendingIdentityChallenges(address)
      .then((r) => {
        if (cancelled) return;
        setChallenges(r.challenges ?? []);
        setFetchedAt(Math.floor(Date.now() / 1000));
      })
      .catch(() => {
        if (cancelled) return;
        setChallenges([]);
        setFetchedAt(Math.floor(Date.now() / 1000));
      });
    return () => {
      cancelled = true;
    };
  }, [address, reloadKey]);

  const confirm = async (c: PendingIdentityChallenge) => {
    const ok = await run(
      `confirm-${c.claimant_chain_peer_id}`,
      async () => {
        await signAndBroadcast([
          {
            typeUrl: FederationMsgTypeUrls.ConfirmIdentityLink,
            value: {
              creator: address,
              claimantChainPeerId: c.claimant_chain_peer_id,
            },
          },
        ]);
      },
      (raw) => `Could not confirm the link: ${raw}`
    );
    if (ok) setReloadKey((k) => k + 1);
  };

  // Nothing pending is the normal state; don't take up space for it.
  if (!address || !challenges || challenges.length === 0) return null;

  return (
    <section className="sd-hull-tile space-y-3 rounded-xl p-5">
      <div>
        <h3 className="text-sm font-semibold text-white">
          Identity links awaiting your confirmation
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          Someone on a peer chain claims this address is theirs. Confirming
          signs the proof that you hold its key. Only you can do this.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
          <button type="button" onClick={clearError} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {challenges.map((c) => {
          const expiresAt = Number(c.expires_at);
          const expired =
            Number.isFinite(expiresAt) && expiresAt > 0 && fetchedAt > 0 && expiresAt < fetchedAt;
          const key = `confirm-${c.claimant_chain_peer_id}`;
          return (
            <li
              key={`${c.claimant_chain_peer_id}:${c.claimant_address}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
            >
              <div className="min-w-0 text-xs text-zinc-400">
                <div className="text-zinc-300">
                  <span className="text-zinc-500">from</span> {c.claimant_chain_peer_id}
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="text-zinc-500">claimant</span>
                  <CopyableAddress className="font-mono" address={c.claimant_address} />
                </div>
                <div className="mt-0.5 text-zinc-500">
                  {expired
                    ? "Expired — it can no longer be confirmed."
                    : `Expires ${timeAgo(c.expires_at)}`}
                </div>
              </div>
              <button
                onClick={() => confirm(c)}
                disabled={expired || pending === key}
                title={
                  expired
                    ? "This challenge has expired; the claimant must start the link again"
                    : "Sign the proof that you hold this address"
                }
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {pending === key ? "Confirming…" : "Confirm"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
