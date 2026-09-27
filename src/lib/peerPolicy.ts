// Composing MsgUpdatePeerPolicy, and Operations Committee proposals in general.
//
// MsgUpdatePeerPolicy REPLACES the peer's policy whole. Any field the caller
// leaves out is cleared on chain, and since allowed_identities is
// default-deny, clearing it silently stops every bridged author. So every
// update here starts from the policy on chain and applies edits on top:
// the policy form edits most fields, the curation panel only `curation`, and
// both carry the rest over unchanged.
//
// Seeding goes through the generated PeerPolicy.fromAmino, which reads the
// LCD's snake_case JSON directly (uint64 strings, a nested `curation`
// object, no enums to trip over). That way a field this UI has no control
// for yet still round-trips, as long as the sparkdreamjs build knows it. The
// amino-JSON shadow for MsgUpdatePeerPolicy in WalletContext has to list it
// too, or Ledger signing fails.

import type { PeerPolicy as PeerPolicyMsg } from "@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/types";
import { CommonsMsgTypeUrls, FederationMsgTypeUrls } from "@/lib/tx";
import type { PeerPolicy } from "@/types/federation";

export type { PeerPolicyMsg };

export type EncodeObject = { typeUrl: string; value: unknown };

/** Direct: sign as the connected Ops Committee member. Vote: propose to the committee. */
export type SubmitRoute =
  | { kind: "direct" }
  | { kind: "vote"; policyAddress: string };

/** A proposal to `policyAddress` carrying already-encoded inner messages. */
export function committeeProposal(
  proposer: string,
  policyAddress: string,
  messages: { typeUrl: string; value: Uint8Array }[],
  metadata: string
): EncodeObject {
  return {
    typeUrl: CommonsMsgTypeUrls.SubmitProposal,
    value: { proposer, policyAddress, messages, metadata },
  };
}

/** The on-chain policy as a generated message, ready for edits. */
export async function policyFromChain(
  peerId: string,
  chain: PeerPolicy | null | undefined
): Promise<PeerPolicyMsg> {
  const { PeerPolicy: Codec } = await import(
    "@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/types"
  );
  // An LCD response is the amino shape for this message: snake_case keys,
  // uint64 as decimal strings, the unset `curation` as null.
  const base = chain
    ? Codec.fromAmino(chain as unknown as Parameters<typeof Codec.fromAmino>[0])
    : Codec.fromPartial({});
  return { ...base, peerId };
}

/**
 * The messages to broadcast for a policy update: the plain message when
 * signing directly, or an Operations Committee proposal wrapping its encoded
 * bytes. `policy` must be the whole policy (see policyFromChain).
 */
export async function peerPolicyUpdateMsgs(opts: {
  address: string;
  route: SubmitRoute;
  peerId: string;
  policy: PeerPolicyMsg;
  metadata: string;
}): Promise<EncodeObject[]> {
  const { address, route, peerId, policy, metadata } = opts;
  const { MsgUpdatePeerPolicy } = await import(
    "@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/tx"
  );
  const authority = route.kind === "direct" ? address : route.policyAddress;
  // See PeerProposalForm: the proposal path needs encoded bytes, the direct
  // path needs the plain object. Sending the bytes directly yields an
  // all-empty message and "empty address string is not allowed" on the
  // authority. fromPartial also coerces the uint64s to BigInt, which the
  // amino converter's `!== BigInt(0)` omission test depends on.
  const msg = MsgUpdatePeerPolicy.fromPartial({
    authority,
    peerId,
    policy: { ...policy, peerId },
  });
  if (route.kind === "direct") {
    return [{ typeUrl: FederationMsgTypeUrls.UpdatePeerPolicy, value: msg }];
  }
  return [
    committeeProposal(
      address,
      route.policyAddress,
      [
        {
          typeUrl: FederationMsgTypeUrls.UpdatePeerPolicy,
          value: MsgUpdatePeerPolicy.encode(msg).finish(),
        },
      ],
      metadata
    ),
  ];
}

/** The curation collection id as a string, or null when unset. */
export function curationId(policy: PeerPolicy | null | undefined): string | null {
  if (!policy?.curation) return null;
  // A zero uint64 may be dropped by the encoder; the object's presence is
  // what says curation is set, and collection 0 is a real collection.
  return policy.curation.collection_id ?? "0";
}
