// What the storage operators have to pay for copies with: the Arweave wallets
// they declare on chain and each wallet's balance.
//
// A storage operator's x/service metadata is JSON,
// {"v":1,"backend":"arweave","wallets":["<arweave address>", ...]}
// (docs/x-storage-spec.md §8.1). The chain stores it and checks nothing in
// it, so a listed wallet is the operator's own statement. The balance is
// read from an Arweave node, which anyone can do for any address.

import { getServiceOperator } from "./api";
import { listApprovedOperators } from "./storageCouncilApi";
import { OperatorStatus } from "@/types/service";
import type { StorageBackend } from "@/types/storage";

const ARWEAVE_ADDRESS = /^[A-Za-z0-9_-]{43}$/;
const MAX_WALLETS = 5;
const TIMEOUT_MS = 15_000;

/** The Arweave wallets an operator's metadata (base64 JSON) declares for `backend`. */
export function operatorWallets(metadataBase64: string | undefined, backend: string): string[] {
  if (!metadataBase64) return [];
  let meta: unknown;
  try {
    meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(metadataBase64), (c) => c.charCodeAt(0))));
  } catch {
    return [];
  }
  if (!meta || typeof meta !== "object") return [];
  const m = meta as { v?: unknown; backend?: unknown; wallets?: unknown };
  if (m.v !== 1 || m.backend !== backend || !Array.isArray(m.wallets)) return [];
  const out: string[] = [];
  for (const w of m.wallets) {
    if (typeof w === "string" && ARWEAVE_ADDRESS.test(w) && !out.includes(w)) out.push(w);
    if (out.length === MAX_WALLETS) break;
  }
  return out;
}

/** The node behind a gateway template such as https://arweave.net/{id}. */
export function arweaveNodeOf(gatewayTemplate: string): string {
  try {
    return new URL(gatewayTemplate.replace("{id}", "x")).origin;
  } catch {
    return "https://arweave.net";
  }
}

const WINSTON_PER_AR = BigInt("1000000000000");

/** A winston amount as AR with up to four decimals ("0.0312"). */
export function formatAr(winston: string): string {
  if (!/^\d+$/.test(winston)) return "?";
  const w = BigInt(winston);
  const whole = w / WINSTON_PER_AR;
  const frac = ((w % WINSTON_PER_AR) / BigInt(100_000_000)).toString().padStart(4, "0").replace(/0+$/, "");
  if (whole === BigInt(0) && frac === "" && w > BigInt(0)) return "less than 0.0001";
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** How many copies of `price` winston each a balance pays for, or null when unknown. */
export function copiesAfforded(balance: string | null, price: string | null): number | null {
  if (!balance || !price || !/^\d+$/.test(balance) || !/^[1-9]\d*$/.test(price)) return null;
  const n = BigInt(balance) / BigInt(price);
  return n > BigInt(1_000_000) ? 1_000_000 : Number(n);
}

async function nodeNumber(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = res.ok ? (await res.text()).trim() : "";
    return /^\d+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

export interface OperatorWallet {
  address: string;
  /** Winston, or null when the node didn't answer. */
  balance: string | null;
}

export interface OperatorFunds {
  operator: string;
  wallets: OperatorWallet[];
}

export interface BackendFunds {
  /** Approved, active operators, with the wallets each declares (possibly none). */
  operators: OperatorFunds[];
  /** What the network charges now for a file of the asked size, in winston, or null. */
  price: string | null;
}

/**
 * The funds behind a backend's approved operators. Only operators whose
 * approval still counts and who are ACTIVE in x/service are listed, since
 * only they can take a request.
 */
export async function loadBackendFunds(backend: StorageBackend, node: string, sizeBytes?: number): Promise<BackendFunds> {
  const approved = (await listApprovedOperators(backend.name)).filter((a) => !a.stale);
  const operators: OperatorFunds[] = [];
  await Promise.all(
    approved.map(async (a) => {
      let wallets: string[] = [];
      try {
        const { operator } = await getServiceOperator(a.operator, backend.service_type);
        if (operator?.status !== OperatorStatus.ACTIVE) return;
        wallets = operatorWallets(operator.metadata, backend.name);
      } catch {
        return; // no longer an operator of this service type
      }
      operators.push({
        operator: a.operator,
        wallets: await Promise.all(
          wallets.map(async (address) => ({ address, balance: await nodeNumber(`${node}/wallet/${address}/balance`) }))
        ),
      });
    })
  );
  operators.sort((x, y) => x.operator.localeCompare(y.operator));
  const price = sizeBytes && sizeBytes > 0 ? await nodeNumber(`${node}/price/${sizeBytes}`) : null;
  return { operators, price };
}
