// Anonymous actions through x/shield, client side.
//
// Flow: the member derives a secret from a Keplr signature (identity), registers
// its public key in x/rep once, and from then on any registered op can be sent
// anonymously: fetch the whole trust tree, prove membership in a Web Worker
// (shield.wasm, the chain's own Go prover), and broadcast a MsgShieldedExec
// signed by the shared public submitter key. The proof, not the signature,
// authorizes the exec, and the public key makes every anonymous tx look alike.

import { encodeSecp256k1Pubkey } from "@cosmjs/amino";
import { fromBase64, toBase64, toHex } from "@cosmjs/encoding";
import {
  DirectSecp256k1Wallet,
  Registry,
  encodePubkey,
  makeAuthInfoBytes,
  makeSignDoc,
} from "@cosmjs/proto-signing";
import { StargateClient } from "@cosmjs/stargate";
import { TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import type { ChainConfig } from "@/lib/chain";
import {
  getAccountNumber,
  getLatestBlockHeight,
  getNodeAppVersion,
  getShieldEpoch,
  getShieldEpochInterval,
  getShieldedOps,
  getTrustTree,
} from "@/lib/api";
import type { ShieldedOpRegistration } from "@/types/shield";

export const MSG_SHIELDED_EXEC = "/sparkdream.shield.v1.MsgShieldedExec";

// Mirrors x/shield/types/public_submitter.go: the private key is
// sha256(publicSubmitterSeed) and is public on purpose.
const PUBLIC_SUBMITTER_SEED = "sparkdream/shield/public-submitter/v1";

// Proof domain TRUST_TREE and immediate execution (shield/v1 enums).
const PROOF_DOMAIN_TRUST_TREE = 1;
const SHIELD_EXEC_IMMEDIATE = 0;

// Covers the ante handler's proof check plus the inner message's
// max_gas_per_exec (500k by default). The shield module pays, and the fee is
// zero, so the limit costs nothing; it must stay under the block gas limit.
const SHIELDED_EXEC_GAS = 1_500_000;

// Proving takes ~10s in a browser. Too close to an epoch's end, wait for the
// next epoch instead of making a proof that's stale on arrival.
const MIN_EPOCH_BLOCKS_LEFT = 4;
const EPOCH_WAIT_LIMIT_MS = 90_000;

// Unordered txs need a timeout; the chain refuses ones too far ahead.
const UNORDERED_TIMEOUT_SECONDS = 120;

export type ShieldPhase = "preparing" | "proving" | "broadcasting";

interface ShieldProof {
  proof: string;
  nullifier: string;
  rate_limit_nullifier: string;
  merkle_root: string;
}

// ---------------------------------------------------------------------------
// Prover worker
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** One chain release's prover files and the sha256 each must have. */
interface ProverAssets {
  base: string;
  digests: Record<string, string>;
}

let prover: Promise<ProverAssets> | null = null;

function zkBase(config: ChainConfig): string {
  return (config.zkAssetsUrl || "/zk").replace(/\/+$/, "");
}

/** Find the prover for the chain's release and make sure it is that release's.
 *  A prover from another release can derive the proof's public inputs
 *  differently from the chain, and its proofs then fail only at broadcast with
 *  "ZK proof verification failed", so refuse up front instead. */
async function resolveProver(config: ChainConfig): Promise<ProverAssets> {
  const chainVersion = await getNodeAppVersion();
  const version = config.zkVersion || chainVersion;
  if (!version) throw new Error("Couldn't reach the chain to pick the anonymous prover. Please try again.");
  const base = `${zkBase(config)}/${encodeURIComponent(version)}`;

  let digests = config.zkDigests ?? {};
  if (Object.keys(digests).length === 0) {
    const res = await fetch(`${base}/manifest.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`This site doesn't have the anonymous prover for ${version} yet.`);
    const manifest = (await res.json()) as { version?: string; files?: Record<string, string> };
    if (manifest.version !== version || !manifest.files) {
      throw new Error(`This site's anonymous prover manifest for ${version} is invalid.`);
    }
    digests = manifest.files;
  }

  const assets = { base, digests };
  const built = await workerCall<{ version: string }>(assets, "version");
  if (chainVersion && built.version !== chainVersion) {
    throw new Error(
      `This site's anonymous prover is for ${built.version}, but the chain runs ${chainVersion}. ` +
        "Anonymous actions are unavailable until the site is updated."
    );
  }
  return assets;
}

function proverAssets(config: ChainConfig): Promise<ProverAssets> {
  if (!prover) {
    prover = resolveProver(config).catch((err) => {
      prover = null;
      throw err;
    });
  }
  return prover;
}

async function shieldCall<T>(config: ChainConfig, fn: string, ...args: unknown[]): Promise<T> {
  return workerCall<T>(await proverAssets(config), fn, ...args);
}

function workerCall<T>(assets: ProverAssets, fn: string, ...args: unknown[]): Promise<T> {
  if (!worker) {
    worker = new Worker("/zk/shield-worker.js");
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "anonymous prover failed to load"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, assets, fn, args });
  });
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface ShieldIdentity {
  /** hex; never leaves this browser */
  secretKey: string;
  /** base64; what MsgRegisterZkPublicKey records */
  publicKey: string;
}

