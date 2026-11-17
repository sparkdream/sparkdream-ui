"use client";

import { Suspense, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import ConnectPrompt from "@/components/layout/ConnectPrompt";
import RequestList from "@/components/storage/RequestList";
import RequestDetail from "@/components/storage/RequestDetail";
import RequestForm from "@/components/storage/RequestForm";

// What the URL can address: the list, the request form (?new=1) or a request
// (?request=3). Ids are uint64, so only digits are accepted.
interface Route {
  requestId: string | null;
  creating: boolean;
}

function parseRoute(sp: URLSearchParams): Route {
  const r = sp.get("request");
  return { requestId: r && /^\d+$/.test(r) ? r : null, creating: sp.get("new") === "1" };
}

function routeToQuery(r: Route): string {
  if (r.requestId) return `?request=${r.requestId}`;
  if (r.creating) return "?new=1";
  return "";
}

export default function StoragePage() {
  return (
    <Suspense fallback={null}>
      <StoragePageInner />
    </Suspense>
  );
}

function StoragePageInner() {
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
      router.push(`/storage${routeToQuery(next)}`, { scroll: false });
    },
    [router]
  );
  const back = () => {
    if (pushes.current > 0) {
      pushes.current -= 1;
      router.back();
    } else {
      go({ requestId: null, creating: false });
    }
  };
  const openRequest = (requestId: string) => go({ requestId, creating: false });
  const create = () => go({ requestId: null, creating: true });

  const header = (
    <header className="sd-page-header">
      <span className="crumb">System</span>
      <h1>Permanent copies</h1>
      <p>Images copied for good to a storage network where nothing can be deleted</p>
      {connected && !route.requestId && !route.creating && (
        <button type="button" onClick={create} className="sd-btn sd-btn-primary w-fit" style={{ marginLeft: "auto" }}>
          Request a copy
        </button>
      )}
    </header>
  );

  let body: React.ReactNode;
  if (!ready) {
    body = <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />;
  } else if (route.requestId) {
    // Anyone can look at a request; actions need a wallet.
    body = <RequestDetail key={route.requestId} id={route.requestId} onBack={back} />;
  } else if (route.creating && !connected) {
    body = <ConnectPrompt message="Connect your wallet to request a permanent copy" />;
  } else if (route.creating) {
    body = (
      <RequestForm
        onCreated={(id) => {
          // Replace the form so Back doesn't return to a submitted form.
          router.replace(`/storage${routeToQuery({ requestId: id, creating: false })}`, { scroll: false });
        }}
        onOpenExisting={openRequest}
        onCancel={back}
      />
    );
  } else {
    body = (
      <>
        <RequestList onOpen={openRequest} onCreate={create} />
        {!connected && <ConnectPrompt message="Connect your wallet to see your requests or ask for a copy" />}
      </>
    );
  }

  return (
    <div className="sd-page">
      {header}
      {body}
    </div>
  );
}
