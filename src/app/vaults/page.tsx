"use client";

import { Suspense, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import ConnectPrompt from "@/components/layout/ConnectPrompt";
import { invalidateVaults } from "@/lib/vaultApi";
import VaultList from "@/components/vaults/VaultList";
import VaultDetail from "@/components/vaults/VaultDetail";
import CreateVaultForm from "@/components/vaults/CreateVaultForm";

// What the URL can address: the list, the create form (?new=1) or a vault
// (?vault=3). Ids are uint64, so only digits are accepted.
interface Route {
  vaultId: string | null;
  creating: boolean;
}

function parseRoute(sp: URLSearchParams): Route {
  const v = sp.get("vault");
  return { vaultId: v && /^\d+$/.test(v) ? v : null, creating: sp.get("new") === "1" };
}

function routeToQuery(r: Route): string {
  if (r.vaultId) return `?vault=${r.vaultId}`;
  if (r.creating) return "?new=1";
  return "";
}

export default function VaultsPage() {
  return (
    <Suspense fallback={null}>
      <VaultsPageInner />
    </Suspense>
  );
}

function VaultsPageInner() {
  const { connected, ready } = useWallet();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const route = useMemo(() => parseRoute(new URLSearchParams(queryString)), [queryString]);

  // Pushes made from this page, so Back returns within it and never leaves
  // the site after a deep link.
  const pushes = useRef(0);
  const go = useCallback(
    (next: Route) => {
      pushes.current += 1;
      router.push(`/vaults${routeToQuery(next)}`, { scroll: false });
    },
    [router]
  );
  const back = () => {
    if (pushes.current > 0) {
      pushes.current -= 1;
      router.back();
    } else {
      go({ vaultId: null, creating: false });
    }
  };
  const openVault = (vaultId: string) => go({ vaultId, creating: false });

  const header = (
    <header className="sd-page-header">
      <span className="crumb">System</span>
      <h1>Vaults</h1>
      <p>Shared accounts that spend only when enough of their signers approve</p>
      {connected && !route.vaultId && !route.creating && (
        <button
          type="button"
          onClick={() => go({ vaultId: null, creating: true })}
          className="sd-btn sd-btn-primary w-fit"
          style={{ marginLeft: "auto" }}
        >
          New vault
        </button>
      )}
    </header>
  );

  let body: React.ReactNode;
  if (!ready) {
    body = <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />;
  } else if (route.vaultId) {
    // Anyone can look at a vault; signer actions need a wallet.
    body = <VaultDetail key={route.vaultId} vaultId={route.vaultId} onBack={back} />;
  } else if (!connected) {
    body = <ConnectPrompt message={route.creating ? "Connect your wallet to create a vault" : "Connect your wallet to see your vaults"} />;
  } else if (route.creating) {
    body = (
      <CreateVaultForm
        onCreated={(id) => {
          invalidateVaults();
          // Replace the form so Back doesn't return to a submitted form.
          router.replace(`/vaults${routeToQuery({ vaultId: id, creating: false })}`, { scroll: false });
        }}
        onCancel={back}
      />
    );
  } else {
    body = <VaultList onOpen={openVault} onCreate={() => go({ vaultId: null, creating: true })} />;
  }

  return (
    <div className="sd-page">
      {header}
      {body}
    </div>
  );
}
