"use client";

import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import { useChainConfig } from "./ChainConfigContext";
import type { Session } from "@/types/session";
import { getCommonsParams, getSessionsByGrantee, isArchiveModeActive } from "@/lib/api";
import { CommonsMsgTypeUrls, SESSION_FORBIDDEN_TYPES, SessionMsgTypeUrls } from "@/lib/tx";

/**
 * Phases a tx walks through, in order. Callers pass `onPhase` to drive UI
 * (button label, elapsed timer) so users see progress instead of a stuck spinner.
 *  - "signing":     Keplr popup is open / awaiting user signature
 *  - "broadcasting": signed; sending to the RPC mempool
 *  - "confirming":   accepted by mempool; polling for block inclusion
 */
// "retrying" precedes the re-sign after a sequence mismatch, so the UI can
// explain the extra wallet prompt instead of silently popping Keplr again.
export type TxPhase = "signing" | "broadcasting" | "confirming" | "retrying";

interface WalletState {
  /** Returns the granter address when session mode is active, otherwise the connected wallet address. */
  address: string | null;
  /** Always returns the actual connected wallet (hot wallet) address. */
  signerAddress: string | null;
  name: string | null;
  connected: boolean;
  connecting: boolean;
  /** True once the initial auto-reconnect attempt has resolved (or was skipped). */
  ready: boolean;
  isLedger: boolean;
  connect: () => Promise<string | null>;
  disconnect: () => void;
  signAndBroadcast: (
    msgs: readonly { typeUrl: string; value: unknown }[],
    memo?: string,
    onPhase?: (phase: TxPhase, hash?: string) => void,
  ) => Promise<string>;
  // Session mode
  sessionActive: boolean;
  activeSession: Session | null;
  availableSessions: Session[];
  activateSession: (session: Session) => void;
  deactivateSession: () => void;
}

const WalletContext = createContext<WalletState>({
  address: null,
  signerAddress: null,
  name: null,
  connected: false,
  connecting: false,
  ready: false,
  isLedger: false,
  connect: async () => null,
  disconnect: () => {},
  signAndBroadcast: async () => "",
  sessionActive: false,
  activeSession: null,
  availableSessions: [],
  activateSession: () => {},
  deactivateSession: () => {},
});

export function useWallet() {
  return useContext(WalletContext);
}

// x/session messages that are signed by the connected wallet itself and never
// wrapped in MsgExecSession. All but MsgRevokeGrant are on the chain's
// non-delegable list; MsgRevokeGrant is delegable only to a key with
// allow_self_revoke, and the permissions page always acts as the hot wallet.
const SESSION_MGMT_TYPES: Set<string> = new Set(Object.values(SessionMsgTypeUrls));

// Inner-message typeUrls that x/commons exempts from the ProposalFee
// ante-handler check (see x/commons/ante/group_policy.go). Mirroring the
// chain's list here means signaling votes (empty messages) and emergency
// actions still use the default tx fee instead of paying 5 SPARK.
const PROPOSAL_FEE_EXEMPT_INNER_TYPES: Set<string> = new Set([
  "/sparkdream.commons.v1.MsgEmergencyCancelGovProposal",
  "/sparkdream.commons.v1.MsgVetoGroupProposals",
]);

/**
 * True if `msgs` contains a MsgSubmitProposal that requires the proposal fee.
 * Mirrors x/commons/ante/group_policy.go: signaling proposals (no inner
 * messages) pay the fee; otherwise any non-exempt inner message triggers it.
 */
function txRequiresProposalFee(msgs: readonly { typeUrl: string; value: unknown }[]): boolean {
  return msgs.some((m) => {
    if (m.typeUrl !== CommonsMsgTypeUrls.SubmitProposal) return false;
    const v = m.value as { messages?: readonly { typeUrl: string }[] };
    const inners = v.messages ?? [];
    if (inners.length === 0) return true;
    return inners.some((inner) => !PROPOSAL_FEE_EXEMPT_INNER_TYPES.has(inner.typeUrl));
  });
}

