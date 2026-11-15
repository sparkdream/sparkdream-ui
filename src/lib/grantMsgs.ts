/**
 * The x/session grant messages the Permissions forms sign, as pure builders.
 *
 * Each form calls its builder and hands the result to signAndBroadcast, and
 * aminoSigning.test.ts signs the result of the same builder, so what the test
 * checks against the chain is the message the form really sends, not a copy
 * of its shape that can drift.
 *
 * Amino (Keplr+Ledger) note: the chain builds its sign bytes from each
 * message re-encoded through its Go type, where a non-nullable field is
 * always present. sparkdreamjs (0.0.52+) renders those fields itself; the
 * builders still send the session counters at their zero values, which is
 * what a Go client sends and reads the same on the chain.
 */
import { SessionMsgTypeUrls } from "./tx";

export interface GrantMsg {
  typeUrl: string;
  value: Record<string, unknown>;
}

interface GrantBase {
  granter: string;
  grantee: string;
  expiresAt: Date;
  note: string;
}

/** Go's zero time, 0001-01-01T00:00:00Z: what the chain signs for an unset stdtime. */
const GO_ZERO_TIME_MS = -62135596800000;

function grant(base: GrantBase, payload: Record<string, unknown>): GrantMsg {
  return {
    typeUrl: SessionMsgTypeUrls.CreateGrant,
    value: {
      granter: base.granter,
      grantee: base.grantee,
      expiresAt: base.expiresAt,
      note: base.note.trim(),
      ...payload,
    },
  };
}

export function sessionKeyGrantMsg(
  base: GrantBase,
  key: { allowedMsgTypes: string[]; denom: string; spendLimit: string; maxExecCount: number; allowSelfRevoke: boolean },
): GrantMsg {
  return grant(base, {
    sessionKey: {
      allowedMsgTypes: key.allowSelfRevoke ? [...key.allowedMsgTypes, SessionMsgTypeUrls.RevokeGrant] : key.allowedMsgTypes,
      spendLimit: { denom: key.denom, amount: key.spendLimit },
      // The chain's usage counters, at their zero values; it overwrites both
      // on creation.
      spent: { denom: "", amount: "0" },
      lastUsedAt: new Date(GO_ZERO_TIME_MS),
      maxExecCount: BigInt(key.maxExecCount),
      allowSelfRevoke: key.allowSelfRevoke,
    },
  });
}

export function spendingAllowanceGrantMsg(
  base: GrantBase,
  allowance: { denom: string; maxPerPeriod: string; periodSeconds: number; allowedRecipients: string[] },
): GrantMsg {
  return grant(base, {
    spendingAllowance: {
      maxPerPeriod: { denom: allowance.denom, amount: allowance.maxPerPeriod },
      periodSeconds: BigInt(allowance.periodSeconds),
      allowedRecipients: allowance.allowedRecipients,
      denom: allowance.denom,
      // The chain's usage counter, at zero; it sets it on creation.
      spentInCurrentPeriod: { denom: "", amount: "0" },
    },
  });
}

export function recurringPaymentGrantMsg(
  base: GrantBase,
  pull: { denom: string; amountPerPeriod: string; periodSeconds: number; startTime: number; maxPerEpoch: string | null },
): GrantMsg {
  return grant(base, {
    recurringPull: {
      amountPerPeriod: { denom: pull.denom, amount: pull.amountPerPeriod },
      periodSeconds: BigInt(pull.periodSeconds),
      startTime: BigInt(pull.startTime),
      // Empty lets the chain apply its default of 10 payments per day.
      maxPerEpoch: pull.maxPerEpoch ?? "",
    },
  });
}

export function scheduledTransferGrantMsg(
  base: GrantBase,
  transfer: { denom: string; amount: string; fireAt: number },
): GrantMsg {
  return grant(base, {
    scheduledOneshot: {
      // The recipient is the grantee, so they can decline before it sends.
      transfer: { recipient: base.grantee, amount: { denom: transfer.denom, amount: transfer.amount } },
      fireAt: BigInt(transfer.fireAt),
    },
  });
}

export function signInGrantMsg(base: GrantBase, service: string): GrantMsg {
  return grant(base, { signIn: { service } });
}
