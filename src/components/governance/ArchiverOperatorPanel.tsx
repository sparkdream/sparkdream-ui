"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPolicyPermissions, getServiceOperator, getServiceType, listGroups } from "@/lib/api";
import { errorKind } from "@/lib/errors";
import { ServiceMsgTypeUrls } from "@/lib/tx";
import { formatSpark } from "@/lib/utils";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  CHAIN_ARCHIVER_SERVICE_TYPE,
  archiverMetadataBytes,
  buildArchiverMetadata,
  parseArchiverMetadata,
  parseWallets,
  walletProblems,
} from "@/lib/chainArchiver";
import NumberInput from "@/components/NumberInput";
import CopyableAddress from "@/components/CopyableAddress";
import { OPERATOR_STATUS_LABELS, type Operator, type ServiceTypeConfig } from "@/types/service";
import type { Group } from "@/types/commons";

// The committee that answers for the chain's own infrastructure: it resolves
// the liveness report x/service files against a stalled archiver. A
// controller can only do that if its group holds MsgResolveReport, which the
// panel checks before it lets an archiver register under it.
const DEFAULT_CONTROLLER = "Technical Operations Committee";
const RESOLVE_REPORT = "/sparkdream.service.v1.MsgResolveReport";

function toMicro(amount: string): string {
  return BigInt(Math.floor(parseFloat(amount) * 1_000_000)).toString();
}

/**
 * Register the connected account as a chain archiver, or manage the
 * registration it has. An archiver's worker posts the block history to
 * Arweave and checkpoints it on chain; readers of that copy accept only
 * what the wallets named in the operator's metadata signed, so the
 * metadata is the registration's substance. MsgRegisterOperator must be
 * signed by the operator itself, never through a session key, so this is
 * the account whose session key the worker later checkpoints with.
 *
 * Renders nothing on a chain without the chain-archiver service type.
 */