/** The message whose signature the anonymous identity is derived from. Signing
 *  it anywhere else would let that site link the signer's anonymous actions. */
export function identityMessage(chainId: string): string {
  return [
    "Spark Dream anonymous identity",
    `Chain: ${chainId}`,
    "Signing this creates the key for your anonymous posts and votes.",
    "Only sign it on the Spark Dream app. Anyone holding this signature can link your anonymous activity to you.",
  ].join("\n");
}

function identityStorageKey(chainId: string, address: string): string {
  return `sd-shield-identity:${chainId}:${address}`;
}

/** The identity derived earlier in this tab, if any. */
export function cachedIdentity(chainId: string, address: string): ShieldIdentity | null {
  try {
    const raw = sessionStorage.getItem(identityStorageKey(chainId, address));
    return raw ? (JSON.parse(raw) as ShieldIdentity) : null;
  } catch {
    return null;
  }
}

/** Derive the member's anonymous identity from a Keplr signature. The same
 *  wallet always derives the same identity, so nothing needs backing up. Kept
 *  in sessionStorage for the tab's lifetime so it is asked for once. */
export async function deriveIdentity(config: ChainConfig, address: string): Promise<ShieldIdentity> {
  const cached = cachedIdentity(config.chainId, address);
  if (cached) return cached;
  if (!window.keplr) throw new Error("Keplr is required to create an anonymous identity.");
  const sig = await window.keplr.signArbitrary(config.chainId, address, identityMessage(config.chainId));
  const { secret_key } = await shieldCall<{ secret_key: string }>(config, "deriveSecret", sig.signature);
  const { public_key } = await shieldCall<{ public_key: string }>(config, "publicKey", secret_key);
  const identity = { secretKey: secret_key, publicKey: public_key };
  try {
    sessionStorage.setItem(identityStorageKey(config.chainId, address), JSON.stringify(identity));
  } catch {
    // Storage blocked: the identity just isn't remembered for the tab.
  }
  return identity;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

let registryPromise: Promise<Registry> | null = null;

function shieldRegistry(): Promise<Registry> {
  registryPromise ??= (async () => {
    const registry = new Registry();
    const loads = await Promise.all([
      import("@sparkdreamnft/sparkdreamjs/sparkdream/shield/v1/tx.registry"),
      import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx.registry"),
      import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx.registry"),
      import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx.registry"),
      import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx.registry"),
      import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx.registry"),
      import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/tx.registry"),
    ]);
    for (const m of loads) m.load(registry);
    return registry;
  })();
  return registryPromise;
}

async function publicSubmitterWallet(prefix: string): Promise<DirectSecp256k1Wallet> {
  const key = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PUBLIC_SUBMITTER_SEED)));
  return DirectSecp256k1Wallet.fromKey(key, prefix);
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function scopeField(inner: Record<string, unknown>, path: string): bigint {
  const v = inner[snakeToCamel(path)] ?? inner[path];
  if (v === undefined || v === null) throw new Error(`missing ${path} for an anonymous action`);
  return BigInt(v as string | number | bigint);
}

