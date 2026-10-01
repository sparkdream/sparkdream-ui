"use client";

import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import CrossChainSendForm from "@/components/transfer/CrossChainSendForm";

export default function TransferPage() {
  const { connected, ready } = useWallet();
  const { config } = useChainConfig();

  const header = (
    <header className="sd-page-header">
      <span className="crumb">System</span>
      <h1>Send to other chains</h1>
      <p>Move {config.displayDenom} to the chains relayed to this one over IBC</p>
    </header>
  );

  if (!ready) {
    return (
      <div className="sd-page">
        {header}
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="sd-page">
        {header}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">Connect your wallet to send {config.displayDenom} to another chain</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sd-page">
      {header}
      <div className="max-w-2xl">
        <CrossChainSendForm />
      </div>
    </div>
  );
}
