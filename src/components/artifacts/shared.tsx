"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { getArtifactParams, invalidateArtifacts } from "@/lib/artifactApi";
import { formatDurationApprox, formatSpark, parseSparkToUspark } from "@/lib/utils";
import { describeTxError } from "@/lib/errors";
import {
  BurnAuthorization,
  ContentStatus,
  TokenLock,
  type ArtifactClass,
  type ArtifactParams,
  type Attribute,
  type Coin,
  ExpiryMode,
  TokenModel,
  type Token,
  type TokenMetadata,
  type TokenView,
} from "@/types/artifact";
import type { TokenMetadata as MsgTokenMetadata } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/types";

// ---- Labels ---------------------------------------------------------------

export function classTitle(c: Pick<ArtifactClass, "id" | "name"> | null | undefined, withheld = false): string {
  if (!c) return "Class";
  if (withheld) return `Class #${c.id}`;
  return c.name?.trim() || `Class #${c.id}`;
}

export function tokenTitle(t: Pick<Token, "id" | "metadata"> | null | undefined, withheld = false): string {
  if (!t) return "Token";
  if (withheld) return `Token #${t.id}`;
  return t.metadata?.name?.trim() || `Token #${t.id}`;
}

/**
 * The token as it should be shown: its metadata replaced by what the chain
 * says to display (a schedule stage, an accepted media version or renderer
 * output). Edit forms keep using view.token, the stored metadata.
 */
export function shownToken(view: TokenView): Token {
  return view.displayed_metadata ? { ...view.token, metadata: view.displayed_metadata } : view.token;
}

/** Canonical "<class_id>/<token_id>" reference. */
export function tokenRef(classId: string, tokenId: string): string {
  return `${classId}/${tokenId}`;
}

export function formatCoin(coin: Coin | undefined | null, displayDenom: string): string {
  if (!coin || !coin.amount || coin.amount === "0") return `0 ${displayDenom}`;
  return `${formatSpark(coin.amount)} ${displayDenom}`;
}