/**
 * Parse a `sdk.Coins`-formatted string like "5000000uspark" or
 * "100uspark,200uother" into discrete `{denom, amount}` entries.
 * Denoms may contain `.` (per-chain x/identity denoms like
 * `usparz.sparkdreamdev`) and IBC-style `ibc/<hash>` separators.
 */
function parseCoinsString(s: string): Array<{ denom: string; amount: string }> {
  if (!s.trim()) return [];
  return s.split(",").map((chunk) => {
    const m = chunk.trim().match(/^(\d+)([a-zA-Z][a-zA-Z0-9/:._-]*)$/);
    if (!m) throw new Error(`invalid coin string: ${chunk}`);
    return { amount: m[1], denom: m[2] };
  });
}

/**
 * Extract the mempool-authoritative sequence from a CheckTx
 * "account sequence mismatch" error; null for every other error. Typical
 * shape: "account sequence mismatch, expected 54, got 53: incorrect account
 * sequence". Used to re-sign with the sequence the node actually wants after
 * a prior broadcast wedged in the mempool (see signAndBroadcast).
 */
function parseExpectedSequence(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes("account sequence mismatch")) return null;
  const m = msg.match(/expected (\d+), got \d+/);
  if (!m) return null;
  const expected = parseInt(m[1], 10);
  return Number.isFinite(expected) ? expected : null;
}

/** A tx CheckTx accepted but that we never saw reach a block. */
interface PendingTx {
  hash: string;
  /** Wall-clock ms at broadcast; drives the TTL prune below. */
  broadcastAt: number;
}

// How long a remembered hash keeps blocking the sequence retry. CheckTx
// acceptance is not a guarantee of inclusion: a tx can be evicted from the
// mempool and never land, and `getTx` then returns null for it forever. With
// no expiry that single hash would refuse every future retry for the address
// with no way for the user to clear it. 30 minutes is well past the 300s
// confirm ceiling in signAndBroadcast and past any realistic mempool TTL.
const PENDING_TX_TTL_MS = 30 * 60 * 1000;

// Backstop on entries per address, bounding what we write to localStorage if
// broadcasts wedge faster than the TTL retires them. The TTL prune runs
// first, so this only bites in a pathological run; dropping the oldest then
// is safe because the fresher entries it keeps still block the retry.
const PENDING_TX_LIMIT = 50;

function pendingTxKey(address: string): string {
  return `unconfirmed_tx:${address}`;
}

/** Drop TTL-expired entries, then trim oldest-first to PENDING_TX_LIMIT. */
function prunePendingTxs(entries: readonly PendingTx[], now: number): PendingTx[] {
  const fresh = entries
    .filter((e) => now - e.broadcastAt < PENDING_TX_TTL_MS)
    .sort((a, b) => a.broadcastAt - b.broadcastAt);
  return fresh.slice(Math.max(0, fresh.length - PENDING_TX_LIMIT));
}

function loadPendingTxs(address: string): PendingTx[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(pendingTxKey(address));
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr.flatMap((entry): PendingTx[] => {
      // Tolerate the pre-TTL format (bare hash strings) by treating them as
      // just broadcast: erring toward still blocking the retry beats
      // forgetting a genuinely outstanding tx.
      if (typeof entry === "string") return [{ hash: entry, broadcastAt: now }];
      if (typeof entry !== "object" || entry === null) return [];
      const { hash, broadcastAt } = entry as Partial<PendingTx>;
      if (typeof hash !== "string" || typeof broadcastAt !== "number") return [];
      return [{ hash, broadcastAt }];
    });
  } catch {
    return [];
  }
}

