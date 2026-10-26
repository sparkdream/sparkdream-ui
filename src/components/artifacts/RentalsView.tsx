"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import { getArtifactToken, listArtifactRentalOffers, listArtifactRentalsByUser } from "@/lib/artifactApi";
import { isMissingEndpoint } from "@/lib/errors";
import { timeRemaining } from "@/lib/utils";
import type { Rental, RentalOffer } from "@/types/artifact";
import { formatCoin, formatSeconds, shownToken, tokenRef, tokenTitle } from "./shared";

interface Props {
  onSelectToken: (classId: string, tokenId: string) => void;
}

function orEmpty<T>(p: Promise<T>, empty: T): Promise<T> {
  return p.catch((err) => {
    if (isMissingEndpoint(err)) return empty;
    throw err;
  });
}

/** Tokens rented to the connected account, and rental offers it can take. */
export default function RentalsView({ onSelectToken }: Props) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const { isMine } = useMyAliases();
  const [rentals, setRentals] = useState<Rental[] | null>(null);
  const [forMe, setForMe] = useState<RentalOffer[] | null>(null);
  const [open, setOpen] = useState<RentalOffer[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setError(null);
    try {
      const [r, mine, all] = await Promise.all([
        orEmpty(listArtifactRentalsByUser(address, { limit: "100" }), { rentals: [] as Rental[] }),
        orEmpty(listArtifactRentalOffers(address, { limit: "100" }), { offers: [] as RentalOffer[] }),
        orEmpty(listArtifactRentalOffers(undefined, { limit: "50" }), { offers: [] as RentalOffer[] }),
      ]);
      setRentals(r.rentals || []);
      setForMe(mine.offers || []);
      setOpen((all.offers || []).filter((o) => !o.user));
      const refs = [...(r.rentals || []), ...(mine.offers || []), ...(all.offers || [])];
      for (const x of refs) {
        const k = tokenRef(x.class_id, x.token_id);
        getArtifactToken(x.class_id, x.token_id)
          .then((t) => setLabels((prev) => ({ ...prev, [k]: tokenTitle(shownToken(t.token), t.token.withheld) })))
          .catch(() => {});
      }
    } catch (err) {
      setError(err);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;

  const row = (key: string, classId: string, tokenId: string, left: React.ReactNode, right: React.ReactNode) => (
    <button
      key={key}
      onClick={() => onSelectToken(classId, tokenId)}
      className="sd-hull-tile interactive flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-zinc-100">{labels[tokenRef(classId, tokenId)] || `Token #${tokenId}`}</span>
          <span className="font-mono text-[11px] text-zinc-500">{tokenRef(classId, tokenId)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">{left}</div>
      </div>
      <span className="shrink-0 text-sm">{right}</span>
    </button>
  );

  const section = (title: string, items: React.ReactNode[] | null, empty: string) => (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-300">{title}</h3>
      {items === null ? (
        <div className="h-14 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      ) : items.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-6 text-center text-sm text-zinc-500">{empty}</div>
      ) : (
        items
      )}
    </section>
  );

  const offerRow = (o: RentalOffer) =>
    row(
      `offer-${o.class_id}-${o.token_id}`,
      o.class_id,
      o.token_id,
      <>
        <span>from</span>
        <CopyableAddress address={o.owner} resolveName nested className="text-zinc-400" />
        <span>· for {formatSeconds(o.duration)}</span>
        {o.expires_at && <span>· open {timeRemaining(o.expires_at)}</span>}
      </>,
      <span className="font-semibold text-amber-200">{formatCoin(o.price, config.displayDenom)}</span>
    );

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        A rental lends a token&apos;s use, not its ownership, for a set time. Open a token to rent it or hand it back.
      </p>
      {section(
        "Rented to you",
        rentals &&
          rentals.map((r) =>
            row(
              `rental-${r.class_id}-${r.token_id}`,
              r.class_id,
              r.token_id,
              <>
                <span>from</span>
                <CopyableAddress address={r.owner} resolveName nested className="text-zinc-400" />
                {r.owner_may_end && <span>· the owner may end it early</span>}
              </>,
              <span className="text-zinc-300">{r.expires_at ? timeRemaining(r.expires_at) : ""}</span>
            )
          ),
        "Nothing rented to you."
      )}
      {section("Offers for you", forMe && forMe.map(offerRow), "No rental offers addressed to you.")}
      {section("Open to anyone", open && open.filter((o) => !isMine(o.owner)).map(offerRow), "No open rental offers.")}
    </div>
  );
}
