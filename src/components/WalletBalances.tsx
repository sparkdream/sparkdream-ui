"use client";

import { useEffect, useState } from "react";
import { getAllBankBalances, getRepMember } from "@/lib/api";
import { primeRepMember } from "@/lib/repMember";
import { ApiError } from "@/lib/errors";
import { formatDream } from "@/lib/reveal-fmt";
import { formatSpark } from "@/lib/utils";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useWallet } from "@/contexts/WalletContext";
import { useDreamDenom } from "@/hooks/useDreamDenom";

const POLL_MS = 30_000;

/**
 * Dual-token balance chip for the header identity block.
 *
 * The two balances live in different places, which is invisible to users and
 * regularly reads as "missing funds":
 *  - SPARK (bond denom) is a normal bank coin — `x/bank` balances.
 *  - DREAM is NOT a bank coin on this chain: it is accounted on the x/rep
 *    Member record (`dream_balance`), so wallets and bank queries show
 *    nothing. Fetch it from `/rep/v1/member/<addr>` (non-members hold none).
 *
 * Polls both on a slow cadence; any failed fetch keeps the last good value
 * rather than flashing to zero.
 */
export default function WalletBalances() {
  const { config } = useChainConfig();
  const { address, connected } = useWallet();
  const dream = useDreamDenom();
  const [sparkMicro, setSparkMicro] = useState<string | null>(null);
  const [dreamMicro, setDreamMicro] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !address) return;
    let cancelled = false;
    const read = async () => {
      try {
        const res = await getAllBankBalances(address, { limit: "200" });
        if (cancelled) return;
        const bond = (res.balances || []).find((b) => b.denom === config.denom);
        setSparkMicro(bond?.amount ?? "0");
      } catch {
        // keep last good value
      }
      try {
        // Read through to the endpoint rather than `loadRepMember`: that
        // helper caches for 5 minutes with no invalidation, so on this
        // cadence the chip would show a pre-transaction balance while SPARK
        // updated beside it. Prime the shared cache with what we get back so
        // the page's other rep hooks see the fresh record too.
        const res = await getRepMember(address);
        if (cancelled) return;
        const member = res.member?.address ? res.member : null;
        primeRepMember(address, member);
        setDreamMicro(member?.dream_balance ?? "0");
      } catch (err) {
        // A 404 is the honest answer that this key holds no DREAM (it is not
        // a registered rep member). Any other failure — node down, timeout —
        // must keep the last good value: rendering "0" here is the exact
        // false "missing funds" this component exists to prevent.
        if (err instanceof ApiError && err.status === 404) {
          if (cancelled) return;
          primeRepMember(address, null);
          setDreamMicro("0");
        }
      }
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connected, address, config.denom]);

  if (!connected) return null;

  return (
    <div
      className="hidden flex-col leading-tight sm:flex"
      title={`SPARK (bank coin, x/bank balances) and DREAM (member account, x/rep record — DREAM is not a bank token on this chain)`}
    >
      <span className="font-mono text-[11px] text-zinc-400">
        {sparkMicro === null ? "…" : `${formatSpark(sparkMicro, { maxFractionDigits: 2 })} ${config.displayDenom}`}
      </span>
      <span className="font-mono text-[11px] text-zinc-500">
        {dreamMicro === null
          ? "…"
          : `${formatDream(dreamMicro)} ${dream}`}
      </span>
    </div>
  );
}
