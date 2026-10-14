"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getServiceOperator, getServiceType, listGroups } from "@/lib/api";
import { errorKind } from "@/lib/errors";
import { ServiceMsgTypeUrls } from "@/lib/tx";
import { formatSpark } from "@/lib/utils";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { base64ToBytes } from "@/lib/contentScan/protocol";
import { parseOperatorMetadata, type OperatorMetadata } from "@/lib/contentScan/workers";
import NumberInput from "@/components/NumberInput";
import CopyableAddress from "@/components/CopyableAddress";
import {
  CONTENT_SCANNER_SERVICE_TYPE,
  OPERATOR_STATUS_LABELS,
  type Operator,
  type ServiceTypeConfig,
} from "@/types/service";
import type { Group } from "@/types/commons";

// The council that hires scanners unless the form says otherwise (the
// launcher's default too): x/service needs a commons group policy address
// as every operator's controller.
const DEFAULT_CONTROLLER = "Commons Operations Committee";

function toMicro(amount: string): string {
  return BigInt(Math.floor(parseFloat(amount) * 1_000_000)).toString();
}

/** Feed URLs are bases: manifest.json lives directly under them. */
function feedBase(url: string): string {
  const u = url.trim();
  return u.endsWith("/") ? u : `${u}/`;
}

/** What `contentscan metadata` prints (contentscan.OperatorMetadata). */
function buildMetadata(verdictKey: string, feedUrl: string, ruleset: string): OperatorMetadata {
  return { v: 1, verdict_key: verdictKey.trim(), feed_url: feedBase(feedUrl), ruleset_version: ruleset.trim() };
}

function metadataBytes(m: OperatorMetadata): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(m));
}

/** Problems with the form's metadata, or none. */
function metadataProblems(verdictKey: string, feedUrl: string): string[] {
  const out: string[] = [];
  const key = base64ToBytes(verdictKey.trim());
  if (!key || key.length !== 32) out.push("The verdict key must be a base64 ed25519 public key (what `contentscan keygen` prints).");
  if (!/^https?:\/\/[^\s/]+/i.test(feedUrl.trim())) out.push("The feed URL must be an http(s) URL.");
  return out;
}

interface FeedCheck {
  ok: boolean;
  lines: string[];
}

/**
 * Read the feed's manifest from the browser, to catch a wrong URL, a feed
 * signed by another key, or a worker running as another account before any
 * of it is published on chain. Feeds do not have to send CORS headers
 * (frontends read them server-side), so a browser failure is only a hint.
 */
async function checkFeed(feedUrl: string, verdictKey: string, operator: string): Promise<FeedCheck> {
  const url = `${feedBase(feedUrl)}manifest.json`;
  let m: Record<string, unknown>;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, lines: [`${url} answered ${res.status}.`] };
    m = (await res.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      lines: [
        `Could not read ${url} from this browser. Check that the worker is up and the URL is right. ` +
          "A feed host without CORS headers fails here but still works for frontends, which read feeds server-side.",
      ],
    };
  }
  const lines: string[] = [];
  let ok = true;
  if (m.verdict_key !== verdictKey.trim()) {
    ok = false;
    lines.push("The feed is signed with a different verdict key than the one entered.");
  }
  if (operator && m.worker !== operator) {
    ok = false;
    lines.push(`The worker runs as ${String(m.worker || "?")}, not this account: set its CS_GRANTER to ${operator}.`);
  }
  lines.push(`Scanned to height ${Number(m.scanned_height || 0).toLocaleString()}, ${Number(m.count || 0).toLocaleString()} verdicts.`);
  return { ok, lines };
}

/**
 * Register the connected account as a content-scanner operator, or manage
 * the registration it has: frontends trust a scanner's verdicts only while
 * it is an ACTIVE x/service operator whose metadata names its verdict key
 * and feed (docs/content-scanning.md §8.1). MsgRegisterOperator must be
 * signed by the operator itself, never through a session key, so this is
 * the account whose session key the worker later checkpoints with.
 */
