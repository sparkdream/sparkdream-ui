"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useContentLicense } from "@/hooks/useContentLicense";
import { useTxAction } from "@/hooks/useTxAction";
import ActionBanner from "@/components/ActionBanner";
import ContentLicenseNotice from "@/components/license/ContentLicenseNotice";
import NumberInput from "@/components/NumberInput";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { getArtifactParams, invalidateArtifacts } from "@/lib/artifactApi";
import { formatSpark, parseSparkToUspark } from "@/lib/utils";
import type { ArtifactParams } from "@/types/artifact";
import { burnAuthorizationFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/types";
import type { MsgCreateClass } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import {
  FieldLabel,
  RoyaltySplitEditor,
  fieldCls,
  localInputToUnix,
  looksLikeAddress,
  parseAddressList,
  royaltyRowsToShares,
  txFailure,
  type RoyaltyRow,
} from "./shared";

// What a class is for. Each kind fixes `transferable` and `burn_authorization`
// for the life of the class.
const KINDS = [
  {
    id: "collectible",
    label: "Collectible",
    desc: "Holders can transfer, sell and burn their tokens.",
    transferable: true,
    burn: "BURN_AUTHORIZATION_HOLDER",
  },
  {
    id: "badge",
    label: "Soulbound badge",
    desc: "Can't be transferred or sold. Holders can burn theirs.",
    transferable: false,
    burn: "BURN_AUTHORIZATION_HOLDER",
  },
  {
    id: "revocable",
    label: "Revocable badge",
    desc: "Soulbound. Either the holder or you can burn it, for credentials you may need to withdraw.",
    transferable: false,
    burn: "BURN_AUTHORIZATION_HOLDER_OR_ISSUER",
  },
  {
    id: "issuer",
    label: "Issuer-held badge",
    desc: "Soulbound, and only you can burn it. Recipients must accept each one from their inbox.",
    transferable: false,
    burn: "BURN_AUTHORIZATION_ISSUER",
  },
] as const;

export interface MintPolicyState {
  enabled: boolean;
  price: string;
  start: string;
  end: string;
  limit: string;
}

export function MintPolicyFields({
  value,
  onChange,
  soulbound,
  displayDenom,
  disabled,
}: {
  value: MintPolicyState;
  onChange: (v: MintPolicyState) => void;
  soulbound: boolean;
  displayDenom: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<MintPolicyState>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          disabled={disabled}
        />
        Anyone can mint from this class
      </label>
      {value.enabled && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <FieldLabel
            label={`Price per token (${displayDenom})`}
            hint={soulbound ? "Soulbound tokens can't be sold, so public mints are free." : "0 for free."}
          >
            <input
              value={soulbound ? "0" : value.price}
              onChange={(e) => set({ price: e.target.value })}
              inputMode="decimal"
              className={fieldCls}
              disabled={disabled || soulbound}
            />
          </FieldLabel>
          <FieldLabel label="Limit per address" hint="0 for no limit.">
            <NumberInput
              value={value.limit}
              min={0}
              onChange={(e) => set({ limit: e.target.value })}
              className={fieldCls}
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Opens" hint="Blank to open now.">
            <input
              type="datetime-local"
              value={value.start}
              onChange={(e) => set({ start: e.target.value })}
              className={fieldCls}
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Closes" hint="Blank for no end.">
            <input
              type="datetime-local"
              value={value.end}
              onChange={(e) => set({ end: e.target.value })}
              className={fieldCls}
              disabled={disabled}
            />
          </FieldLabel>
        </div>
      )}
    </div>
  );
}

