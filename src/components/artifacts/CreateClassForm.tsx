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
import { getTxMsgResponses } from "@/lib/api";
import { getArtifactNextClassId, getArtifactParams, invalidateArtifacts, listArtifactClasses } from "@/lib/artifactApi";
import {
  buildCommitTree,
  downloadJson,
  parseCommitTree,
  randomSaltHex,
  saveCommitTree,
  saveSeedSecret,
  seedCommitment,
  type CommitEntry,
  type CommitTree,
} from "@/lib/artifactCommit";
import { formatSpark, parseSparkToUspark } from "@/lib/utils";
import {
  EXPIRY_MODE_LABELS,
  ExpiryMode,
  MINT_PRICING_LABELS,
  MintPricing,
  RevealKind,
  TokenModel,
  type ArtifactParams,
  type MintPolicy,
} from "@/types/artifact";
import {
  burnAuthorizationFromJSON,
  expiryModeFromJSON,
  mintPricingFromJSON,
  revealKindFromJSON,
  tokenModelFromJSON,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/types";
import { MsgCreateClassResponse, type MsgCreateClass } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import {
  FieldLabel,
  Note,
  RoyaltySplitEditor,
  daysToSeconds,
  fieldCls,
  localInputToUnix,
  looksLikeAddress,
  nowUnix,
  unixToLocalInput,
  parseAddressList,
  royaltyRowsToShares,
  txFailure,
  type RoyaltyRow,
} from "./shared";

// What a class is for. Each kind fixes `transferable`, `burn_authorization`
// and `mutual` for the life of the class.
const KINDS = [
  {
    id: "collectible",
    label: "Collectible",
    desc: "Holders can transfer, sell and burn their tokens.",
    transferable: true,
    burn: "BURN_AUTHORIZATION_HOLDER",
    mutual: false,
  },
  {
    id: "badge",
    label: "Soulbound badge",
    desc: "Can't be transferred or sold. Holders can burn theirs.",
    transferable: false,
    burn: "BURN_AUTHORIZATION_HOLDER",
    mutual: false,
  },
  {
    id: "revocable",
    label: "Revocable badge",
    desc: "Soulbound. Either the holder or you can burn it, for credentials you may need to withdraw.",
    transferable: false,
    burn: "BURN_AUTHORIZATION_HOLDER_OR_ISSUER",
    mutual: false,
  },
  {
    id: "mutual",
    label: "Mutual attestation",
    desc: "Soulbound, and both sides agree: each recipient accepts from their inbox, and either of you can burn it later.",
    transferable: false,
    burn: "BURN_AUTHORIZATION_HOLDER_OR_ISSUER",
    mutual: true,
  },
  {
    id: "issuer",
    label: "Issuer-held badge",
    desc: "Soulbound, and only you can burn it. Recipients must accept each one from their inbox.",
    transferable: false,
    burn: "BURN_AUTHORIZATION_ISSUER",
    mutual: false,
  },
  {
    id: "permanent",
    label: "Permanent badge",
    desc: "Soulbound, and nobody can ever burn it, so each token's deposit is a fee instead. Recipients must accept each one.",
    transferable: false,
    burn: "BURN_AUTHORIZATION_NEITHER",
    mutual: false,
  },
] as const;

type KindId = (typeof KINDS)[number]["id"];

// The chain's compiled bounds (production builds): token terms, the reveal
// window and Harberger periods. A testnet build may allow shorter ones.
const MIN_TERM_SECONDS = 3600;
const MIN_REVEAL_WINDOW = 24 * 3600;
const MIN_HARBERGER_PERIOD = 24 * 3600;
const MAX_HARBERGER_PERIOD = 365 * 24 * 3600;

export interface MintPolicyState {
  enabled: boolean;
  price: string;
  start: string;
  end: string;
  limit: string;
  /** MintPricing name. */
  pricing: string;
  /** LINEAR_SUPPLY step, display units. */
  step: string;
  /** DUTCH floor, display units. */
  floor: string;
}

export function emptyMintPolicyState(): MintPolicyState {
  return { enabled: false, price: "0", start: "", end: "", limit: "0", pricing: MintPricing.FIXED, step: "0", floor: "0" };
}

/** Form state for an existing class's policy, so saving keeps what isn't edited (its price curve included). */
export function mintPolicyStateFrom(mp: MintPolicy | undefined): MintPolicyState {
  const display = (a?: string) => formatSpark(a || "0").replace(/,/g, "");
  return {
    enabled: !!mp?.public_mint_enabled,
    price: display(mp?.price?.amount),
    start: unixToLocalInput(mp?.start_time),
    end: unixToLocalInput(mp?.end_time),
    limit: String(mp?.per_address_limit ?? 0),
    pricing: mp?.pricing || MintPricing.FIXED,
    step: display(mp?.price_step),
    floor: display(mp?.floor_price),
  };
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
            label={value.pricing === MintPricing.FIXED || soulbound ? `Price per token (${displayDenom})` : `Starting price (${displayDenom})`}
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
          {!soulbound && (
            <FieldLabel label="Pricing">
              <select value={value.pricing} onChange={(e) => set({ pricing: e.target.value })} className={fieldCls} disabled={disabled}>
                {Object.values(MintPricing).map((p) => (
                  <option key={p} value={p}>{MINT_PRICING_LABELS[p]}</option>
                ))}
              </select>
            </FieldLabel>
          )}
          {!soulbound && value.pricing === MintPricing.LINEAR_SUPPLY && (
            <FieldLabel label={`Increase per mint (${displayDenom})`} hint="Added to the price for every token minted publicly so far.">
              <input value={value.step} onChange={(e) => set({ step: e.target.value })} inputMode="decimal" className={fieldCls} disabled={disabled} />
            </FieldLabel>
          )}
          {!soulbound && value.pricing === MintPricing.DUTCH && (
            <FieldLabel label={`Floor price (${displayDenom})`} hint="The price falls from the starting price at opening to this at closing.">
              <input value={value.floor} onChange={(e) => set({ floor: e.target.value })} inputMode="decimal" className={fieldCls} disabled={disabled} />
            </FieldLabel>
          )}
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
  const free = soulbound || !v.enabled;
  const price = free ? "0" : parseSparkToUspark(v.price.trim() || "0");
  if (price === null) return { error: "Enter a valid price.", policy: null };
  const startTime = localInputToUnix(v.start);
  const endTime = localInputToUnix(v.end);
  if (startTime > BigInt(0) && endTime > BigInt(0) && endTime <= startTime) {
    return { error: "The closing time must be after the opening time.", policy: null };
  }
  const limit = Number(v.limit || "0");
  if (!Number.isInteger(limit) || limit < 0) return { error: "The per-address limit must be a whole number.", policy: null };
  const pricing = free ? MintPricing.FIXED : v.pricing || MintPricing.FIXED;
  let priceStep = "";
  let floorPrice = "";
  if (pricing === MintPricing.LINEAR_SUPPLY) {
    const step = parseSparkToUspark(v.step.trim() || "0");
    if (step === null || BigInt(step) <= BigInt(0)) return { error: "Enter how much the price rises per mint.", policy: null };
    priceStep = step;
  } else if (pricing === MintPricing.DUTCH) {
    if (startTime === BigInt(0) || endTime === BigInt(0)) {
      return { error: "A falling price needs both an opening and a closing time.", policy: null };
    }
    const floor = parseSparkToUspark(v.floor.trim() || "0");
    if (floor === null || BigInt(floor) > BigInt(price)) return { error: "The floor can't be above the starting price.", policy: null };
    floorPrice = floor === "0" ? "" : floor;
  }
  return {
    error: null,
    policy: {
      publicMintEnabled: v.enabled,
      price: { denom, amount: price },
      startTime,
      endTime,
      perAddressLimit: limit,
      pricing: mintPricingFromJSON(pricing),
      priceStep,
      floorPrice,
    },
  };
}

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

/** Read a picked file as text. */
function readFile(file: File): Promise<string> {
  return file.text();
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
  const [kind, setKind] = useState<KindId>("collectible");
  const [model, setModel] = useState<string>(TokenModel.UNIQUE);
  const [mutable, setMutable] = useState(false);
  const [maxSupply, setMaxSupply] = useState("0");
  const [royaltyPct, setRoyaltyPct] = useState("0");
  const [royaltyRows, setRoyaltyRows] = useState<RoyaltyRow[]>([]);
  const [payout, setPayout] = useState("");
  const [minters, setMinters] = useState("");
  const [policy, setPolicy] = useState<MintPolicyState>(emptyMintPolicyState);
  const [agreed, setAgreed] = useState(false);

  // Tickets.
  const [redeemable, setRedeemable] = useState(false);
  const [redeemedTransferable, setRedeemedTransferable] = useState(false);
  // Expiry.
  const [expiryMode, setExpiryMode] = useState<string>(ExpiryMode.NONE);
  const [termDays, setTermDays] = useState("365");
  const [renewalPrice, setRenewalPrice] = useState("0");
  // Commit-reveal.
  const [revealKind, setRevealKind] = useState<string>(RevealKind.NONE);
  const [revealDeadline, setRevealDeadline] = useState(() => unixToLocalInput(String(nowUnix() + 7 * 86400)));
  const [entriesText, setEntriesText] = useState("");
  const [tree, setTree] = useState<CommitTree | null>(null);
  const [treeSaved, setTreeSaved] = useState(false);
  const [seed, setSeed] = useState("");
  const [seedSaved, setSeedSaved] = useState(false);
  const [predictedId, setPredictedId] = useState<string | null>(null);
  // Renderer.
  const [pkgPath, setPkgPath] = useState("");
  const [sourceHash, setSourceHash] = useState("");
  const [stateVersion, setStateVersion] = useState("0");
  // Harberger.
  const [harberger, setHarberger] = useState(false);
  const [taxPct, setTaxPct] = useState("5");
  const [taxPeriodDays, setTaxPeriodDays] = useState("30");
  const [foreclosureDays, setForeclosureDays] = useState("30");

  useEffect(() => {
    getArtifactParams()
      .then((r) => setParams(r.params))
      .catch(() => setParams(null));
  }, []);

  // A blind commitment binds the class id, which the chain assigns at
  // creation. Ask the chain which id comes next; the create then sends it as
  // expected_class_id, so if another class is created first the tx fails
  // instead of producing tokens that could never reveal. Bumped to re-read
  // the id after such a failure.
  const [idCheck, setIdCheck] = useState(0);
  useEffect(() => {
    if (revealKind !== RevealKind.BLIND_METADATA) return;
    let live = true;
    getArtifactNextClassId()
      // A node without the query: the newest class id plus one.
      .catch(() =>
        listArtifactClasses({ limit: "1", reverse: true }).then((r) =>
          String(BigInt(r.classes?.[0]?.class?.id || "0") + BigInt(1)),
        ),
      )
      .then((id) => live && setPredictedId(id))
      .catch(() => live && setPredictedId(null));
    return () => {
      live = false;
    };
  }, [revealKind, idCheck]);

  const k = KINDS.find((x) => x.id === kind) ?? KINDS[0];
  const soulbound = !k.transferable;
  const permanent = k.burn === "BURN_AUTHORIZATION_NEITHER";
  const editions = model === TokenModel.EDITIONS;
  const maxRoyaltyBps = params?.max_royalty_bps ?? 1000;

  // What the chain allows together (validateClassShape and ClassFlags.Validate).
  const canTicket = !editions && !k.mutual;
  const canExpire = !editions;
  const canReveal = !editions && !k.mutual && !permanent && !harberger;
  const canHarberger =
    !editions && kind === "collectible" && !redeemable && expiryMode === ExpiryMode.NONE && revealKind === RevealKind.NONE;
  const canRenderer = !editions && !!params?.renderers_enabled;
  const canPublicMint = !editions && !k.mutual;

  // Selecting something incompatible clears the options it rules out.
  const pickKind = (id: KindId) => {
    setKind(id);
    const nk = KINDS.find((x) => x.id === id) ?? KINDS[0];
    if (nk.mutual) {
      setRedeemable(false);
      setRevealKind(RevealKind.NONE);
      setPolicy((p) => ({ ...p, enabled: false }));
    }
    if (!nk.transferable) setRedeemedTransferable(false);
    if (nk.burn === "BURN_AUTHORIZATION_NEITHER") {
      if (expiryMode === ExpiryMode.BURN) setExpiryMode(ExpiryMode.NONE);
      setRevealKind(RevealKind.NONE);
    }
    if (id !== "collectible") setHarberger(false);
  };
  const pickModel = (m: string) => {
    setModel(m);
    if (m === TokenModel.EDITIONS) {
      if (k.mutual) setKind("badge");
      setRedeemable(false);
      setRedeemedTransferable(false);
      setExpiryMode(ExpiryMode.NONE);
      setRevealKind(RevealKind.NONE);
      setPkgPath("");
      setHarberger(false);
      setPolicy((p) => ({ ...p, enabled: false }));
    }
  };

  const buildTree = () => {
    if (!predictedId) return setError("Couldn't work out the next class id. Try again in a moment.");
    try {
      const entries = JSON.parse(entriesText) as CommitEntry[];
      if (!Array.isArray(entries)) throw new Error("Expected a list of tokens.");
      const t = buildCommitTree(BigInt(predictedId), entries);
      setTree(t);
      setTreeSaved(false);
      clearError();
    } catch (err) {
      setError(err instanceof Error ? `Couldn't build the commitment: ${err.message}` : "Couldn't build the commitment.");
    }
  };

  const loadTreeFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await readFile(file);
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        // An entries.json: build the tree here.
        setEntriesText(JSON.stringify(parsed, null, 2));
        setTree(null);
        return;
      }
      const t = parseCommitTree(text);
      setTree(t);
      setTreeSaved(false);
      clearError();
    } catch (err) {
      setError(err instanceof Error ? `That file didn't load: ${err.message}` : "That file didn't load.");
    }
  };

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
    const mp = mintPolicyToMsg(canPublicMint ? policy : emptyMintPolicyState(), soulbound, config.denom);
    if (!mp.policy) return setError(mp.error);

    // Expiry.
    let term = 0;
    let renewal = "0";
    if (canExpire && expiryMode !== ExpiryMode.NONE) {
      const t = daysToSeconds(termDays);
      if (!t) return setError("Enter how many days a token lasts.");
      term = t;
      const r = parseSparkToUspark(renewalPrice.trim() || "0");
      if (r === null) return setError("Enter a valid renewal price.");
      renewal = r;
    }

    // Commit-reveal.
    const rk = canReveal ? revealKind : RevealKind.NONE;
    let commitment = "";
    let deadline = BigInt(0);
    if (rk !== RevealKind.NONE) {
      deadline = localInputToUnix(revealDeadline);
      if (deadline === BigInt(0) || Number(deadline) < nowUnix() + 60) return setError("Pick a reveal deadline in the future.");
      if (rk === RevealKind.BLIND_METADATA) {
        if (!tree) return setError("Build or upload the commitment first.");
        if (predictedId && tree.class_id && tree.class_id !== predictedId) {
          return setError(`That commitment was built for class #${tree.class_id}, but this class will be #${predictedId}. Rebuild it.`);
        }
        if (!treeSaved) return setError("Download the reveal file and confirm you saved it.");
        commitment = tree.root;
      } else {
        try {
          commitment = seedCommitment(seed.trim());
        } catch (err) {
          return setError(err instanceof Error ? err.message : "Enter a valid seed.");
        }
        if (!seedSaved) return setError("Confirm you saved the seed.");
      }
    }

    // Renderer.
    const renderer = canRenderer && pkgPath.trim()
      ? { pkgPath: pkgPath.trim(), sourceHash: sourceHash.trim().toLowerCase(), stateVersion: Number(stateVersion) }
      : { pkgPath: "", sourceHash: "", stateVersion: 0 };
    if (renderer.pkgPath && !/^[0-9a-f]{64}$/.test(renderer.sourceHash)) {
      return setError("The renderer source hash must be a 64 character hex SHA-256.");
    }

    // Harberger.
    let hb = { taxBpsPerYear: 0, taxPeriod: BigInt(0), foreclosureDuration: BigInt(0) };
    if (canHarberger && harberger) {
      const bps = Math.round(Number(taxPct || "0") * 100);
      if (!Number.isFinite(bps) || bps <= 0 || bps > 10000) return setError("The yearly tax must be above 0% and at most 100%.");
      const period = daysToSeconds(taxPeriodDays);
      const fore = daysToSeconds(foreclosureDays);
      if (!period || !fore) return setError("Enter the tax period and foreclosure length in days.");
      hb = { taxBpsPerYear: bps, taxPeriod: BigInt(period), foreclosureDuration: BigInt(fore) };
    }

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
          mutual: k.mutual,
          redeemable: canTicket && redeemable,
          redeemedTransferable: canTicket && redeemable && k.transferable && redeemedTransferable,
        },
        maxSupply: BigInt(maxSupply || "0"),
        mintPolicy: mp.policy!,
        payoutAddress: payout.trim(),
        royaltyBps,
        royaltyRecipients: split.shares,
        minters: minterList,
        acceptedContentLicense: license.license,
        expiry: {
          mode: expiryModeFromJSON(canExpire ? expiryMode : ExpiryMode.NONE),
          term: BigInt(term),
          renewalPrice: { denom: config.denom, amount: renewal },
        },
        reveal: { kind: revealKindFromJSON(rk), commitment, deadline, revealedAt: BigInt(0), seed: "" },
        renderer,
        tokenModel: tokenModelFromJSON(model),
        harberger: hb,
        // The id the blind commitment binds: the chain refuses any other.
        expectedClassId: rk === RevealKind.BLIND_METADATA && tree?.class_id ? BigInt(tree.class_id) : BigInt(0),
      };
      let hash: string;
      try {
        hash = await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.CreateClass, value }]);
      } catch (err) {
        if (/would not get the expected id/.test(err instanceof Error ? err.message : String(err))) {
          setIdCheck((n) => n + 1);
          throw new Error(
            "Another class was created first, so this one would get a different id than the commitment binds. " +
              "Nothing was created. Rebuild the commitment for the new id and try again.",
          );
        }
        throw err;
      }
      invalidateArtifacts();
      if (rk !== RevealKind.NONE) {
        // Keep the secrets under the id the chain actually assigned.
        let id = rk === RevealKind.BLIND_METADATA ? predictedId : null;
        try {
          for (const r of await getTxMsgResponses(hash)) {
            if (r.typeUrl === "/sparkdream.artifact.v1.MsgCreateClassResponse") id = MsgCreateClassResponse.decode(r.value).classId.toString();
          }
        } catch {
          // Fall back to the prediction.
        }
        // expected_class_id guarantees the id matches the commitment.
        if (id && rk === RevealKind.BLIND_METADATA && tree) saveCommitTree(id, tree);
        if (id && rk === RevealKind.GENERATIVE_SEED) saveSeedSecret(id, seed.trim());
      }
      onCreated();
    }, (raw) => (raw.startsWith("Another class was created first") ? raw : txFailure("Couldn't create the class")(raw)));
  };

  const fee = params?.class_creation_fee;
  const maxStages = params?.max_schedule_stages ?? 0;

  return (
    <div className="sd-hull-tile space-y-5 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">New class</h2>
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">Cancel</button>
      </div>
      <p className="text-sm text-zinc-400">
        A class groups tokens issued under one set of rules. Its kind and the options below can&apos;t change later, so pick carefully.
      </p>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-zinc-200">Token model</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { id: TokenModel.UNIQUE, label: "Unique tokens", desc: "Every token is one of a kind, with its own id and holder." },
            {
              id: TokenModel.EDITIONS,
              label: "Editions",
              desc: "Each edition is a run of identical units held as balances, like prints or impact certificates.",
            },
          ].map((m) => (
            <label
              key={m.id}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${model === m.id ? "border-[var(--verdigris-ring)] bg-[var(--verdigris-soft)]" : "border-zinc-800 hover:border-zinc-700"}`}
            >
              <span className="flex items-center gap-2 font-medium text-zinc-100">
                <input type="radio" name="artifact-model" checked={model === m.id} onChange={() => pickModel(m.id)} />
                {m.label}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-400">{m.desc}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-zinc-200">Kind</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KINDS.filter((x) => !(editions && x.mutual)).map((x) => (
            <label
              key={x.id}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${kind === x.id ? "border-[var(--verdigris-ring)] bg-[var(--verdigris-soft)]" : "border-zinc-800 hover:border-zinc-700"}`}
            >
              <span className="flex items-center gap-2 font-medium text-zinc-100">
                <input type="radio" name="artifact-kind" checked={kind === x.id} onChange={() => pickKind(x.id)} />
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
        {!editions && (
          <div className="sm:col-span-2">
            <FieldLabel label="Token URI base" hint="Optional. A token without its own media uses this plus its id.">
              <input value={tokenUriBase} onChange={(e) => setTokenUriBase(e.target.value)} className={fieldCls} />
            </FieldLabel>
          </div>
        )}
        <FieldLabel
          label={editions ? "Max editions" : "Max supply"}
          hint={`0 for no cap. You can lower it or add a cap later, never raise it.${editions ? " Each edition sets its own unit cap." : ""}`}
        >
          <NumberInput value={maxSupply} min={0} onChange={(e) => setMaxSupply(e.target.value)} className={fieldCls} />
        </FieldLabel>
        <FieldLabel label="Payout address" hint="Receives public mint proceeds and renewals. Blank for you.">
          <input value={payout} onChange={(e) => setPayout(e.target.value)} className={`${fieldCls} font-mono text-xs`} />
        </FieldLabel>
      </section>

      {canTicket && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Tickets</h3>
          <label className="flex items-start gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={redeemable} onChange={(e) => { setRedeemable(e.target.checked); if (e.target.checked) setHarberger(false); }} className="mt-1" />
            <span>
              Tokens can be redeemed once, like a ticket
              <span className="block text-xs text-zinc-500">You or a minter mark them redeemed at the door. Redeeming never moves the token.</span>
            </span>
          </label>
          {redeemable && k.transferable && (
            <label className="flex items-start gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={redeemedTransferable} onChange={(e) => setRedeemedTransferable(e.target.checked)} className="mt-1" />
              <span>
                Redeemed tokens can still be traded
                <span className="block text-xs text-zinc-500">As souvenirs. Otherwise a spent ticket can&apos;t be sold or sent.</span>
              </span>
            </label>
          )}
        </section>
      )}

      {canExpire && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Expiry</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <FieldLabel label="When a token expires">
              <select
                value={expiryMode}
                onChange={(e) => { setExpiryMode(e.target.value); if (e.target.value !== ExpiryMode.NONE) setHarberger(false); }}
                className={fieldCls}
              >
                {Object.values(ExpiryMode)
                  .filter((m) => !(permanent && m === ExpiryMode.BURN))
                  .map((m) => (
                    <option key={m} value={m}>{EXPIRY_MODE_LABELS[m]}</option>
                  ))}
              </select>
            </FieldLabel>
            {expiryMode !== ExpiryMode.NONE && (
              <>
                <FieldLabel label="Lasts (days)" hint={`From mint, and again from each renewal. At least ${MIN_TERM_SECONDS / 3600} hour.`}>
                  <input value={termDays} onChange={(e) => setTermDays(e.target.value)} inputMode="decimal" className={fieldCls} />
                </FieldLabel>
                <FieldLabel label={`Renewal price (${config.displayDenom})`} hint="Paid by holders. You and minters renew free.">
                  <input value={renewalPrice} onChange={(e) => setRenewalPrice(e.target.value)} inputMode="decimal" className={fieldCls} />
                </FieldLabel>
              </>
            )}
          </div>
          {expiryMode === ExpiryMode.MARK && (
            <p className="text-xs text-zinc-500">An expired token stays with its holder, marked expired. It can&apos;t be sold or redeemed until renewed.</p>
          )}
          {expiryMode === ExpiryMode.BURN && (
            <p className="text-xs text-zinc-500">An expired token is burned automatically and its deposit goes back to the holder.</p>
          )}
        </section>
      )}

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

      {canPublicMint && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Public mint</h3>
          <MintPolicyFields value={policy} onChange={setPolicy} soulbound={soulbound} displayDenom={config.displayDenom} />
          {revealKind !== RevealKind.NONE && policy.enabled && !soulbound && (
            <p className="text-xs text-zinc-500">With commit-reveal, each mint price is held in escrow until the token (or the seed) is revealed.</p>
          )}
        </section>
      )}

      {kind === "collectible" && !editions && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Harberger tax</h3>
          <label className="flex items-start gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={harberger} disabled={!canHarberger && !harberger} onChange={(e) => setHarberger(e.target.checked)} className="mt-1" />
            <span>
              Holders set their own price and pay a yearly tax on it
              <span className="block text-xs text-zinc-500">
                Anyone can buy a token at its holder&apos;s price at any time. The tax goes to the community pool. Not available with
                tickets, expiry or commit-reveal, and tokens can&apos;t be listed, rented or nested.
              </span>
            </span>
          </label>
          {harberger && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FieldLabel label="Tax per year (%)">
                <input value={taxPct} onChange={(e) => setTaxPct(e.target.value)} inputMode="decimal" className={fieldCls} />
              </FieldLabel>
              <FieldLabel
                label="Tax period (days)"
                hint={`How often tax is collected. ${MIN_HARBERGER_PERIOD / 86400} to ${MAX_HARBERGER_PERIOD / 86400} days on mainnet.`}
              >
                <input value={taxPeriodDays} onChange={(e) => setTaxPeriodDays(e.target.value)} inputMode="decimal" className={fieldCls} />
              </FieldLabel>
              <FieldLabel label="Foreclosure (days)" hint="After a missed payment, the price falls to zero over this long.">
                <input value={foreclosureDays} onChange={(e) => setForeclosureDays(e.target.value)} inputMode="decimal" className={fieldCls} />
              </FieldLabel>
            </div>
          )}
        </section>
      )}

      {(canReveal || revealKind !== RevealKind.NONE) && !editions && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Commit-reveal</h3>
          <div className="flex flex-wrap gap-3 text-sm text-zinc-300">
            {[
              { id: RevealKind.NONE, label: "None" },
              { id: RevealKind.BLIND_METADATA, label: "Blind mint" },
              { id: RevealKind.GENERATIVE_SEED, label: "Generative seed" },
            ].map((r) => (
              <label key={r.id} className="flex items-center gap-2">
                <input type="radio" name="artifact-reveal" checked={revealKind === r.id} onChange={() => setRevealKind(r.id)} disabled={!canReveal && r.id !== RevealKind.NONE} />
                {r.label}
              </label>
            ))}
          </div>
          {revealKind === RevealKind.BLIND_METADATA && (
            <p className="text-xs text-zinc-500">
              Every token&apos;s metadata is committed now and revealed later, token by token. Tokens mint with no metadata until then.
            </p>
          )}
          {revealKind === RevealKind.GENERATIVE_SEED && (
            <p className="text-xs text-zinc-500">
              You commit to a secret seed now. Each token&apos;s own seed is derived from it once you reveal it, so nobody can pick rarities in
              advance.
            </p>
          )}
          {revealKind !== RevealKind.NONE && (
            <FieldLabel
              label="Reveal deadline"
              hint={`At least ${MIN_REVEAL_WINDOW / 3600} hours from now. After it, holders of unrevealed tokens can burn them for a full refund.`}
            >
              <input type="datetime-local" value={revealDeadline} onChange={(e) => setRevealDeadline(e.target.value)} className={fieldCls} />
            </FieldLabel>
          )}
          {revealKind === RevealKind.BLIND_METADATA && (
            <div className="space-y-2">
              <Note>
                {predictedId ? (
                  <>This class will get id <span className="font-mono text-zinc-200">#{predictedId}</span>, which the commitment includes. If someone else creates a class first, creating fails without cost and you rebuild for the new id.</>
                ) : (
                  "Working out the next class id…"
                )}
              </Note>
              <FieldLabel
                label="Tokens to commit"
                hint={
                  <>
                    A JSON list in the artifactcommit format: <span className="font-mono">{`[{"token_id": 1, "metadata": {"name": "…", "uri": "…"}}]`}</span>.
                    Salts are filled in for you. Or upload a tree built with <span className="font-mono">artifactcommit tree</span>.
                  </>
                }
              >
                <textarea
                  value={entriesText}
                  onChange={(e) => { setEntriesText(e.target.value); setTree(null); }}
                  rows={5}
                  className={`${fieldCls} font-mono text-xs`}
                  placeholder='[{"token_id": 1, "metadata": {"name": "Dragon #1"}}]'
                />
              </FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={buildTree} disabled={!entriesText.trim() || !predictedId} className="sd-btn sd-btn-secondary">
                  Build commitment
                </button>
                <label className="sd-btn sd-btn-secondary cursor-pointer">
                  Upload JSON
                  <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => loadTreeFile(e.target.files?.[0])} />
                </label>
              </div>
              {tree && (
                <div className="space-y-2 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-400">
                  <p>
                    {tree.leaves.length} token{tree.leaves.length === 1 ? "" : "s"} committed for class #{tree.class_id || "?"}. Root{" "}
                    <span className="break-all font-mono text-zinc-300">{tree.root}</span>
                  </p>
                  <Note tone="warn">
                    The salts in this file are the only way to reveal these tokens. Lose them and nobody can ever reveal, so download it and keep
                    a copy somewhere safe. It&apos;s also kept in this browser.
                  </Note>
                  <button
                    type="button"
                    onClick={() => downloadJson(`artifact-reveal-class-${tree.class_id || "new"}.json`, tree)}
                    className="sd-btn sd-btn-secondary"
                  >
                    Download reveal file
                  </button>
                  <label className="flex items-center gap-2 text-zinc-300">
                    <input type="checkbox" checked={treeSaved} onChange={(e) => setTreeSaved(e.target.checked)} />
                    I saved the reveal file
                  </label>
                </div>
              )}
            </div>
          )}
          {revealKind === RevealKind.GENERATIVE_SEED && (
            <div className="space-y-2">
              <FieldLabel label="Secret seed (hex)" hint="1 to 64 bytes. Keep it secret until you reveal it.">
                <div className="flex gap-2">
                  <input value={seed} onChange={(e) => { setSeed(e.target.value.toLowerCase()); setSeedSaved(false); }} className={`${fieldCls} font-mono text-xs`} />
                  <button type="button" onClick={() => { setSeed(randomSaltHex()); setSeedSaved(false); }} className="sd-btn sd-btn-secondary shrink-0">
                    Generate
                  </button>
                </div>
              </FieldLabel>
              {seed && (
                <>
                  <Note tone="warn">
                    Without this seed the class can never be revealed. It&apos;s kept in this browser, but download a copy.
                  </Note>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => downloadJson("artifact-seed.json", { seed })} className="sd-btn sd-btn-secondary">
                      Download seed
                    </button>
                    <label className="flex items-center gap-2 text-xs text-zinc-300">
                      <input type="checkbox" checked={seedSaved} onChange={(e) => setSeedSaved(e.target.checked)} />
                      I saved the seed
                    </label>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {canRenderer && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-zinc-200">Renderer</h3>
          <p className="text-xs text-zinc-500">
            Optional. A deployed Gno package (gno.land/p/…) that draws each token&apos;s metadata when it&apos;s viewed. It can never be
            changed, so holders always see what the code they read produces.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <FieldLabel label="Package path">
                <input value={pkgPath} onChange={(e) => setPkgPath(e.target.value)} placeholder="gno.land/p/…" className={`${fieldCls} font-mono text-xs`} />
              </FieldLabel>
            </div>
            <FieldLabel label="Token state">
              <select value={stateVersion} onChange={(e) => setStateVersion(e.target.value)} className={fieldCls} disabled={!pkgPath.trim()}>
                <option value="0">None (Render)</option>
                <option value="1">Version 1 (RenderState)</option>
                <option value="2">Version 2 (adds season and contents)</option>
              </select>
            </FieldLabel>
            <div className="sm:col-span-3">
              <FieldLabel label="Source hash" hint="From artifactcommit source-hash on the package directory.">
                <input value={sourceHash} onChange={(e) => setSourceHash(e.target.value)} className={`${fieldCls} font-mono text-xs`} disabled={!pkgPath.trim()} />
              </FieldLabel>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-zinc-200">Minters</h3>
        <p className="text-xs text-zinc-500">
          Other addresses that may mint, one per line. Optional. Each pays its own token deposits.
          {redeemable ? " Minters can also redeem tickets." : ""}
        </p>
        <textarea value={minters} onChange={(e) => setMinters(e.target.value)} rows={2} className={`${fieldCls} font-mono text-xs`} />
      </section>

      <section className="space-y-2 border-t border-zinc-800 pt-4">
        {fee && fee !== "0" && (
          <p className="text-xs text-zinc-400">
            Creating a class burns {formatSpark(fee)} {config.displayDenom}. It isn&apos;t refunded.
          </p>
        )}
        {maxStages > 0 && !editions && revealKind !== RevealKind.BLIND_METADATA && (
          <p className="text-xs text-zinc-500">Tokens can carry a metadata schedule of up to {maxStages} stages, set when you mint them.</p>
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
          className="sd-btn sd-btn-verdigris w-full justify-center"
        >
          {pending === "create" ? "Creating…" : "Create class"}
        </button>
      </section>
    </div>
  );
}
