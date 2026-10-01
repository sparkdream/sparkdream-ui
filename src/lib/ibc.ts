import { fromBech32 } from "@cosmjs/encoding";
import { getIbcChannelClientState, getIbcClientStatus, listIbcChannels } from "@/lib/api";

/** A chain this one can send tokens to: an open ICS-20 channel and the light
 *  client that tracks the chain at its other end. */
export interface TransferRoute {
  /** This chain's end, the MsgTransfer source_channel. */
  channelId: string;
  /** The other chain's end; names the voucher denom minted there. */
  counterpartyChannelId: string;
  clientId: string;
  /** The other chain's id, from its light client. Empty when the client type
   *  does not carry one. */
  chainId: string;
  /** Light client status. Only "Active" can deliver a transfer: on an expired
   *  client the packet can neither arrive nor time out until it is revived. */
  status: string;
}

/**
 * Every chain a relayer links to this one, read from the chain itself: open
 * channels on the transfer port, each with its light client's chain id and
 * status. Nothing to configure: a channel opened by a new relayer path shows
 * up here on its own.
 */
export async function listTransferRoutes(): Promise<TransferRoute[]> {
  const { channels } = await listIbcChannels({ limit: "200" });
  const open = (channels || []).filter((c) => c.port_id === "transfer" && c.state === "STATE_OPEN");
  return Promise.all(
    open.map(async (c) => {
      let clientId = "";
      let chainId = "";
      let status = "Unknown";
      try {
        const { identified_client_state: ics } = await getIbcChannelClientState("transfer", c.channel_id);
        clientId = ics.client_id;
        chainId = ics.client_state.chain_id ?? "";
      } catch {
        // leave the route listed but unusable: status stays Unknown
      }
      if (clientId) {
        try {
          status = (await getIbcClientStatus(clientId)).status;
        } catch {
          // status stays Unknown
        }
      }
      return {
        channelId: c.channel_id,
        counterpartyChannelId: c.counterparty.channel_id,
        clientId,
        chainId,
        status,
      };
    })
  );
}

/**
 * The denom a token arrives as on the other chain: ICS-20 mints a voucher
 * named ibc/ + SHA-256 of "<port>/<channel on the receiving side>/<denom>".
 * Shown so the user can recognize it in the destination wallet.
 */
export async function voucherDenom(counterpartyChannelId: string, baseDenom: string): Promise<string> {
  const bytes = new TextEncoder().encode(`transfer/${counterpartyChannelId}/${baseDenom}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `ibc/${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Timeout for a transfer: if no relayer delivers it by then, the packet
 *  times out and the tokens come back. In nanoseconds since the epoch. */
export function transferTimeoutNs(minutes = 10): bigint {
  return BigInt(Date.now() + minutes * 60_000) * BigInt(1_000_000);
}

/**
 * Why `address` cannot receive on the destination, or null when it can: a
 * valid bech32 address, with the destination's prefix when it is known, and
 * never one of this chain's own (a typo the transfer would carry off chain).
 */
export function recipientProblem(address: string, ownPrefix: string, destPrefix?: string): string | null {
  const value = address.trim();
  if (!value) return "Enter the recipient's address on the destination chain";
  let prefix: string;
  try {
    prefix = fromBech32(value).prefix;
  } catch {
    return "Not a valid address";
  }
  if (prefix === ownPrefix) return `That is an address on this chain; enter one on the destination chain`;
  if (destPrefix && prefix !== destPrefix) return `Addresses on this chain start with ${destPrefix}1`;
  return null;
}

export interface DestinationChain {
  chainName: string;
  bech32Prefix?: string;
}

/** What Keplr knows about a chain (its display name and address prefix), or
 *  null when Keplr is missing or does not know it. */
export async function keplrDestination(chainId: string): Promise<DestinationChain | null> {
  if (typeof window === "undefined" || !window.keplr?.getChainInfosWithoutEndpoints) return null;
  try {
    const infos = await window.keplr.getChainInfosWithoutEndpoints();
    const info = infos.find((i) => i.chainId === chainId);
    return info ? { chainName: info.chainName, bech32Prefix: info.bech32Config?.bech32PrefixAccAddr } : null;
  } catch {
    return null;
  }
}

/** The user's own address on the destination, from Keplr (asks the user to
 *  allow the chain the first time). */
export async function keplrAddressOn(chainId: string): Promise<string> {
  if (typeof window === "undefined" || !window.keplr) throw new Error("Keplr is not available");
  await window.keplr.enable(chainId);
  return (await window.keplr.getKey(chainId)).bech32Address;
}
