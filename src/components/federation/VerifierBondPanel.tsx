"use client";

import { useCallback, useEffect, useState } from "react";
import { getBondedRole, getBondedRoleConfig } from "@/lib/api";
import { errorKind } from "@/lib/errors";
import { RepMsgTypeUrls } from "@/lib/tx";
import { formatSpark } from "@/lib/utils";
import { useWallet } from "@/contexts/WalletContext";
import { useDreamDenom } from "@/hooks/useDreamDenom";
import NumberInput from "@/components/NumberInput";
import {
  BONDED_ROLE_STATUS_LABELS,
  BondedRoleStatus,
  RoleType,
  type BondedRole,
  type BondedRoleConfig,
} from "@/types/rep";

const VERIFIER_ROLE = RoleType.FEDERATION_VERIFIER;

function toMicro(amount: string): string {
  return BigInt(Math.floor(parseFloat(amount) * 1_000_000)).toString();
}

function big(v: string | undefined): bigint {
  try {
    return BigInt(v || "0");
  } catch {
    return BigInt(0);
  }
}

function days(seconds: string | undefined): string {
  const d = Number(seconds || 0) / 86_400;
  return d >= 1 ? `${Number.isInteger(d) ? d : d.toFixed(1)} day${d === 1 ? "" : "s"}` : `${Math.round(d * 24)} hours`;
}

/**
 * The connected wallet's federation-verifier bond: bond to become a
 * verifier, add to it, withdraw part of it, or take a withdrawal back.
 *
 * Withdrawing is not free while it runs: x/rep marks the role UNBONDING for
 * the whole unbond_cooldown, and x/federation refuses MsgVerifyContent from a
 * verifier in any status but NORMAL or RECOVERY. So even trimming a bond
 * that sits well above min_bond pauses verifying until the unbond matures,
 * after which the status is recomputed from what is left (NORMAL at or
 * above min_bond). Cancelling restores the bond, and verifying, at once.
 */
