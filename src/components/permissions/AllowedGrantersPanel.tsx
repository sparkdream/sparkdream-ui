"use client";

import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { SessionMsgTypeUrls } from "@/lib/tx";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import NameOrAddress from "@/components/NameOrAddress";

/**
 * Addresses whose session keys and sign-in grants to you skip the
 * acceptance step (chain v1.0.57). Accepting one grant adds its sender here;
 * removing one leaves its existing grants alone, so the next one waits again.
 */
export default function AllowedGrantersPanel({
  granters,
  onChanged,
}: {
  granters: string[];
  onChanged: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const tx = useTxAction();
  if (granters.length === 0) return null;

  const remove = (granter: string) =>
    tx.run(
      granter,
      async () => {
        await signAndBroadcast([
          { typeUrl: SessionMsgTypeUrls.DisallowGranter, value: { grantee: signerAddress, granter } },
        ]);
        onChanged();
      },
      "Remove failed"
    );

  return (
    <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-semibold text-white">Accepted senders</h2>
      <p className="mt-1 text-xs text-zinc-400">
        New session keys and sign-in grants from these addresses work right away. Remove one to make its next
        grant wait for you to accept it again. Grants you already hold from it stay until you decline them.
      </p>
      <ul className="mt-3 divide-y divide-zinc-800">
        {granters.map((g) => (
          <li key={g} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <NameOrAddress address={g} className="text-zinc-300" />
              <CopyableAddress className="font-mono text-zinc-600" address={g} />
            </span>
            <button
              type="button"
              onClick={() => remove(g)}
              disabled={tx.busy}
              className="rounded px-3 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            >
              {tx.pending === g ? "Removing..." : "Remove"}
            </button>
          </li>
        ))}
      </ul>
      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </section>
  );
}
