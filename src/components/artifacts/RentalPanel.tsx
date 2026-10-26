"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { getTxMsgResponses } from "@/lib/api";
import { getArtifactRental, getArtifactRentalOffer } from "@/lib/artifactApi";
import { formatTime, timeRemaining } from "@/lib/utils";
import { TokenLock, type ArtifactClass, type ArtifactParams, type Rental, type RentalOffer, type TokenView } from "@/types/artifact";
import {
  MsgOfferRentalResponse,
  type MsgAcceptRental,
  type MsgCancelRentalOffer,
  type MsgEndRental,
  type MsgOfferRental,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import {
  FieldLabel,
  Note,
  daysToSeconds,
  fieldCls,
  formatCoin,
  formatSeconds,
  isHarbergerClass,
  isHidden,
  isTransferable,
  lockOf,
  looksLikeAddress,
  nowUnix,
  parseSparkToUsparkOrZero,
  useArtifactTx,
} from "./shared";

/**
 * Renting a token's user right: the owner offers terms (optionally to one
 * address), a renter accepts and pays, and the token is RENTED until the
 * rental ends. Ownership never moves.
 */
export default function RentalPanel({
  cls,
  view,
  params,
  isHolder,
  onChanged,
}: {
  cls: ArtifactClass;
  view: TokenView;
  params: ArtifactParams | null;
  isHolder: boolean;
  onChanged: () => void;
}) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const { isMine } = useMyAliases();
  const t = view.token;
  const [rental, setRental] = useState<Rental | null>(null);
  const [offer, setOffer] = useState<RentalOffer | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ user: "", price: "", days: "7", ownerMayEnd: false, offerDays: "7" });

  const load = useCallback(() => {
    getArtifactRental(t.class_id, t.id).then(setRental).catch(() => setRental(null));
    getArtifactRentalOffer(t.class_id, t.id).then(setOffer).catch(() => setOffer(null));
  }, [t.class_id, t.id]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = useCallback(() => {
    load();
    onChanged();
  }, [load, onChanged]);
  const { pending, error, clearError, setError, send } = useArtifactTx(changed);

  const lock = lockOf(t);
  const rentable =
    isTransferable(cls) && !isHarbergerClass(cls) && !t.parent?.token_id && !view.withheld && !isHidden(t.status) && !isHidden(cls.status);
  const maxRentalDays = params?.max_rental_duration ? Number(params.max_rental_duration) / 86400 : 90;
  const maxOfferDays = params?.max_listing_duration ? Number(params.max_listing_duration) / 86400 : 30;
  const busy = pending !== null;
  const activeRental = rental && rental.user ? rental : null;
  const openOffer = offer && offer.owner && !activeRental ? offer : null;

  if (!activeRental && !openOffer && !(isHolder && rentable && lock === TokenLock.NONE)) return null;

  const offerRental = () => {
    if (!address) return;
    const user = form.user.trim();
    if (user && !looksLikeAddress(user, config.bech32Prefix)) return setError("Enter a valid renter address, or leave it blank.");
    if (user && isMine(user)) return setError("You can't rent to yourself.");
    const amount = parseSparkToUsparkOrZero(form.price);
    if (amount === null) return setError("Enter a valid price (0 for free).");
    const duration = daysToSeconds(form.days);
    if (!duration || duration > maxRentalDays * 86400) return setError(`A rental can last up to ${Math.floor(maxRentalDays)} days.`);
    const offerDuration = daysToSeconds(form.offerDays);
    if (!offerDuration || offerDuration > maxOfferDays * 86400) return setError(`The offer can stay open up to ${Math.floor(maxOfferDays)} days.`);
    if (t.expires_at && t.expires_at !== "0" && nowUnix() + duration > Number(t.expires_at)) {
      return setError("The rental would outlast the token. Renew it first or shorten the rental.");
    }
    const value: MsgOfferRental = {
      owner: address,
      classId: BigInt(t.class_id),
      tokenId: BigInt(t.id),
      user,
      price: { denom: config.denom, amount },
      duration: BigInt(duration),
      ownerMayEnd: form.ownerMayEnd,
      offerDuration: BigInt(offerDuration),
    };
    return send("offer", { typeUrl: ArtifactMsgTypeUrls.OfferRental, value }, "Couldn't offer the rental", async (hash) => {
      setShowForm(false);
      try {
        for (const r of await getTxMsgResponses(hash)) {
          if (r.typeUrl === "/sparkdream.artifact.v1.MsgOfferRentalResponse") {
            setNotice(`Rental offered (offer #${MsgOfferRentalResponse.decode(r.value).nonce}). Share this page with the renter.`);
          }
        }
      } catch {
        // The offer shows below either way.
      }
    });
  };

  const cancelOffer = () => {
    if (!address) return;
    const value: MsgCancelRentalOffer = { owner: address, classId: BigInt(t.class_id), tokenId: BigInt(t.id) };
    return send("cancel", { typeUrl: ArtifactMsgTypeUrls.CancelRentalOffer, value }, "Couldn't cancel the offer");
  };

  const accept = () => {
    if (!address || !openOffer) return;
    const value: MsgAcceptRental = {
      renter: address,
      classId: BigInt(t.class_id),
      tokenId: BigInt(t.id),
      // The terms as shown: a changed offer, metadata or set of nested tokens fails the accept.
      expectedPrice: { denom: openOffer.price?.denom || config.denom, amount: openOffer.price?.amount || "0" },
      expectedNonce: BigInt(openOffer.nonce || "0"),
      expectedMetadataHash: view.metadata_hash || "",
      expectedContentsHash: view.contents_hash || "",
    };
    return send("accept", { typeUrl: ArtifactMsgTypeUrls.AcceptRental, value }, "Couldn't rent the token");
  };

  const end = () => {
    if (!address) return;
    if (!confirm("End this rental now? Nothing is refunded.")) return;
    const value: MsgEndRental = { signer: address, classId: BigInt(t.class_id), tokenId: BigInt(t.id) };
    return send("end", { typeUrl: ArtifactMsgTypeUrls.EndRental, value }, "Couldn't end the rental");
  };

  return (
    <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Rental</h3>
        {isHolder && rentable && lock === TokenLock.NONE && !openOffer && !showForm && (
          <button onClick={() => setShowForm(true)} className="sd-btn sd-btn-secondary">Offer for rent</button>
        )}
      </div>

      {activeRental && (() => {
        const expired = Number(activeRental.expires_at || 0) <= nowUnix();
        const renter = isMine(activeRental.user);
        const owner = isMine(activeRental.owner);
        return (
          <div className="space-y-2 text-xs text-zinc-400">
            <p className="inline-flex flex-wrap items-center gap-1">
              Rented to <CopyableAddress address={activeRental.user} resolveName className="text-zinc-200" />
              {renter && <span className="text-emerald-300">(you)</span>}
              {activeRental.expires_at && <span>until {formatTime(activeRental.expires_at)} ({timeRemaining(activeRental.expires_at)})</span>}
              {activeRental.price && <span>· paid {formatCoin(activeRental.price, config.displayDenom)}</span>}
            </p>
            <p>
              {activeRental.owner_may_end ? "The owner may end it early." : "The owner can't end it early."}{" "}While rented, the token
              can&apos;t be sold, sent, burned or nested.
            </p>
            {(renter || (owner && (activeRental.owner_may_end || expired))) && (
              <button onClick={end} disabled={busy} className="sd-btn sd-btn-secondary">
                {pending === "end" ? "Ending…" : renter ? "Hand it back" : "End rental"}
              </button>
            )}
          </div>
        );
      })()}

      {openOffer && (
        <div className="space-y-2 text-xs text-zinc-400">
          <p>
            For rent: <span className="font-semibold text-amber-200">{formatCoin(openOffer.price, config.displayDenom)}</span> for{" "}
            {formatSeconds(openOffer.duration)}
            {openOffer.owner_may_end ? ", and the owner may end it early" : ""}.
            {openOffer.expires_at && ` Offer open ${timeRemaining(openOffer.expires_at)}.`}
          </p>
          {openOffer.user ? (
            <p className="inline-flex flex-wrap items-center gap-1">
              Only for <CopyableAddress address={openOffer.user} resolveName className="text-zinc-200" />.
            </p>
          ) : (
            <p>Anyone can accept.</p>
          )}
          {isMine(openOffer.owner) ? (
            <button onClick={cancelOffer} disabled={busy} className="sd-btn sd-btn-secondary">
              {pending === "cancel" ? "Cancelling…" : "Withdraw offer"}
            </button>
          ) : address && (!openOffer.user || isMine(openOffer.user)) ? (
            <button onClick={accept} disabled={busy || lock !== TokenLock.NONE} className="sd-btn sd-btn-verdigris">
              {pending === "accept" ? "Renting…" : `Rent for ${formatCoin(openOffer.price, config.displayDenom)}`}
            </button>
          ) : null}
        </div>
      )}

      {showForm && (
        <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
          <p className="text-xs text-zinc-500">
            Nothing is locked until someone accepts. The price is paid like a sale, so the fee and any royalty come out of it.
          </p>
          <FieldLabel label="Renter" hint="Optional. Leave blank to let anyone rent it.">
            <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} className={`${fieldCls} font-mono text-xs`} />
          </FieldLabel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <FieldLabel label={`Price (${config.displayDenom})`} hint="0 for free.">
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" className={fieldCls} />
            </FieldLabel>
            <FieldLabel label="Rental lasts (days)" hint={`Up to ${Math.floor(maxRentalDays)}.`}>
              <input value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} inputMode="decimal" className={fieldCls} />
            </FieldLabel>
            <FieldLabel label="Offer open (days)" hint={`Up to ${Math.floor(maxOfferDays)}.`}>
              <input value={form.offerDays} onChange={(e) => setForm({ ...form, offerDays: e.target.value })} inputMode="decimal" className={fieldCls} />
            </FieldLabel>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={form.ownerMayEnd} onChange={(e) => setForm({ ...form, ownerMayEnd: e.target.checked })} />
            I may end the rental early
          </label>
          <div className="flex gap-2">
            <button onClick={offerRental} disabled={busy} className="sd-btn sd-btn-verdigris">
              {pending === "offer" ? "Offering…" : "Offer rental"}
            </button>
            <button onClick={() => setShowForm(false)} className="sd-btn sd-btn-secondary">Cancel</button>
          </div>
        </div>
      )}
      {notice && <Note tone="info">{notice}</Note>}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}