export default function VerifierBondPanel({ onChanged }: { onChanged?: () => void }) {
  const dream = useDreamDenom();
  const { address, connected, signAndBroadcast } = useWallet();

  // undefined: loading; null: the chain has no verifier record for this address
  const [role, setRole] = useState<BondedRole | null | undefined>(undefined);
  const [config, setConfig] = useState<BondedRoleConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [confirmUnbond, setConfirmUnbond] = useState(false);

  const fetchData = useCallback(async () => {
    if (!address) return;
    setLoadError(null);
    const [roleRes, configRes] = await Promise.all([
      getBondedRole(VERIFIER_ROLE, address).then(
        (r) => r.bonded_role,
        (e) => (errorKind(e) === "not-found" ? null : Promise.reject(e)),
      ),
      getBondedRoleConfig(VERIFIER_ROLE).then((r) => r.bonded_role_config, () => null),
    ]).catch((e) => {
      setLoadError(e instanceof Error ? e.message : "could not read the verifier record");
      return [undefined, null] as const;
    });
    setRole(roleRes);
    setConfig(configRes);
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!connected || !address) return null;

  const minBond = big(config?.min_bond);
  const current = big(role?.current_bond);
  const pending = big(role?.pending_unbond_amount);
  const committed = big(role?.total_committed_bond);
  const available = current - committed - pending;
  // What can go without dropping below min_bond: the natural thing to unbond
  // after bonding twice by mistake.
  const excess = current - pending - minBond > available ? available : current - pending - minBond;
  const unbonding = role?.bond_status === BondedRoleStatus.UNBONDING;
  const completion = Number(role?.unbond_completion_time || 0);

  const send = async (typeUrl: string, micro: string, key: string) => {
    try {
      setBusy(key);
      setTxError(null);
      await signAndBroadcast([{ typeUrl, value: { creator: address, roleType: VERIFIER_ROLE, amount: micro } }]);
      setAmount("");
      setConfirmUnbond(false);
      await fetchData();
      onChanged?.();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setBusy(null);
    }
  };

  const entered = amount.trim() && parseFloat(amount) > 0 ? BigInt(toMicro(amount)) : BigInt(0);
  const unbondTooMuch = entered > available;
  const leavesBelowMin = role && entered > 0 && current - pending - entered < minBond;

  return (
    <div className="sd-hull-tile rounded-xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-200">Your verifier bond</h3>
        {role && (
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
            {BONDED_ROLE_STATUS_LABELS[role.bond_status] || role.bond_status}
          </span>
        )}
      </div>

      {role === undefined && !loadError && <div className="mt-3 h-12 animate-pulse rounded bg-zinc-800" />}
      {loadError && <p className="mt-3 text-xs text-red-400">{loadError}</p>}

      {role === null && (
        <p className="mt-2 text-sm text-zinc-400">
          You are not a verifier. Bonding {config ? `${formatSpark(config.min_bond)} ${dream}` : "the minimum"} makes you
          one, if you are a member at {config?.min_trust_level?.replace("TRUST_LEVEL_", "").toLowerCase() || "the required trust"} or
          above.
        </p>
      )}

      {role && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-zinc-500">Bonded</p>
              <p className="font-medium text-zinc-200">
                {formatSpark(role.current_bond)} {dream}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Minimum</p>
              <p className="font-medium text-zinc-200">{config ? `${formatSpark(config.min_bond)} ${dream}` : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Unbonding</p>
              <p className="font-medium text-zinc-200">
                {formatSpark(role.pending_unbond_amount || "0")} {dream}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Reserved</p>
              <p className="font-medium text-zinc-200" title="Bond backing verdicts still open to appeal">
                {formatSpark(role.total_committed_bond || "0")} {dream}
              </p>
            </div>
          </div>

          {unbonding && completion > 0 && (
            <p className="mt-3 rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-xs text-amber-300">
              {formatSpark(role.pending_unbond_amount)} {dream} unlocks on {new Date(completion * 1000).toLocaleString()}.
              Until then the chain refuses your verifications. Cancel the unbond to resume verifying now.
            </p>
          )}
        </>
      )}

      {role !== undefined && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800/60 pt-3">
          <NumberInput
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirmUnbond(false);
            }}
            placeholder={`Amount (${dream})`}
            className="w-40 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
          {role === null && config && (
            <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setAmount(formatSpark(config.min_bond).replace(/,/g, ""))}>
              Minimum
            </button>
          )}
          <button
            type="button"
            className="sd-btn sd-btn-secondary"
            disabled={!entered || !!busy}
            onClick={() => send(RepMsgTypeUrls.BondRole, entered.toString(), "bond")}
          >
            {busy === "bond" ? "Bonding..." : role ? "Add bond" : "Bond as verifier"}
          </button>
          {role && excess > 0 && (
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              onClick={() => {
                setAmount((Number(excess) / 1_000_000).toString());
                setConfirmUnbond(false);
              }}
              title={`Everything above the ${formatSpark(minBond)} ${dream} minimum`}
            >
              Excess: {formatSpark(excess)} {dream}
            </button>
          )}
          {role && (
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              disabled={!entered || unbondTooMuch || !!busy}
              onClick={() => setConfirmUnbond(true)}
            >
              Unbond
            </button>
          )}
          {role && pending > 0 && (
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              disabled={!!busy}
              onClick={() => send(RepMsgTypeUrls.CancelUnbondRole, pending.toString(), "cancel")}
            >
              {busy === "cancel" ? "Cancelling..." : `Cancel unbond of ${formatSpark(pending)}`}
            </button>
          )}
        </div>
      )}

      {role && unbondTooMuch && entered > 0 && (
        <p className="mt-2 text-xs text-red-400">
          Only {formatSpark(available > 0 ? available : BigInt(0))} {dream} can be unbonded (the rest is reserved or already
          unbonding).
        </p>
      )}

      {confirmUnbond && role && (
        <div className="mt-3 rounded-lg border border-amber-800/50 bg-amber-900/15 p-3 text-xs text-amber-200">
          <p>
            Unbonding {formatSpark(entered)} {dream} marks your verifier role as unbonding for{" "}
            {days(config?.unbond_cooldown)}. During that time the {dream} stays locked and slashable, and the chain refuses
            your verifications. Afterwards {formatSpark(current - pending - entered)} {dream} stays bonded
            {leavesBelowMin ? `, below the ${formatSpark(minBond)} minimum: you will no longer be a verifier` : " and you verify again"}.
            You can cancel at any time to resume at once.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="sd-btn sd-btn-secondary"
              disabled={!!busy}
              onClick={() => send(RepMsgTypeUrls.UnbondRole, entered.toString(), "unbond")}
            >
              {busy === "unbond" ? "Unbonding..." : `Unbond ${formatSpark(entered)} ${dream}`}
            </button>
            <button type="button" className="sd-btn sd-btn-secondary" onClick={() => setConfirmUnbond(false)}>
              Keep it bonded
            </button>
          </div>
        </div>
      )}

      {txError && <p className="mt-2 text-xs text-red-400">{txError}</p>}
    </div>
  );
}