function storePendingTxs(address: string, entries: readonly PendingTx[]): void {
  if (typeof window === "undefined") return;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(pendingTxKey(address));
    } else {
      window.localStorage.setItem(pendingTxKey(address), JSON.stringify(entries));
    }
  } catch {
    // Storage unavailable — in-memory tracking still covers this session.
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { config, chainInfo } = useChainConfig();
  const [rawAddress, setRawAddress] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [isLedger, setIsLedger] = useState(false);
  const [ready, setReady] = useState(false);
  const needsSessionRestore = useRef(false);
  // Hashes of txs CheckTx accepted but that we never saw committed (the
  // confirm poll timed out), keyed by signing address. While any is
  // outstanding, the sequence auto-retry below must not fire for that
  // address: the mismatch it would "fix" is most likely one of those txs
  // still sitting in the mempool, and re-signing at the next sequence turns
  // an accidental resubmit into two executed transactions.
  //
  // A list (not a single slot) survives concurrent broadcasts from racing
  // flows, and it is mirrored to localStorage per address so a page reload —
  // or a crash mid-confirm — does not lose track of a wedged mempool entry
  // from a previous session. Entries age out after PENDING_TX_TTL_MS so an
  // evicted tx that will never land cannot block the retry forever.
  const pendingTxs = useRef<Map<string, PendingTx[]>>(new Map());

  // Read-through accessor: every mutator below goes through this and then
  // through `writePendingTxs`, so there is exactly one live array per address.
  // (An earlier revision let the sweep iterate one array loaded from storage
  // while `forgetPendingTx` mutated a second copy of it.)
  const readPendingTxs = useCallback((address: string): PendingTx[] => {
    let entries = pendingTxs.current.get(address);
    if (!entries) {
      entries = loadPendingTxs(address);
      pendingTxs.current.set(address, entries);
    }
    return entries;
  }, []);

  const writePendingTxs = useCallback((address: string, entries: PendingTx[]) => {
    pendingTxs.current.set(address, entries);
    storePendingTxs(address, entries);
  }, []);

  const rememberPendingTx = useCallback(
    (address: string, hash: string) => {
      const now = Date.now();
      const entries = readPendingTxs(address).filter((e) => e.hash !== hash);
      entries.push({ hash, broadcastAt: now });
      writePendingTxs(address, prunePendingTxs(entries, now));
    },
    [readPendingTxs, writePendingTxs],
  );

  const forgetPendingTx = useCallback(
    (address: string, hash: string) => {
      const entries = readPendingTxs(address);
      const remaining = entries.filter((e) => e.hash !== hash);
      if (remaining.length === entries.length) return;
      writePendingTxs(address, remaining);
    },
    [readPendingTxs, writePendingTxs],
  );

  // Re-check every remembered hash for this address. Landed ones (any code)
  // leave the set — they are no longer a double-execution risk; so do
  // TTL-expired ones, without a lookup. Still-missing hashes are returned so
  // the caller can refuse the retry.
  const sweepPendingTxs = useCallback(
    async (address: string, isLanded: (hash: string) => Promise<boolean>): Promise<string[]> => {
      const entries = prunePendingTxs(readPendingTxs(address), Date.now());
      // In parallel: this runs on an error path with the user already waiting
      // out a stalled broadcast, and serial round trips would add to that.
      const landed = await Promise.all(
        entries.map(async (e) => {
          try {
            return await isLanded(e.hash);
          } catch {
            return false; // can't prove it landed — treat as outstanding
          }
        }),
      );
      const outstanding = entries.filter((_, i) => !landed[i]);
      writePendingTxs(address, outstanding);
      return outstanding.map((e) => e.hash);
    },
    [readPendingTxs, writePendingTxs],
  );

  // Session mode state
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [availableSessions, setAvailableSessions] = useState<Session[]>([]);

  const sessionActive = activeSession !== null;
  const address = activeSession ? activeSession.granter : rawAddress;

  // Returns the connected hot-wallet address, or null if Keplr was unavailable
  // or the connect attempt failed/yielded no account. Callers that gate app
  // readiness on connect (auto-reconnect below) rely on this to distinguish
  // "address is set" from "connect resolved but did nothing".
  const connect = useCallback(async (): Promise<string | null> => {
    if (typeof window === "undefined" || !window.keplr) {
      alert("Please install Keplr wallet extension");
      return null;
    }

    setConnecting(true);
    try {
      await window.keplr.experimentalSuggestChain(chainInfo);
      await window.keplr.enable(config.chainId);

      const key = await window.keplr.getKey(config.chainId);
      setName(key.name);
      setIsLedger(!!key.isNanoLedger);

      const offlineSigner = key.isNanoLedger
        ? window.keplr.getOfflineSignerOnlyAmino(config.chainId)
        : window.keplr.getOfflineSigner(config.chainId);
      const accounts = await offlineSigner.getAccounts();
      if (accounts.length > 0) {
        setRawAddress(accounts[0].address);
        localStorage.setItem("wallet_connected", "true");
        return accounts[0].address;
      }

      localStorage.setItem("wallet_connected", "true");
      return null;
    } catch (err) {
      console.error("Failed to connect wallet:", err);
      return null;
    } finally {
      setConnecting(false);
    }
  }, [config.chainId, chainInfo]);

  const disconnect = useCallback(() => {
    setRawAddress(null);
    setName(null);
    setIsLedger(false);
    setActiveSession(null);
    setAvailableSessions([]);
    localStorage.removeItem("wallet_connected");
    localStorage.removeItem("session_granter");
  }, []);

  const signAndBroadcast = useCallback(
    async (
      msgs: readonly { typeUrl: string; value: unknown }[],
      memo = "",
      onPhase?: (phase: TxPhase, hash?: string) => void,
    ) => {
      if (isArchiveModeActive()) {
        throw new Error("Archive mode is read-only");
      }
      if (!rawAddress || !window.keplr) {
        throw new Error("Wallet not connected");
      }

      const { SigningStargateClient } = await import("@cosmjs/stargate");
      type EncodeObject = import("@cosmjs/proto-signing").EncodeObject;
      // Both the TsProto and Pbjs codecs that ship in cosmjs-types have
      // `encode`/`fromPartial` but with incompatible argument shapes — the
      // union doesn't simplify into a callable type, so calls through
      // `registry.lookupType` need a narrowing cast. This is the structural
      // shape both halves satisfy.
      type RegistryCodec = {
        encode: (msg: unknown) => { finish: () => Uint8Array };
        fromPartial: (val: unknown) => unknown;
      };

      const { buildSigningTypes } = await import("@/lib/signingTypes");
      const { registry, aminoTypes } = await buildSigningTypes();

      // Keplr's default `signAmino`/`signDirect` quietly overrides the fee in
      // our sign doc with its own gas-price calculation, which falls under
      // both the chain's `min-gas-prices` floor (after we stopped underpaying)
      // and the 5 SPARK ProposalFee, bouncing every signed tx. Set Keplr's
      // global signing flags so every signAmino/signDirect call from this
      // session honors what we put in the sign doc. This is the
      // canonical Keplr pattern — wrapping the offline signer instead would
      // skip its internal cosmjs-vs-keplr shape conversion and break sig
      // verification on plain txs (regressed once before).
      if (window.keplr.defaultOptions) {
        window.keplr.defaultOptions.sign = {
          ...(window.keplr.defaultOptions.sign ?? {}),
          preferNoSetFee: true,
          preferNoSetMemo: true,
        };
      } else {
        window.keplr.defaultOptions = {
          sign: { preferNoSetFee: true, preferNoSetMemo: true },
        };
      }

      const key = await window.keplr.getKey(config.chainId);
      const offlineSigner = key.isNanoLedger
        ? window.keplr.getOfflineSignerOnlyAmino(config.chainId)
        : window.keplr.getOfflineSigner(config.chainId);

      const client = await SigningStargateClient.connectWithSigner(
        config.rpcEndpoint,
        offlineSigner,
        { registry, aminoTypes }
      );

      // Wrap messages in MsgExecSession when session mode is active,
      // unless the messages are session management operations themselves.
      // Identity and vault messages can never go through a session key, and
      // in session mode `address` is the granter the hot wallet cannot sign
      // for, so they need session mode switched off.
      let finalMsgs = msgs;
      const isSessionMgmt = msgs.some((m) => SESSION_MGMT_TYPES.has(m.typeUrl));
      if (activeSession && msgs.some((m) => SESSION_FORBIDDEN_TYPES.has(m.typeUrl))) {
        throw new Error("This action can't be done with a session key. Switch off session mode and sign with your main wallet.");
      }
      if (activeSession && !isSessionMgmt) {
        // Validate session hasn't expired
        if (activeSession.expiration && new Date(activeSession.expiration) < new Date()) {
          setActiveSession(null);
          localStorage.removeItem("session_granter");
          throw new Error("Session has expired. Session mode has been deactivated.");
        }

        // Encode each inner message to protobuf Any
        const encodedInnerMsgs = msgs.map((msg) => {
          const msgType = registry.lookupType(msg.typeUrl);
          if (!msgType) {
            throw new Error(`Unknown message type: ${msg.typeUrl}`);
          }
          const codec = msgType as unknown as RegistryCodec;
          const encoded = codec.encode(codec.fromPartial(msg.value)).finish();
          return { typeUrl: msg.typeUrl, value: encoded };
        });

        finalMsgs = [
          {
            typeUrl: SessionMsgTypeUrls.ExecSession,
            value: {
              grantee: rawAddress,
              granter: activeSession.granter,
              msgs: encodedInnerMsgs,
            },
          },
        ];
      }

      // Derive the minimum fee from the chain's registered gas price
      // (average step). This matches what validators accept as `min-gas-prices`
      // — using a hard-coded 5000 underpaid 0.025 × 300000 = 7500 and the chain
      // rejected with "insufficient fee" once we stopped letting Keplr silently
      // bump the fee for us. Fallback to 0.025 if chainInfo somehow omits it.
      //
      // Gas comes from a simulation of the exact messages (identity-alias
      // checks and vault executions can run well past a flat limit), padded
      // 40%, and never below the 300000 every flow was tuned against. If the
      // simulation fails, the flat limit stands and broadcast reports the error.
      let gas = 300000;
      try {
        const simulated = await client.simulate(rawAddress, finalMsgs as readonly EncodeObject[], memo);
        gas = Math.max(gas, Math.ceil(simulated * 1.4));
      } catch {
        // keep the flat limit
      }
      const gasPrice = chainInfo.feeCurrencies?.[0]?.gasPriceStep?.average ?? 0.025;
      const minFeeAmount = Math.ceil(gasPrice * gas);
      let fee = {
        amount: [{ denom: config.denom, amount: String(minFeeAmount) }],
        gas: String(gas),
      };

      // x/commons enforces a min tx fee on MsgSubmitProposal containing
      // non-exempt inner messages (5 SPARK by default). Query the live
      // param so future changes don't strand the UI on a stale constant.
      // Per-denom we take the max of (gas-price floor, proposal-fee minimum)
      // so we always clear both ante checks.
      if (txRequiresProposalFee(msgs)) {
        try {
          const { params } = await getCommonsParams();
          const required = parseCoinsString(params.proposal_fee);
          if (required.length > 0) {
            fee = {
              amount: required.map((c) =>
                c.denom === config.denom && BigInt(c.amount) < BigInt(minFeeAmount)
                  ? { denom: c.denom, amount: String(minFeeAmount) }
                  : c
              ),
              gas: String(gas),
            };
          }
        } catch (err) {
          throw new Error(
            `Failed to look up commons proposal fee: ${err instanceof Error ? err.message : err}`
          );
        }
      }

      // Split sign vs broadcast vs confirm so the caller can drive a phased
      // progress UI (button label, elapsed timer). cosmjs's one-shot
      // `signAndBroadcast` polls internally with a 60s default and surfaces a
      // timeout as a hard error even when the tx actually landed — see commit
      // tied to the delegate-modal UX work.
      const { TxRaw } = await import("cosmjs-types/cosmos/tx/v1beta1/tx");

      // Sign + broadcast with up to `maxSequenceRetries` re-signs on
      // "account sequence mismatch". When a previous broadcast was accepted
      // into the mempool but never included (chain stall, CheckTx eviction),
      // the account query still returns the committed sequence while the
      // node's mempool expects the next one — every naive retry bounces with
      // "expected N, got M". The CheckTx error names the sequence the node
      // actually wants, so re-sign with it explicitly (the 5th `sign`
      // argument overrides the internal account query). Seen repeatedly on
      // the devnet stalls of 2026-09-14/15; manual `--sequence N` recovery
      // worked every time.
      const maxSequenceRetries = 3;
      let explicitSequence: number | null = null;
      let accountNumber: bigint | null = null;
      for (let attempt = 0; attempt <= maxSequenceRetries; attempt++) {
        // Each retry re-prompts the wallet, so announce it as its own phase
        // rather than letting a second Keplr popup arrive unexplained.
        onPhase?.(attempt === 0 ? "signing" : "retrying");
        const txRaw = explicitSequence !== null && accountNumber !== null
          ? await client.sign(
              rawAddress,
              finalMsgs as readonly EncodeObject[],
              fee,
              memo,
              { accountNumber, sequence: explicitSequence, chainId: config.chainId },
            )
          : await client.sign(rawAddress, finalMsgs as readonly EncodeObject[], fee, memo);
        const txBytes = TxRaw.encode(txRaw).finish();

        onPhase?.("broadcasting");
        let hash: string;
        try {
          hash = await client.broadcastTxSync(txBytes);
        } catch (err) {
          const expected = parseExpectedSequence(err);
          if (expected !== null) {
            // Sweep every remembered unconfirmed hash for this address: the
            // mismatch may be caused by one of our own txs still sitting in
            // the mempool, and re-signing at the next sequence would execute
            // both. Landed (or provably gone) entries clear their slot; any
            // still-missing one blocks the retry.
            const stillMissing = await sweepPendingTxs(rawAddress, async (h) => {
              const tx = await client.getTx(h);
              return tx !== null;
            });
            if (stillMissing.length > 0) {
              throw new Error(
                `Transaction ${stillMissing[0]} was broadcast earlier and has not been confirmed yet, ` +
                  `so this one was not resubmitted. Sending it now would likely execute both. ` +
                  `Check that hash on a block explorer before retrying.`
              );
            }
            if (attempt < maxSequenceRetries) {
              if (accountNumber === null) {
                const account = await client.getAccount(rawAddress);
                if (!account) throw new Error("Account not found while retrying sequence");
                accountNumber = account.accountNumber;
              }
              explicitSequence = expected;
              continue;
            }
          }
          throw err;
        }

        rememberPendingTx(rawAddress, hash);
        onPhase?.("confirming", hash);

        // Poll for inclusion ourselves with a much longer ceiling than cosmjs's
        // 60s default. Typical inclusion on this chain is ~90s, so 300s leaves
        // comfortable headroom; if a tx is going to be rejected by CheckTx that's
        // already been raised by broadcastTxSync.
        const timeoutMs = 300_000;
        const pollIntervalMs = 3_000;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const indexed = await client.getTx(hash);
          if (indexed) {
            // It reached a block; whether it succeeded or not, it is no longer
            // an outstanding mempool entry the retry has to worry about.
            forgetPendingTx(rawAddress, hash);
            if (indexed.code !== 0) {
              // `rawLog` is deprecated in favor of `events`, but for a failed
              // tx it's still the only source of the chain's formatted error
              // string (e.g. "insufficient fees: got X, expected Y") — `events`
              // doesn't include it in a structured way for human display.
              throw new Error(`Transaction failed: ${indexed.rawLog}`);
            }
            return indexed.hash;
          }
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
        throw new Error(
          `Transaction ${hash} was broadcast but not yet found on the chain after ${Math.round(timeoutMs / 1000)}s. It may still confirm — check a block explorer for the hash.`,
        );
      }
      // Unreachable: every path through the loop returns, throws, or
      // `continue`s, and the final attempt falls through to `throw err`.
      // Kept because TypeScript cannot see that the loop never exits normally.
      throw new Error("Transaction failed after sequence retries");
    },
    [rawAddress, activeSession, config.chainId, config.rpcEndpoint, config.denom, chainInfo.feeCurrencies, rememberPendingTx, forgetPendingTx, sweepPendingTxs]
  );

  const activateSession = useCallback((session: Session) => {
    setActiveSession(session);
    localStorage.setItem("session_granter", session.granter);
  }, []);

  const deactivateSession = useCallback(() => {
    setActiveSession(null);
    localStorage.removeItem("session_granter");
  }, []);

  // Retire remembered unconfirmed hashes once per connected address. The
  // sequence-mismatch path re-checks them too, but only when a mismatch
  // happens — without this a tx that timed out in the confirm poll and landed
  // a minute later would sit in localStorage until the next mismatch, and a
  // run of them would push older entries out under PENDING_TX_LIMIT.
  useEffect(() => {
    if (!rawAddress) return;
    // Local prune first: TTL-expired entries are dropped without a lookup, so
    // an address whose entries have all aged out costs no RPC connection.
    const known = readPendingTxs(rawAddress);
    const outstanding = prunePendingTxs(known, Date.now());
    if (outstanding.length !== known.length) writePendingTxs(rawAddress, outstanding);
    if (outstanding.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { StargateClient } = await import("@cosmjs/stargate");
        const client = await StargateClient.connect(config.rpcEndpoint);
        try {
          if (cancelled) return;
          await sweepPendingTxs(rawAddress, async (h) => (await client.getTx(h)) !== null);
        } finally {
          client.disconnect();
        }
      } catch {
        // Best-effort housekeeping; the retry path re-checks before it fires.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawAddress, config.rpcEndpoint, readPendingTxs, writePendingTxs, sweepPendingTxs]);

  // Fetch available sessions (where this wallet is the grantee)
  useEffect(() => {
    if (!rawAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getSessionsByGrantee(rawAddress);
        const now = new Date();
        const valid = (res.sessions || []).filter(
          (s) => !s.expiration || new Date(s.expiration) > now
        );
        if (!cancelled) {
          setAvailableSessions(valid);

          // Restore persisted session mode
          const savedGranter = localStorage.getItem("session_granter");
          if (savedGranter) {
            const match = valid.find((s) => s.granter === savedGranter);
            if (match) {
              setActiveSession(match);
            } else {
              localStorage.removeItem("session_granter");
            }
          }
        }
      } catch {
        // Session fetch is best-effort
      } finally {
        if (!cancelled && needsSessionRestore.current) {
          needsSessionRestore.current = false;
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [rawAddress]);

  // Auto-reconnect on page load if previously connected
  useEffect(() => {
    if (typeof window !== "undefined" && window.keplr && localStorage.getItem("wallet_connected")) {
      needsSessionRestore.current = !!localStorage.getItem("session_granter");
      connect()
        .then((addr) => {
          // If connect produced no address (Keplr locked, popup dismissed,
          // enable threw, zero accounts), the session-restore effect below
          // never runs — it early-returns on !rawAddress. Force readiness here
          // so the app can't get wedged on the !ready skeleton with no way out.
          if (!addr) {
            needsSessionRestore.current = false;
            setReady(true);
          } else if (!needsSessionRestore.current) {
            // Connected and no session to restore — ready immediately.
            // Otherwise the session-restore effect owns setReady(true).
            setReady(true);
          }
        })
        .catch(() => {
          needsSessionRestore.current = false;
          setReady(true);
        });
    } else {
      setReady(true);
    }
  }, [connect]);

  // Listen for Keplr account changes
  useEffect(() => {
    if (typeof window !== "undefined" && window.keplr) {
      const handler = () => {
        if (rawAddress) connect();
      };
      window.addEventListener("keplr_keystorechange", handler);
      return () => window.removeEventListener("keplr_keystorechange", handler);
    }
  }, [rawAddress, connect]);

  return (
    <WalletContext.Provider
      value={{
        address,
        signerAddress: rawAddress,
        name,
        connected: !!rawAddress,
        connecting,
        ready,
        isLedger,
        connect,
        disconnect,
        signAndBroadcast,
        sessionActive,
        activeSession,
        availableSessions,
        activateSession,
        deactivateSession,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