export function bpsToPercent(bps: number | undefined): string {
  const n = bps ?? 0;
  const pct = n / 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2).replace(/0+$/, "")}%`;
}

/** Map a chain tx failure to readable copy (for useTxAction's describe). */
export function txFailure(prefix: string) {
  return (raw: string) => {
    const nice = describeTxError(raw);
    return nice ? `${prefix}: ${nice}` : `${prefix}.`;
  };
}

// ---- Class / token predicates ---------------------------------------------

export function burnAuth(c: ArtifactClass | null | undefined): string {
  return c?.flags?.burn_authorization || BurnAuthorization.HOLDER;
}

export function isTransferable(c: ArtifactClass | null | undefined): boolean {
  return !!c?.flags?.transferable;
}

export function issuerCanRevoke(c: ArtifactClass | null | undefined): boolean {
  const b = burnAuth(c);
  return b === BurnAuthorization.ISSUER || b === BurnAuthorization.HOLDER_OR_ISSUER;
}

export function holderCanBurn(c: ArtifactClass | null | undefined): boolean {
  const b = burnAuth(c);
  return b === BurnAuthorization.HOLDER || b === BurnAuthorization.HOLDER_OR_ISSUER;
}

export function isHidden(status: string | undefined): boolean {
  return status === ContentStatus.HIDDEN;
}

export function lockOf(t: Token | null | undefined): string {
  return t?.lock || TokenLock.NONE;
}

/** Tokens ever issued (live + burned + pending), which the cap counts. */
export function issuedCount(c: ArtifactClass): bigint {
  const n = (s?: string) => {
    try {
      return BigInt(s || "0");
    } catch {
      return BigInt(0);
    }
  };
  return n(c.supply) + n(c.burned) + n(c.reserved_supply);
}

// ---- Addresses ------------------------------------------------------------

/** Loose bech32 check: right prefix, a "1" separator, lowercase data part. */
export function looksLikeAddress(s: string, prefix: string): boolean {
  const v = s.trim();
  return v.startsWith(`${prefix}1`) && /^[a-z0-9]+1[02-9ac-hj-np-z]{20,}$/.test(v);
}

/** Split a textarea of addresses on whitespace and commas, deduplicated. */
export function parseAddressList(s: string): string[] {
  return Array.from(new Set(s.split(/[\s,]+/).map((a) => a.trim()).filter(Boolean)));
}

// ---- Time -----------------------------------------------------------------

/** "datetime-local" input value to unix seconds ("0" when empty). */
export function localInputToUnix(v: string): bigint {
  if (!v) return BigInt(0);
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? BigInt(Math.floor(ms / 1000)) : BigInt(0);
}

/** Unix seconds to a "datetime-local" input value ("" for 0). */
export function unixToLocalInput(s: string | undefined): string {
  const n = Number(s || "0");
  if (!n) return "";
  const d = new Date(n * 1000);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- Metadata form --------------------------------------------------------

export interface MetadataForm {
  name: string;
  description: string;
  uri: string;
  uriHash: string;
  attributes: { key: string; value: string }[];
}

export function emptyMetadataForm(): MetadataForm {
  return { name: "", description: "", uri: "", uriHash: "", attributes: [] };
}

export function metadataFormFrom(m: TokenMetadata | undefined): MetadataForm {
  return {
    name: m?.name || "",
    description: m?.description || "",
    uri: m?.uri || "",
    uriHash: m?.uri_hash || "",
    attributes: (m?.attributes || []).map((a) => ({ key: a.key, value: a.value })),
  };
}

/** Build the camelCase TokenMetadata the signer expects. Blank attribute rows are dropped. */
export function metadataFormToMsg(f: MetadataForm): MsgTokenMetadata {
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    uri: f.uri.trim(),
    uriHash: f.uriHash.trim().toLowerCase(),
    attributes: f.attributes
      .filter((a) => a.key.trim() !== "")
      .map((a) => ({ key: a.key.trim(), value: a.value.trim() })),
  };
}

/** Client-side checks mirroring the chain's metadata rules. Returns an error or null. */
export function validateMetadataForm(f: MetadataForm): string | null {
  if (f.uri.trim() && /^data:/i.test(f.uri.trim())) return "Data URIs aren't allowed. Link to the file instead.";
  if (f.uriHash.trim() && !/^[0-9a-f]{64}$/i.test(f.uriHash.trim())) {
    return "The URI hash must be a 64 character hex SHA-256.";
  }
  const keys = new Set<string>();
  for (const a of f.attributes) {
    const k = a.key.trim();
    if (!k) continue;
    if (!/^[a-z0-9_]+$/.test(k)) return `Attribute key "${k}" may only use a-z, 0-9 and _.`;
    if (keys.has(k)) return `Attribute key "${k}" is used twice.`;
    keys.add(k);
  }
  return null;
}

export const fieldCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none disabled:opacity-50";

export function MetadataEditor({
  value,
  onChange,
  disabled,
}: {
  value: MetadataForm;
  onChange: (next: MetadataForm) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<MetadataForm>) => onChange({ ...value, ...patch });
  const setAttr = (i: number, patch: Partial<{ key: string; value: string }>) =>
    set({ attributes: value.attributes.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return (
    <div className="space-y-2">
      <input
        value={value.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="Name (optional)"
        className={fieldCls}
        disabled={disabled}
      />
      <textarea
        value={value.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="Description (optional)"
        rows={2}
        className={fieldCls}
        disabled={disabled}
      />
      <input
        value={value.uri}
        onChange={(e) => set({ uri: e.target.value })}
        placeholder="Media URI, e.g. ipfs://… or https://… (optional)"
        className={fieldCls}
        disabled={disabled}
      />
      <input
        value={value.uriHash}
        onChange={(e) => set({ uriHash: e.target.value })}
        placeholder="SHA-256 of the media, hex (optional)"
        className={`${fieldCls} font-mono text-xs`}
        disabled={disabled}
      />
      <div className="space-y-1.5">
        {value.attributes.map((a, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={a.key}
              onChange={(e) => setAttr(i, { key: e.target.value.toLowerCase() })}
              placeholder="key"
              className={`${fieldCls} w-1/3 font-mono text-xs`}
              disabled={disabled}
            />
            <input
              value={a.value}
              onChange={(e) => setAttr(i, { value: e.target.value })}
              placeholder="value"
              className={fieldCls}
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => set({ attributes: value.attributes.filter((_, j) => j !== i) })}
              className="shrink-0 px-2 text-xs text-zinc-500 hover:text-red-400"
              disabled={disabled}
              aria-label="Remove attribute"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => set({ attributes: [...value.attributes, { key: "", value: "" }] })}
          className="text-xs text-zinc-400 hover:text-zinc-200"
          disabled={disabled}
        >
          + Add attribute
        </button>
      </div>
    </div>
  );
}

// ---- Media ----------------------------------------------------------------

function hostOf(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** The token's media URI, falling back to the class's token_uri_base + id. */
export function tokenMediaUri(token: Token | null | undefined, cls: ArtifactClass | null | undefined): string {
  const own = token?.metadata?.uri?.trim();
  if (own) return own;
  const base = cls?.token_uri_base?.trim();
  if (base && token) return `${base}${token.id}`;
  return "";
}

/**
 * Media referenced by a class or token. Nothing loads on its own: the URI has
 * not been checked, and fetching it would share the viewer's IP with its host.
 * An https image loads only after the viewer asks; other schemes (ipfs, ar)
 * are shown as text, since this site runs no gateway for them.
 */
export function ArtifactMedia({
  uri,
  size = "lg",
}: {
  uri: string;
  size?: "sm" | "lg";
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const host = uri ? hostOf(uri) : null;
  const box = size === "sm" ? "h-12 w-12" : "aspect-square w-full max-w-xs";

  const placeholder = (
    <svg
      className={`m-auto text-zinc-600 ${size === "sm" ? "h-5 w-5" : "h-10 w-10"}`}
      aria-label="Image not loaded"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 16l-5-5-8 8" />
    </svg>
  );

  if (size === "sm") {
    return (
      <div className={`relative ${box} flex shrink-0 overflow-hidden rounded-lg bg-zinc-800`}>
        {placeholder}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className={`relative ${box} flex overflow-hidden rounded-xl bg-zinc-900/70`}>
        {loaded && host && !failed ? (
          /* `unoptimized` skips Next's optimizer, which would need every host allow-listed. */
          <Image
            src={uri}
            alt=""
            fill
            sizes="320px"
            unoptimized
            className="object-contain"
            onError={() => setFailed(true)}
          />
        ) : (
          placeholder
        )}
      </div>
      {uri && !loaded && host && (
        <div className="flex max-w-xs flex-wrap items-center gap-2 rounded-lg bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
          <span className="min-w-0 flex-1">
            Image not loaded. It&apos;s hosted on {host}, and loading it shares your IP address with that site.
          </span>
          <button type="button" onClick={() => setLoaded(true)} className="sd-btn sd-btn-secondary shrink-0">
            Load image
          </button>
        </div>
      )}
      {loaded && failed && (
        <p className="max-w-xs text-xs text-zinc-500">This link didn&apos;t load as an image.</p>
      )}
      {uri && !host && (
        <p className="max-w-xs break-all text-xs text-zinc-500">
          Media at <span className="font-mono text-zinc-400">{uri}</span>. This site doesn&apos;t fetch it.
        </p>
      )}
      {!uri && <p className="text-xs text-zinc-600">No media.</p>}
    </div>
  );
}

// ---- Attributes -----------------------------------------------------------

export function AttributeList({ attributes }: { attributes: Attribute[] | undefined }) {
  if (!attributes?.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {attributes.map((a) => (
        <div key={a.key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
          <dt className="truncate font-mono text-[11px] text-zinc-500">{a.key}</dt>
          <dd className="break-words text-sm text-zinc-200">{a.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- Badges ---------------------------------------------------------------

function Badge({ children, tone, title }: { children: React.ReactNode; tone: string; title?: string }) {
  return (
    <span title={title} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

/** What the issuer can still do to holders, from the class's fixed flags and one-way switches. */
export function ClassBadges({ cls, withheld }: { cls: ArtifactClass; withheld?: boolean }) {
  const b = burnAuth(cls);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {(withheld || isHidden(cls.status)) && <Badge tone="bg-red-500/15 text-red-400">Hidden</Badge>}
      {isTransferable(cls) ? (
        <Badge tone="bg-sky-500/15 text-sky-300" title="Tokens can be transferred and sold">Transferable</Badge>
      ) : (
        <Badge tone="bg-violet-500/15 text-violet-300" title="Tokens can't be transferred or sold">Soulbound</Badge>
      )}
      {issuerCanRevoke(cls) && (
        <Badge tone="bg-amber-500/15 text-amber-300" title="The class owner can burn holders' tokens">Revocable</Badge>
      )}
      {(b === BurnAuthorization.ISSUER || b === BurnAuthorization.NEITHER) && (
        <Badge tone="bg-amber-500/15 text-amber-300" title="Holders can't burn these tokens">Cannot be discarded</Badge>
      )}
      {cls.flags?.mutual && (
        <Badge tone="bg-sky-500/15 text-sky-300" title="Recipients accept each mint and transfer from their inbox">Accept to receive</Badge>
      )}
      {cls.flags?.redeemable && (
        <Badge tone="bg-sky-500/15 text-sky-300" title="Tokens can be redeemed once, like a ticket">Redeemable</Badge>
      )}
      {cls.expiry?.mode && cls.expiry.mode !== ExpiryMode.NONE && (
        <Badge tone="bg-zinc-700/50 text-zinc-300" title="Tokens expire unless renewed">Expires</Badge>
      )}
      {cls.royalty_locked && (
        <Badge tone="bg-emerald-500/15 text-emerald-300" title="The royalty and its split can no longer change">Royalty locked</Badge>
      )}
      {cls.flags?.token_metadata_mutable && !cls.metadata_frozen && (
        <Badge tone="bg-zinc-700/50 text-zinc-300" title="The class owner can still edit token metadata">Editable</Badge>
      )}
      {cls.metadata_frozen && (
        <Badge tone="bg-emerald-500/15 text-emerald-300" title="Class and token metadata can no longer change">Frozen</Badge>
      )}
      {cls.minting_closed && (
        <Badge tone="bg-emerald-500/15 text-emerald-300" title="No more tokens can be minted">Closed supply</Badge>
      )}
    </span>
  );
}

export function LockBadge({ lock }: { lock: string }) {
  if (lock === TokenLock.LISTED) return <Badge tone="bg-amber-500/15 text-amber-300">Listed</Badge>;
  if (lock === TokenLock.PENDING_TRANSFER) return <Badge tone="bg-sky-500/15 text-sky-300">Transfer pending</Badge>;
  if (lock === TokenLock.RENTED) return <Badge tone="bg-sky-500/15 text-sky-300">Rented</Badge>;
  if (lock === TokenLock.NESTED) return <Badge tone="bg-zinc-700/50 text-zinc-300">Nested</Badge>;
  if (lock === TokenLock.AUCTION) return <Badge tone="bg-amber-500/15 text-amber-300">In auction</Badge>;
  return null;
}

/** Expired, redeemed and unrevealed states from a token view. */
export function TokenStateBadges({ view }: { view: TokenView }) {
  const t = view.token;
  return (
    <>
      {view.expired && <Badge tone="bg-red-500/15 text-red-400" title="Past its expiry; the holder can renew it">Expired</Badge>}
      {t.redeemed_at && t.redeemed_at !== "0" && <Badge tone="bg-zinc-700/50 text-zinc-300">Redeemed</Badge>}
      {t.unrevealed && <Badge tone="bg-violet-500/15 text-violet-300" title="Its metadata is revealed later">Unrevealed</Badge>}
    </>
  );
}

export function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="mb-4 flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
      </svg>
      {label}
    </button>
  );
}

/** Collapsible owner/holder action section. */
export function ActionSection({
  title,
  open,
  onToggle,
  children,
  tone = "default",
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <div className={`rounded-lg border ${tone === "danger" ? "border-red-900/50" : "border-zinc-800"} bg-zinc-900/30`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${tone === "danger" ? "text-red-300" : "text-zinc-200"}`}
      >
        {title}
        <svg className={`h-4 w-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="space-y-2 border-t border-zinc-800 px-3 py-3">{children}</div>}
    </div>
  );
}

// ---- Royalty split --------------------------------------------------------

export interface RoyaltyRow {
  address: string;
  /** Percent of the royalty, as typed. */
  percent: string;
}

/** Rows to RoyaltyShare[] (weight in basis points of the royalty). Null + message on a bad split. */
export function royaltyRowsToShares(
  rows: RoyaltyRow[],
  prefix: string
): { shares: { address: string; weightBps: number }[]; error: string | null } {
  const filled = rows.filter((r) => r.address.trim() || r.percent.trim());
  if (filled.length === 0) return { shares: [], error: null };
  if (filled.length > 10) return { shares: [], error: "A royalty can be split across at most 10 addresses." };
  const seen = new Set<string>();
  const shares: { address: string; weightBps: number }[] = [];
  let total = 0;
  for (const r of filled) {
    const addr = r.address.trim();
    if (!looksLikeAddress(addr, prefix)) return { shares: [], error: `"${addr || "(blank)"}" isn't a valid address.` };
    if (seen.has(addr)) return { shares: [], error: "Each royalty address can appear only once." };
    seen.add(addr);
    const pct = Number(r.percent);
    if (!Number.isFinite(pct) || pct <= 0) return { shares: [], error: "Each royalty share needs a percent above 0." };
    const bps = Math.round(pct * 100);
    total += bps;
    shares.push({ address: addr, weightBps: bps });
  }
  if (total !== 10000) return { shares: [], error: "Royalty shares must add up to 100%." };
  return { shares, error: null };
}