/** Mint policy form state to the camelCase MintPolicy, or an error. The price Coin is always sent. */
export function mintPolicyToMsg(v: MintPolicyState, soulbound: boolean, denom: string) {
  const price = soulbound || !v.enabled ? "0" : parseSparkToUspark(v.price.trim() || "0");
  if (price === null) return { error: "Enter a valid price.", policy: null };
  const startTime = localInputToUnix(v.start);
  const endTime = localInputToUnix(v.end);
  if (startTime > BigInt(0) && endTime > BigInt(0) && endTime <= startTime) {
    return { error: "The closing time must be after the opening time.", policy: null };
  }
  const limit = Number(v.limit || "0");
  if (!Number.isInteger(limit) || limit < 0) return { error: "The per-address limit must be a whole number.", policy: null };
  return {
    error: null,
    policy: {
      publicMintEnabled: v.enabled,
      price: { denom, amount: price },
      startTime,
      endTime,
      perAddressLimit: limit,
    },
  };
}

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export default function CreateClassForm({ onCreated, onCancel }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const license = useContentLicense();
  const { pending, error, clearError, setError, run } = useTxAction();
  const [params, setParams] = useState<ArtifactParams | null>(null);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [uri, setUri] = useState("");
  const [uriHash, setUriHash] = useState("");
  const [tokenUriBase, setTokenUriBase] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("collectible");
  const [mutable, setMutable] = useState(false);
  const [maxSupply, setMaxSupply] = useState("0");
  const [royaltyPct, setRoyaltyPct] = useState("0");
  const [royaltyRows, setRoyaltyRows] = useState<RoyaltyRow[]>([]);
  const [payout, setPayout] = useState("");
  const [minters, setMinters] = useState("");
  const [policy, setPolicy] = useState<MintPolicyState>({ enabled: false, price: "0", start: "", end: "", limit: "0" });
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    getArtifactParams()
      .then((r) => setParams(r.params))
      .catch(() => setParams(null));
  }, []);

  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0];
  const soulbound = !k.transferable;
  const maxRoyaltyBps = params?.max_royalty_bps ?? 1000;

  const submit = async () => {
    if (!address) return;
    if (!name.trim()) return setError("Give the class a name.");
    if (symbol && !/^[A-Z0-9]+$/.test(symbol)) return setError("The symbol may only use A-Z and 0-9.");
    if (uriHash.trim() && !/^[0-9a-f]{64}$/i.test(uriHash.trim())) return setError("The URI hash must be a 64 character hex SHA-256.");
    if (/^data:/i.test(uri.trim()) || /^data:/i.test(tokenUriBase.trim())) return setError("Data URIs aren't allowed. Link to the file instead.");
    if (!/^\d+$/.test(maxSupply || "0")) return setError("Max supply must be a whole number.");
    const royaltyBps = soulbound ? 0 : Math.round(Number(royaltyPct || "0") * 100);
    if (!Number.isFinite(royaltyBps) || royaltyBps < 0) return setError("Enter a valid royalty.");
    if (royaltyBps > maxRoyaltyBps) return setError(`The royalty can be at most ${maxRoyaltyBps / 100}%.`);
    const split = royaltyRowsToShares(soulbound ? [] : royaltyRows, config.bech32Prefix);
    if (split.error) return setError(split.error);
    if (payout.trim() && !looksLikeAddress(payout, config.bech32Prefix)) return setError("The payout address isn't valid.");
    const minterList = parseAddressList(minters).filter((m) => m !== address);
    const bad = minterList.find((m) => !looksLikeAddress(m, config.bech32Prefix));
    if (bad) return setError(`"${bad}" isn't a valid minter address.`);
    const mp = mintPolicyToMsg(policy, soulbound, config.denom);
    if (!mp.policy) return setError(mp.error);
    if (!agreed) return setError("Confirm the public domain dedication first.");

    await run("create", async () => {
      const value: MsgCreateClass = {
        creator: address,
        name: name.trim(),
        symbol: symbol.trim(),
        description: description.trim(),
        uri: uri.trim(),
        uriHash: uriHash.trim().toLowerCase(),
        tokenUriBase: tokenUriBase.trim(),
        flags: {
          transferable: k.transferable,
          burnAuthorization: burnAuthorizationFromJSON(k.burn),
          tokenMetadataMutable: mutable,
        },
        maxSupply: BigInt(maxSupply || "0"),
        mintPolicy: mp.policy!,
        payoutAddress: payout.trim(),
        royaltyBps,
        royaltyRecipients: split.shares,
        minters: minterList,
        acceptedContentLicense: license.license,
      };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.CreateClass, value }]);
      invalidateArtifacts();
      onCreated();
    }, txFailure("Couldn't create the class"));
  };

  const fee = params?.class_creation_fee;

  return (
    <div className="sd-hull-tile space-y-5 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">New class</h2>
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">Cancel</button>
      </div>
      <p className="text-sm text-zinc-400">
        A class groups tokens issued under one set of rules. Its kind can&apos;t change later, so pick carefully.
      </p>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-zinc-200">Kind</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KINDS.map((x) => (
            <label
              key={x.id}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${kind === x.id ? "border-indigo-500/60 bg-indigo-500/10" : "border-zinc-800 hover:border-zinc-700"}`}
            >
              <span className="flex items-center gap-2 font-medium text-zinc-100">
                <input type="radio" name="artifact-kind" checked={kind === x.id} onChange={() => setKind(x.id)} />
                {x.label}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-400">{x.desc}</span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={mutable} onChange={(e) => setMutable(e.target.checked)} />
          Let me edit token metadata after minting, until I freeze it
        </label>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} maxLength={params?.max_name_length || 128} />
        </FieldLabel>
        <FieldLabel label="Symbol" hint="Optional. A-Z and 0-9. Not unique, so it proves nothing on its own.">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className={`${fieldCls} font-mono`}
            maxLength={params?.max_symbol_length || 16}
          />
        </FieldLabel>
        <div className="sm:col-span-2">
          <FieldLabel label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={fieldCls} />
          </FieldLabel>
        </div>
        <FieldLabel label="Cover media URI" hint="Optional. ipfs://, ar:// or https://.">
          <input value={uri} onChange={(e) => setUri(e.target.value)} className={fieldCls} />
        </FieldLabel>
        <FieldLabel label="Cover media SHA-256" hint="Optional, lowercase hex.">
          <input value={uriHash} onChange={(e) => setUriHash(e.target.value)} className={`${fieldCls} font-mono text-xs`} />
        </FieldLabel>
        <div className="sm:col-span-2">
          <FieldLabel label="Token URI base" hint="Optional. A token without its own media uses this plus its id.">
            <input value={tokenUriBase} onChange={(e) => setTokenUriBase(e.target.value)} className={fieldCls} />
          </FieldLabel>
        </div>
        <FieldLabel label="Max supply" hint="0 for no cap. You can lower it or add a cap later, never raise it.">
          <NumberInput value={maxSupply} min={0} onChange={(e) => setMaxSupply(e.target.value)} className={fieldCls} />
        </FieldLabel>
        <FieldLabel label="Payout address" hint="Receives public mint proceeds. Blank for you.">
          <input value={payout} onChange={(e) => setPayout(e.target.value)} className={`${fieldCls} font-mono text-xs`} />
        </FieldLabel>
      </section>

      {!soulbound && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Royalty</h3>
          <p className="text-xs text-zinc-500">
            Paid on sales through the Spark Dream market only. You can lower it later, never raise it. Up to {maxRoyaltyBps / 100}%.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={royaltyPct}
              onChange={(e) => setRoyaltyPct(e.target.value)}
              inputMode="decimal"
              className={`${fieldCls} w-24`}
            />
            <span className="text-sm text-zinc-400">%</span>
          </div>
          <p className="text-xs text-zinc-500">Split it across several addresses, or leave this empty to receive it all.</p>
          <RoyaltySplitEditor rows={royaltyRows} onChange={setRoyaltyRows} />
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-zinc-200">Public mint</h3>
        <MintPolicyFields value={policy} onChange={setPolicy} soulbound={soulbound} displayDenom={config.displayDenom} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-zinc-200">Minters</h3>
        <p className="text-xs text-zinc-500">
          Other addresses that may mint, one per line. Optional. Each pays its own token deposits.
        </p>
        <textarea value={minters} onChange={(e) => setMinters(e.target.value)} rows={2} className={`${fieldCls} font-mono text-xs`} />
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-4">
        {fee && fee !== "0" && (
          <p className="text-xs text-zinc-400">
            Creating a class burns {formatSpark(fee)} {config.displayDenom}. It isn&apos;t refunded.
          </p>
        )}
        <ContentLicenseNotice what="The class and everything minted in it" />
        <label className="flex items-start gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
          <span>
            I dedicate this class&apos;s content and media to the public domain (CC0), and it&apos;s mine to dedicate or already public domain.
          </span>
        </label>
        <ActionBanner message={error} onDismiss={clearError} />
        <button
          onClick={submit}
          disabled={pending === "create" || !address}
          className="sd-btn sd-btn-primary w-full justify-center"
        >
          {pending === "create" ? "Creating…" : "Create class"}
        </button>
      </section>
    </div>
  );
}