export default function ScannerOperatorPanel({ onChanged }: { onChanged?: () => void }) {
  const { address, connected, signAndBroadcast } = useWallet();
  const { config: chain } = useChainConfig();
  const spark = chain.displayDenom;

  const [typeConfig, setTypeConfig] = useState<ServiceTypeConfig | null>(null);
  // undefined: loading; null: not registered under content-scanner
  const [operator, setOperator] = useState<Operator | null | undefined>(undefined);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [verdictKey, setVerdictKey] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [ruleset, setRuleset] = useState("v1");
  const [controller, setController] = useState("");
  const [bond, setBond] = useState("");
  const [topUp, setTopUp] = useState("");
  const [feedCheck, setFeedCheck] = useState<FeedCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!address) return;
    setLoadError(null);
    try {
      const [typeRes, opRes, groupsRes] = await Promise.all([
        getServiceType(CONTENT_SCANNER_SERVICE_TYPE).then((r) => r.config, () => null),
        getServiceOperator(address, CONTENT_SCANNER_SERVICE_TYPE).then(
          (r) => r.operator,
          (e) => (errorKind(e) === "not-found" ? null : Promise.reject(e)),
        ),
        listGroups().then((r) => r.group || [], () => [] as Group[]),
      ]);
      setTypeConfig(typeRes);
      setOperator(opRes);
      setGroups(groupsRes);
      const published = opRes ? parseOperatorMetadata(opRes.metadata) : null;
      if (published) {
        setVerdictKey(published.verdict_key);
        setFeedUrl(published.feed_url);
        setRuleset(published.ruleset_version || "v1");
      }
      setController((c) => c || groupsRes.find((g) => g.index === DEFAULT_CONTROLLER)?.policy_address || "");
      setBond((b) => b || (typeRes ? (Number(typeRes.min_bond_amount) / 1_000_000).toString() : ""));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "could not read the scanner registration");
    }
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const published = useMemo(() => (operator ? parseOperatorMetadata(operator.metadata) : null), [operator]);
  const groupName = (addr: string) => groups.find((g) => g.policy_address === addr)?.index;

  if (!connected || !address) {
    return (
      <div className="sd-hull-tile rounded-xl p-4 text-sm text-zinc-400">
        Connect a wallet to register as a content scanner.
      </div>
    );
  }

  const problems = metadataProblems(verdictKey, feedUrl);
  const meta = buildMetadata(verdictKey, feedUrl, ruleset || "v1");
  const minBond = BigInt(typeConfig?.min_bond_amount || "0");
  const bondMicro = bond.trim() && parseFloat(bond) > 0 ? BigInt(toMicro(bond)) : BigInt(0);
  const metadataChanged =
    !!published &&
    (published.verdict_key !== meta.verdict_key || published.feed_url !== meta.feed_url || (published.ruleset_version || "") !== meta.ruleset_version);

  const send = async (msg: { typeUrl: string; value: Record<string, unknown> }, key: string) => {
    try {
      setBusy(key);
      setTxError(null);
      await signAndBroadcast([msg]);
      setTopUp("");
      await fetchData();
      onChanged?.();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setBusy(null);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    setFeedCheck(await checkFeed(feedUrl, verdictKey, address));
    setChecking(false);
  };

  const field =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";

  const metadataFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-xs text-zinc-500 sm:col-span-2">
        Verdict public key
        <input
          className={`${field} mt-1 font-mono`}
          value={verdictKey}
          onChange={(e) => setVerdictKey(e.target.value)}
          placeholder="base64, printed by: contentscan keygen /data/verdict.key"
        />
      </label>
      <label className="block text-xs text-zinc-500">
        Feed URL
        <input
          className={`${field} mt-1`}
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          placeholder="https://scan.example.com/"
        />
      </label>
      <label className="block text-xs text-zinc-500">
        Ruleset version
        <input className={`${field} mt-1`} value={ruleset} onChange={(e) => setRuleset(e.target.value)} placeholder="v1" />
      </label>
    </div>
  );

  return (
    <div className="sd-hull-tile space-y-4 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Content scanner</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Scanners judge media-labelled content and publish signed verdicts; frontends show flagged content once enough
            active scanners call it clean{typeConfig ? ` (quorum ${typeConfig.attestation_quorum || 0})` : ""}.
          </p>
        </div>
        {operator && (
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
            {OPERATOR_STATUS_LABELS[operator.status] || operator.status}
          </span>
        )}
      </div>

      {loadError && <p className="text-xs text-red-400">{loadError}</p>}
      {operator === undefined && !loadError && <div className="h-10 animate-pulse rounded bg-zinc-800" />}
      {typeConfig && !typeConfig.enabled && (
        <p className="text-xs text-amber-300">The content-scanner service type is disabled on this chain: governance has to enable it.</p>
      )}

      {operator === null && !open && (
        <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setOpen(true)} disabled={!typeConfig?.enabled}>
          Register this account as a scanner
        </button>
      )}

      {operator === null && open && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-zinc-400">
            <li>
              Run <span className="font-mono">contentscan keygen /data/verdict.key</span> where the worker will run and paste
              the public key it prints.
            </li>
            <li>
              Serve the worker&apos;s <span className="font-mono">CS_FEED_DIR</span> at the feed URL (or set{" "}
              <span className="font-mono">CS_LISTEN</span>) and start it with{" "}
              <span className="font-mono">CS_GRANTER={address}</span>.
            </li>
            <li>Register here. This account bonds the SPARK and stays the operator.</li>
            <li>
              Grant the worker a session key for <span className="font-mono">MsgSubmitCheckpoint</span> on the{" "}
              <Link href="/permissions" className="text-indigo-400 hover:underline">
                Permissions
              </Link>{" "}
              page, and give its key file to the worker as <span className="font-mono">CS_SESSION_KEY_FILE</span>.
            </li>
          </ol>

          {metadataFields}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-500">
              Controller (the council that hires and disciplines you)
              <select className={`${field} mt-1`} value={controller} onChange={(e) => setController(e.target.value)}>
                <option value="">Choose a council</option>
                {groups.map((g) => (
                  <option key={g.policy_address} value={g.policy_address}>
                    {g.index}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-zinc-500">
              Bond ({spark}, at least {formatSpark(minBond)})
              <NumberInput className={`${field} mt-1`} value={bond} onChange={(e) => setBond(e.target.value)} />
            </label>
          </div>

          {problems.length > 0 && (verdictKey || feedUrl) && (
            <ul className="space-y-1 text-xs text-red-400">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {bondMicro > BigInt(0) && bondMicro < minBond && (
            <p className="text-xs text-red-400">The bond must be at least {formatSpark(minBond)} {spark}.</p>
          )}

          {problems.length === 0 && (
            <pre className="overflow-x-auto rounded-lg bg-zinc-900/60 p-3 text-[11px] text-zinc-400">{JSON.stringify(meta)}</pre>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="sd-btn sd-btn-secondary" disabled={problems.length > 0 || checking} onClick={runCheck}>
              {checking ? "Checking..." : "Check feed"}
            </button>
            <button
              type="button"
              className="sd-btn sd-btn-primary"
              disabled={problems.length > 0 || !controller || bondMicro < minBond || bondMicro === BigInt(0) || !!busy}
              onClick={() =>
                send(
                  {
                    typeUrl: ServiceMsgTypeUrls.RegisterOperator,
                    value: {
                      creator: address,
                      serviceType: CONTENT_SCANNER_SERVICE_TYPE,
                      controller,
                      bondAmount: bondMicro.toString(),
                      metadata: metadataBytes(meta),
                    },
                  },
                  "register",
                )
              }
            >
              {busy === "register" ? "Registering..." : `Register and bond ${bond || "0"} ${spark}`}
            </button>
            <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {operator && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-zinc-500">Bond</p>
              <p className="font-medium text-zinc-200">
                {formatSpark(operator.bond_amount)} {spark}
                {BigInt(operator.bond_amount || "0") < minBond && <span className="text-amber-300"> (below {formatSpark(minBond)})</span>}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Controller</p>
              <p className="font-medium text-zinc-200">
                {groupName(operator.controller) || <CopyableAddress address={operator.controller} />}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Feed</p>
              <p className="truncate font-medium text-zinc-200">{published?.feed_url || "metadata unreadable"}</p>
            </div>
          </div>

          {!published && (
            <p className="text-xs text-amber-300">
              Frontends cannot read this operator&apos;s metadata, so its verdicts count for nothing. Publish a verdict key
              and feed URL below.
            </p>
          )}

          {metadataFields}
          {problems.length > 0 && (
            <ul className="space-y-1 text-xs text-red-400">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="sd-btn sd-btn-secondary" disabled={problems.length > 0 || checking} onClick={runCheck}>
              {checking ? "Checking..." : "Check feed"}
            </button>
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              disabled={problems.length > 0 || (!metadataChanged && !!published) || !!busy}
              onClick={() =>
                send(
                  {
                    typeUrl: ServiceMsgTypeUrls.UpdateMetadata,
                    value: { operator: address, serviceType: CONTENT_SCANNER_SERVICE_TYPE, newMetadata: metadataBytes(meta) },
                  },
                  "metadata",
                )
              }
            >
              {busy === "metadata" ? "Publishing..." : "Publish metadata"}
            </button>
            <NumberInput
              className="w-36 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              value={topUp}
              onChange={(e) => setTopUp(e.target.value)}
              placeholder={`Top up (${spark})`}
            />
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              disabled={!topUp.trim() || !(parseFloat(topUp) > 0) || !!busy}
              onClick={() =>
                send(
                  {
                    typeUrl: ServiceMsgTypeUrls.TopUpBond,
                    value: { operator: address, serviceType: CONTENT_SCANNER_SERVICE_TYPE, additionalBondAmount: toMicro(topUp) },
                  },
                  "topup",
                )
              }
            >
              {busy === "topup" ? "Topping up..." : "Top up bond"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            The worker checkpoints through a session key for <span className="font-mono">MsgSubmitCheckpoint</span>, granted on
            the{" "}
            <Link href="/permissions" className="text-indigo-400 hover:underline">
              Permissions
            </Link>{" "}
            page, with <span className="font-mono">CS_GRANTER={address}</span>.
          </p>
        </div>
      )}

      {feedCheck && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            feedCheck.ok ? "border-emerald-800/50 bg-emerald-900/15 text-emerald-300" : "border-amber-800/50 bg-amber-900/15 text-amber-300"
          }`}
        >
          {feedCheck.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}
      {txError && <p className="text-xs text-red-400">{txError}</p>}
    </div>
  );
}