export default function ArchiverOperatorPanel({ onChanged }: { onChanged?: () => void }) {
  const { address, connected, signAndBroadcast } = useWallet();
  const { config: chain } = useChainConfig();
  const spark = chain.displayDenom;

  // undefined: loading; null: the chain has no such type
  const [typeConfig, setTypeConfig] = useState<ServiceTypeConfig | null | undefined>(undefined);
  // undefined: loading or no wallet; null: not registered under chain-archiver
  const [operator, setOperator] = useState<Operator | null | undefined>(undefined);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [walletText, setWalletText] = useState("");
  const [controller, setController] = useState("");
  // Whether the chosen controller holds MsgResolveReport. null: not known yet.
  const [canResolve, setCanResolve] = useState<boolean | null>(null);
  const [bond, setBond] = useState("");
  const [topUp, setTopUp] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoadError(null);
    try {
      const typeRes = await getServiceType(CHAIN_ARCHIVER_SERVICE_TYPE).then(
        (r) => r.config,
        (e) => (errorKind(e) === "not-found" ? null : Promise.reject(e)),
      );
      setTypeConfig(typeRes);
      if (!typeRes || !address) return;
      const [opRes, groupsRes] = await Promise.all([
        getServiceOperator(address, CHAIN_ARCHIVER_SERVICE_TYPE).then(
          (r) => r.operator,
          (e) => (errorKind(e) === "not-found" ? null : Promise.reject(e)),
        ),
        listGroups().then((r) => r.group || [], () => [] as Group[]),
      ]);
      setOperator(opRes);
      setGroups(groupsRes);
      const published = opRes ? parseArchiverMetadata(opRes.metadata) : null;
      if (published) setWalletText(published.wallets.join("\n"));
      setController((c) => c || groupsRes.find((g) => g.index === DEFAULT_CONTROLLER)?.policy_address || "");
      setBond((b) => b || (Number(typeRes.min_bond_amount) / 1_000_000).toString());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "could not read the archiver registration");
    }
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // A group executes only the messages on its list, and a controller answers
  // a report with MsgResolveReport: under a group without it, every report
  // against the archiver would only time out.
  useEffect(() => {
    setCanResolve(null);
    if (!controller) return;
    let stale = false;
    getPolicyPermissions(controller).then(
      (r) => {
        if (!stale) setCanResolve((r.policy_permissions?.allowed_messages || []).includes(RESOLVE_REPORT));
      },
      () => {
        if (!stale) setCanResolve(false);
      },
    );
    return () => {
      stale = true;
    };
  }, [controller]);

  const published = useMemo(() => (operator ? parseArchiverMetadata(operator.metadata) : null), [operator]);
  const groupName = (addr: string) => groups.find((g) => g.policy_address === addr)?.index;

  if (typeConfig === null) return null;
  if (typeConfig === undefined && !loadError) return null;

  const title = (
    <div>
      <h3 className="text-sm font-semibold text-zinc-200">Chain archiver</h3>
      <p className="mt-1 text-xs text-zinc-500">
        An archiver keeps the permanent copy of the block history on Arweave and checkpoints on chain the last block it
        has archived. Anyone can rebuild the chain from that copy with the wallet address published here.
      </p>
    </div>
  );

  if (!connected || !address) {
    return (
      <div className="sd-hull-tile space-y-2 rounded-xl p-5">
        {title}
        <p className="text-sm text-zinc-400">Connect a wallet to register as a chain archiver.</p>
      </div>
    );
  }

  const wallets = parseWallets(walletText);
  const problems = walletProblems(wallets);
  const meta = buildArchiverMetadata(wallets);
  const minBond = BigInt(typeConfig?.min_bond_amount || "0");
  const bondMicro = bond.trim() && parseFloat(bond) > 0 ? BigInt(toMicro(bond)) : BigInt(0);
  const walletsChanged = !published || published.wallets.join(",") !== wallets.join(",");

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

  const field =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";

  const walletField = (
    <label className="block text-xs text-zinc-500">
      Arweave wallet addresses the worker uploads from (one per line)
      <textarea
        className={`${field} mt-1 font-mono`}
        rows={Math.max(2, wallets.length + 1)}
        value={walletText}
        onChange={(e) => setWalletText(e.target.value)}
        placeholder="printed by: archiveworker wallet <file>"
      />
    </label>
  );

  const walletErrors = problems.length > 0 && walletText.trim() && (
    <ul className="space-y-1 text-xs text-red-400">
      {problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );

  const workerNote = (
    <p className="text-xs text-zinc-500">
      The worker checkpoints through a session key for <span className="font-mono">MsgSubmitCheckpoint</span>, granted on
      the{" "}
      <Link href="/permissions" className="text-indigo-400 hover:underline">
        Permissions
      </Link>{" "}
      page to the key in its <span className="font-mono">ARW_SESSION_KEY_FILE</span>, with{" "}
      <span className="font-mono">ARW_GRANTER={address}</span>.
    </p>
  );

  return (
    <div className="sd-hull-tile space-y-4 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        {title}
        {operator && (
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
            {OPERATOR_STATUS_LABELS[operator.status] || operator.status}
          </span>
        )}
      </div>

      {loadError && <p className="text-xs text-red-400">{loadError}</p>}
      {operator === undefined && !loadError && <div className="h-10 animate-pulse rounded bg-zinc-800" />}
      {typeConfig && !typeConfig.enabled && (
        <p className="text-xs text-amber-300">The chain-archiver service type is disabled on this chain: governance has to enable it.</p>
      )}

      {operator === null && !open && (
        <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setOpen(true)} disabled={!typeConfig?.enabled}>
          Register this account as an archiver
        </button>
      )}

      {operator === null && open && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-zinc-400">
            <li>
              Run <span className="font-mono">archiveworker wallet &lt;file&gt;</span> where the worker will run, fund the
              address it prints with AR, and paste the address below.
            </li>
            <li>
              Let the worker upload the history first (it uploads without a chain connection). From registration it has
              {typeConfig?.checkpoint_max_lag_blocks
                ? ` ${Number(typeConfig.checkpoint_max_lag_blocks).toLocaleString("en-US")} blocks`
                : " one lag window"}{" "}
              to make its first checkpoint before an automatic liveness report.
            </li>
            <li>Register here. This account bonds the SPARK and stays the operator.</li>
            <li>
              Grant the worker a session key for <span className="font-mono">MsgSubmitCheckpoint</span> on the{" "}
              <Link href="/permissions" className="text-indigo-400 hover:underline">
                Permissions
              </Link>{" "}
              page, then start it with <span className="font-mono">ARW_LCD</span>,{" "}
              <span className="font-mono">ARW_SESSION_KEY_FILE</span> and{" "}
              <span className="font-mono">ARW_GRANTER={address}</span>.
            </li>
          </ol>

          {walletField}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-500">
              Controller (the group that answers for the archive)
              <select className={`${field} mt-1`} value={controller} onChange={(e) => setController(e.target.value)}>
                <option value="">Choose a group</option>
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

          {walletErrors}
          {controller && canResolve === false && (
            <p className="text-xs text-red-400">
              {groupName(controller) || "This group"} cannot resolve service reports (its permissions lack{" "}
              <span className="font-mono">MsgResolveReport</span>), so a report against the archiver could never be
              answered. Choose a group that can, or have governance grant it the message first.
            </p>
          )}
          {bondMicro > BigInt(0) && bondMicro < minBond && (
            <p className="text-xs text-red-400">The bond must be at least {formatSpark(minBond)} {spark}.</p>
          )}

          {problems.length === 0 && (
            <pre className="overflow-x-auto rounded-lg bg-zinc-900/60 p-3 text-[11px] text-zinc-400">{JSON.stringify(meta)}</pre>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sd-btn sd-btn-primary"
              disabled={problems.length > 0 || !controller || canResolve !== true || bondMicro < minBond || bondMicro === BigInt(0) || !!busy}
              onClick={() =>
                send(
                  {
                    typeUrl: ServiceMsgTypeUrls.RegisterOperator,
                    value: {
                      creator: address,
                      serviceType: CHAIN_ARCHIVER_SERVICE_TYPE,
                      controller,
                      bondAmount: bondMicro.toString(),
                      metadata: archiverMetadataBytes(meta),
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
              <p className="text-xs text-zinc-500">Arweave wallets</p>
              <p className="font-medium text-zinc-200">{published ? published.wallets.length : "metadata unreadable"}</p>
            </div>
          </div>

          {!published && (
            <p className="text-xs text-amber-300">
              This operator&apos;s metadata names no Arweave wallet, so nobody can tell which uploads are its own. Publish
              the wallet address below.
            </p>
          )}

          {walletField}
          {walletErrors}
          {published && walletsChanged && problems.length === 0 && (
            <p className="text-xs text-amber-300">
              Readers accept only ranges signed by a listed wallet. Keep every wallet that signed a range already
              archived, or that part of the copy stops verifying.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              disabled={problems.length > 0 || !walletsChanged || !!busy}
              onClick={() =>
                send(
                  {
                    typeUrl: ServiceMsgTypeUrls.UpdateMetadata,
                    value: { operator: address, serviceType: CHAIN_ARCHIVER_SERVICE_TYPE, newMetadata: archiverMetadataBytes(meta) },
                  },
                  "metadata",
                )
              }
            >
              {busy === "metadata" ? "Publishing..." : "Publish wallets"}
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
                    value: { operator: address, serviceType: CHAIN_ARCHIVER_SERVICE_TYPE, additionalBondAmount: toMicro(topUp) },
                  },
                  "topup",
                )
              }
            >
              {busy === "topup" ? "Topping up..." : "Top up bond"}
            </button>
          </div>
          {workerNote}
        </div>
      )}

      {txError && <p className="text-xs text-red-400">{txError}</p>}
    </div>
  );
}