// The raw nullifier scope this op's registration binds the proof to. Mirrors
// x/shield's resolveNullifierScope: a two-field path ("target_type,target_id")
// packs the first field into the top byte (types.PackNullifierScope), so a
// collection and an item with the same id get different scopes.
function resolveScope(reg: ShieldedOpRegistration, inner: Record<string, unknown>, epoch: string): string {
  switch (reg.nullifier_scope_type) {
    case "NULLIFIER_SCOPE_MESSAGE_FIELD": {
      const [first, second] = reg.scope_field_path.split(",");
      if (second === undefined) return scopeField(inner, first).toString();
      const qualifier = scopeField(inner, first);
      const id = scopeField(inner, second);
      if (qualifier >= BigInt(256) || id >= BigInt(1) << BigInt(56)) {
        throw new Error(`${reg.scope_field_path} out of range for an anonymous action`);
      }
      return ((qualifier << BigInt(56)) | id).toString();
    }
    case "NULLIFIER_SCOPE_GLOBAL":
      return "0";
    default:
      return epoch;
  }
}

/** The registration that lets `typeUrl` be sent anonymously right now, or null. */
export async function anonymousOp(typeUrl: string): Promise<ShieldedOpRegistration | null> {
  const { registrations } = await getShieldedOps();
  const reg = registrations.find((r) => r.message_type_url === typeUrl);
  if (!reg || !reg.active || reg.batch_mode === "SHIELD_BATCH_MODE_ENCRYPTED_ONLY") return null;
  // Ownership-mode ops (managing anonymously created content) prove the
  // content's owner tag and bind its owner sequence; submitAnonymously only
  // builds ordinary (nullifier-consuming) proofs.
  if (reg.nullifier_mode === "NULLIFIER_MODE_OWNERSHIP") return null;
  return reg;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The current shield epoch, after waiting out an epoch that is about to end.
async function settledEpoch(): Promise<string> {
  const [interval, start] = await Promise.all([getShieldEpochInterval(), getShieldEpoch()]);
  const epoch = start.epoch_state.current_epoch;
  const end = Number(start.epoch_state.epoch_start_height) + interval;
  if (end - Number(await getLatestBlockHeight()) > MIN_EPOCH_BLOCKS_LEFT) return epoch;
  const deadline = Date.now() + EPOCH_WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    await sleep(2_000);
    const now = (await getShieldEpoch()).epoch_state.current_epoch;
    if (now !== epoch) return now;
  }
  return epoch;
}

function friendlyChainError(log: string): string {
  if (/nullifier already used/i.test(log)) return "Your anonymous identity has already done this here.";
  if (/rate limit/i.test(log)) return "You've reached the limit for anonymous actions this epoch. Try again later.";
  if (/merkle root/i.test(log)) return "The member list changed while you were sending. Please try again.";
  if (/no verification key/i.test(log)) return "Anonymous actions aren't available on this chain yet. Its proof verification key hasn't been set up.";
  if (/ZK proof verification failed/i.test(log)) {
    // A proof this client made and the chain rejected: almost always a prover
    // that doesn't match the chain's release or proving key.
    return "The chain rejected the anonymous proof. This site's prover may not match the chain; please reload, and report it if it keeps happening.";
  }
  return log;
}

/**
 * Send `inner` anonymously. Its signer field must already be the shield module
 * address (see shieldModuleAddress). Resolves to the tx hash.
 */