export function RoyaltySplitEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: RoyaltyRow[];
  onChange: (rows: RoyaltyRow[]) => void;
  disabled?: boolean;
}) {
  const setRow = (i: number, patch: Partial<RoyaltyRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={r.address}
            onChange={(e) => setRow(i, { address: e.target.value })}
            placeholder="Address"
            className={`${fieldCls} font-mono text-xs`}
            disabled={disabled}
          />
          <input
            value={r.percent}
            onChange={(e) => setRow(i, { percent: e.target.value })}
            placeholder="%"
            inputMode="decimal"
            className={`${fieldCls} w-20`}
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="shrink-0 px-2 text-xs text-zinc-500 hover:text-red-400"
            disabled={disabled}
            aria-label="Remove share"
          >
            ✕
          </button>
        </div>
      ))}
      {rows.length < 10 && (
        <button
          type="button"
          onClick={() => onChange([...rows, { address: "", percent: "" }])}
          className="text-xs text-zinc-400 hover:text-zinc-200"
          disabled={disabled}
        >
          + Add royalty share
        </button>
      )}
    </div>
  );
}

export function FieldLabel({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

// ---- Wave 1-4 helpers --------------------------------------------------------

export function isEditionsClass(c: ArtifactClass | null | undefined): boolean {
  return c?.token_model === TokenModel.EDITIONS;
}

export function isHarbergerClass(c: ArtifactClass | null | undefined): boolean {
  return (c?.harberger?.tax_bps_per_year ?? 0) > 0;
}

/** Offers, auctions and rentals need a transferable UNIQUE class that is not Harberger. */
export function isMarketable(c: ArtifactClass | null | undefined): boolean {
  return !!c && isTransferable(c) && !isEditionsClass(c) && !isHarbergerClass(c);
}

/** A uint64 decimal string, or null. */
export function parseUint(s: string): bigint | null {
  const v = s.trim();
  return /^\d+$/.test(v) ? BigInt(v) : null;
}

/** Split a list of ids on whitespace and commas, deduplicated; null when any isn't a whole number. */
export function parseIdList(s: string): string[] | null {
  const ids = Array.from(new Set(s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)));
  return ids.every((i) => /^\d+$/.test(i)) ? ids : null;
}

/** Days as typed (decimals allowed) to whole seconds, or null. */
export function daysToSeconds(s: string): number | null {
  const n = Number(s.trim());
  if (!s.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 86400);
}

/** Seconds (string or number) as "3d 4h". */
export function formatSeconds(s: string | number | undefined): string {
  return formatDurationApprox(Number(s || 0));
}

/** A positive display amount to micro units, or null. */
export function parsePositiveAmount(s: string): string | null {
  const a = parseSparkToUspark(s.trim());
  return a && BigInt(a) > BigInt(0) ? a : null;
}

/** Unix seconds now. */
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** The artifact params, loaded once per mount (cached by the API layer). */
export function useArtifactParams(): ArtifactParams | null {
  const [params, setParams] = useState<ArtifactParams | null>(null);
  useEffect(() => {
    let live = true;
    getArtifactParams()
      .then((r) => live && setParams(r.params))
      .catch(() => live && setParams(null));
    return () => {
      live = false;
    };
  }, []);
  return params;
}

/**
 * useTxAction plus the artifact broadcast routine: sign, drop the artifact
 * cache, then run the caller's follow-up. `send` resolves to the tx hash, or
 * null when the tx failed (the banner shows why).
 */
export function useArtifactTx(onChanged?: () => void) {
  const { signAndBroadcast } = useWallet();
  const tx = useTxAction();
  const { run } = tx;
  const send = useCallback(
    async (
      key: string,
      msgs: { typeUrl: string; value: unknown } | { typeUrl: string; value: unknown }[],
      fail: string,
      after?: (hash: string) => void | Promise<void>
    ): Promise<string | null> => {
      let hash: string | null = null;
      const ok = await run(key, async () => {
        hash = await signAndBroadcast(Array.isArray(msgs) ? msgs : [msgs]);
        invalidateArtifacts();
        await after?.(hash);
        onChanged?.();
      }, txFailure(fail));
      return ok ? hash : null;
    },
    [run, signAndBroadcast, onChanged]
  );
  return { ...tx, send };
}

/** A token or edition reference as a clickable verdigris link. */
export function RefLink({ label, onClick, mono = true }: { label: string; onClick?: () => void; mono?: boolean }) {
  if (!onClick) return <span className={mono ? "font-mono" : ""}>{label}</span>;
  return (
    <button type="button" onClick={onClick} className={`sd-artifact-link ${mono ? "font-mono" : ""}`}>
      {label}
    </button>
  );
}

/** Small boxed note under a panel heading. */
export function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warn" | "info" }) {
  const cls =
    tone === "warn"
      ? "border-amber-800/50 bg-amber-900/15 text-amber-200"
      : tone === "info"
        ? "border-sky-800/50 bg-sky-900/15 text-sky-200"
        : "border-zinc-800 bg-zinc-900/40 text-zinc-400";
  return <div className={`rounded-lg border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

// ---- Metadata schedule ---------------------------------------------------------

export interface StageForm {
  /** datetime-local value. */
  from: string;
  metadata: MetadataForm;
}

/** Stages to the camelCase MetadataStage list, or an error. Stages must be in the future and strictly increasing. */
export function stagesToMsg(stages: StageForm[]): { stages: { fromTime: bigint; metadata: MsgTokenMetadata }[]; error: string | null } {
  const out: { fromTime: bigint; metadata: MsgTokenMetadata }[] = [];
  let last = BigInt(nowUnix());
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const at = localInputToUnix(s.from);
    if (at === BigInt(0)) return { stages: [], error: `Stage ${i + 1} needs a start time.` };
    if (at <= last) return { stages: [], error: `Stage ${i + 1} must start in the future and after the stage before it.` };
    const bad = validateMetadataForm(s.metadata);
    if (bad) return { stages: [], error: `Stage ${i + 1}: ${bad}` };
    last = at;
    out.push({ fromTime: at, metadata: metadataFormToMsg(s.metadata) });
  }
  return { stages: out, error: null };
}

/** Editor for a token's metadata schedule: later stages replace what's shown, from their start time. */
export function ScheduleEditor({
  stages,
  onChange,
  max,
}: {
  stages: StageForm[];
  onChange: (s: StageForm[]) => void;
  max: number;
}) {
  if (max <= 0) return null;
  return (
    <div className="space-y-2">
      {stages.map((s, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-zinc-800/80 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-400">Stage {i + 1} shows from</span>
            <button
              type="button"
              onClick={() => onChange(stages.filter((_, j) => j !== i))}
              className="text-xs text-zinc-500 hover:text-red-400"
            >
              Remove
            </button>
          </div>
          <input
            type="datetime-local"
            value={s.from}
            onChange={(e) => onChange(stages.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
            className={fieldCls}
          />
          <MetadataEditor
            value={s.metadata}
            onChange={(m) => onChange(stages.map((x, j) => (j === i ? { ...x, metadata: m } : x)))}
          />
        </div>
      ))}
      {stages.length < max && (
        <button
          type="button"
          onClick={() => onChange([...stages, { from: "", metadata: emptyMetadataForm() }])}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          + Add a later stage
        </button>
      )}
    </div>
  );
}

/** A non-negative display amount to micro units (blank = 0), or null. */
export function parseSparkToUsparkOrZero(s: string): string | null {
  return parseSparkToUspark(s.trim() || "0");
}