export async function submitAnonymously(
  config: ChainConfig,
  identity: ShieldIdentity,
  inner: { typeUrl: string; value: Record<string, unknown> },
  onPhase?: (phase: ShieldPhase) => void,
  /** Prove at least this trust level, when the target asks for more than the
   *  op's registered minimum (e.g. a post's reply trust level). */
  minTrustLevel?: number,
): Promise<string> {
  onPhase?.("preparing");
  const reg = await anonymousOp(inner.typeUrl);
  if (!reg) throw new Error("This action can't be done anonymously right now.");
  const provenTrust = Math.max(reg.min_trust_level, minTrustLevel ?? 0);

  const registry = await shieldRegistry();
  const innerValue = registry.encode(inner);
  const wallet = await publicSubmitterWallet(config.bech32Prefix);
  const [account] = await wallet.getAccounts();
  const accountNumber = await getAccountNumber(account.address);
  if (accountNumber === null) throw new Error("Anonymous actions aren't available on this chain yet.");

  // A proof is bound to the shield epoch; if it rolls over while proving,
  // prove again rather than send something the chain will refuse.
  let proof: ShieldProof | null = null;
  for (let attempt = 0; attempt < 2 && !proof; attempt++) {
    const [epoch, tree] = await Promise.all([settledEpoch(), getTrustTree()]);
    if (!tree.root) throw new Error("The member trust tree isn't built yet.");
    onPhase?.("proving");
    const out: ShieldProof = await shieldCall<ShieldProof>(config, "prove", JSON.stringify({
      secret_key: identity.secretKey,
      root: tree.root,
      depth: tree.depth,
      leaves: tree.leaves,
      min_trust_level: provenTrust,
      // The chain hashes the nullifier domain into the proof's scope, so the
      // same raw scope in two operations never yields the same nullifier.
      domain: reg.nullifier_domain,
      scope: resolveScope(reg, inner.value, epoch),
      rate_limit_epoch: epoch,
      inner_type_url: inner.typeUrl,
      inner_value: toBase64(innerValue),
    }));
    const after = await getShieldEpoch();
    if (after.epoch_state.current_epoch === epoch) proof = out;
  }
  if (!proof) throw new Error("The anonymous proof expired before it could be sent. Please try again.");
  const p: ShieldProof = proof;

  onPhase?.("broadcasting");
  const exec = {
    typeUrl: MSG_SHIELDED_EXEC,
    value: {
      submitter: account.address,
      innerMessage: { typeUrl: inner.typeUrl, value: innerValue },
      proof: fromBase64(p.proof),
      nullifier: fromBase64(p.nullifier),
      rateLimitNullifier: fromBase64(p.rate_limit_nullifier),
      merkleRoot: fromBase64(p.merkle_root),
      proofDomain: PROOF_DOMAIN_TRUST_TREE,
      minTrustLevel: provenTrust,
      execMode: SHIELD_EXEC_IMMEDIATE,
      encryptedPayload: new Uint8Array(),
      targetEpoch: BigInt(0),
    },
  };

  // Unordered: every anonymous client shares this account, so sequence
  // numbers would collide. Fees are zero; the shield module pays.
  const bodyBytes = TxBody.encode(
    TxBody.fromPartial({
      messages: [registry.encodeAsAny(exec)],
      unordered: true,
      timeoutTimestamp: { seconds: BigInt(Math.floor(Date.now() / 1000) + UNORDERED_TIMEOUT_SECONDS), nanos: 0 },
    }),
  ).finish();
  const authInfoBytes = makeAuthInfoBytes(
    [{ pubkey: encodePubkey(encodeSecp256k1Pubkey(account.pubkey)), sequence: 0 }],
    [],
    SHIELDED_EXEC_GAS,
    undefined,
    undefined,
  );
  const signDoc = makeSignDoc(bodyBytes, authInfoBytes, config.chainId, Number(accountNumber));
  const { signed, signature } = await wallet.signDirect(account.address, signDoc);
  const txBytes = TxRaw.encode(
    TxRaw.fromPartial({
      bodyBytes: signed.bodyBytes,
      authInfoBytes: signed.authInfoBytes,
      signatures: [fromBase64(signature.signature)],
    }),
  ).finish();

  const client = await StargateClient.connect(config.rpcEndpoint);
  try {
    const res = await client.broadcastTx(txBytes, 60_000, 2_000);
    if (res.code !== 0) throw new Error(friendlyChainError(res.rawLog || `failed with code ${res.code}`));
    return res.transactionHash;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(friendlyChainError(msg));
  } finally {
    client.disconnect();
  }
}

/** Whether two base64 public keys are the same key. */
export function samePublicKey(a: string | undefined, b: string): boolean {
  if (!a) return false;
  try {
    return toHex(fromBase64(a)) === toHex(fromBase64(b));
  } catch {
    return false;
  }
}
