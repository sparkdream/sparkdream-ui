/**
 * Amino converters for x/artifact messages whose generated converters do not
 * match the chain's aminojson. Spread after the package's artifact map in
 * WalletContext so these win.
 *
 * Every rule below was checked against cosmossdk.io/x/tx/signing/aminojson
 * itself (the chain's encoder rendering proto bytes of each message, empty
 * and populated), not read off the protos. The package (0.0.44) gets three
 * things wrong:
 *
 * 1. Plain repeated fields (minters, royalty_recipients, update_mask, add,
 *    remove, token_ids, allowed_uri_schemes) are tested for truthiness, and
 *    `[]` is truthy, so an empty list signs `"minters": []` where the chain
 *    omits the key.
 * 2. Repeated fields marked `(amino.dont_omitempty)` (entries, refs,
 *    TokenMetadata.attributes) render as `null` when empty, not `[]`. The
 *    package signs `[]`, and an empty attributes list is the ordinary case,
 *    so nearly every mint and token update failed sigverify.
 * 3. A Coin's `amount` is a cosmos.Int, which the chain renders as "0" when
 *    empty; the package signs "". A Coin field that is absent from the proto
 *    bytes (MintPolicy.price left unset) makes the chain's encoder refuse the
 *    tx outright, so the converters below always emit the coin, and
 *    fromAmino then writes it into the body.
 *
 * Callers must pass uint64/int64 fields as BigInt. The shadows below coerce
 * Numbers, but the converters left to the package (MsgSetMaxSupply,
 * MsgHideContent, ...) test `!== BigInt(0)`, so a Number 0 there signs a key
 * the chain never emits. Enums (ReceivePolicy, HideTargetKind,
 * BurnAuthorization, ModerationReason) are plain ints and omitted at 0.
 *
 * The other converters (no repeated fields, no Coin) already match and are
 * not shadowed. MsgUpdateOperationalParams matches too: its cosmos.Int
 * fields are plain strings omitted when empty.
 */
import {
  MsgUpdateParams,
  MsgCreateClass,
  MsgUpdateClass,
  MsgSetMintPolicy,
  MsgSetMinters,
  MsgMint,
  MsgPublicMint,
  MsgTransfer,
  MsgAcceptIncoming,
  MsgRejectIncoming,
  MsgCancelOutgoing,
  MsgBurn,
  MsgRevoke,
  MsgUpdateToken,
  MsgFreezeTokenMetadata,
  MsgList,
  MsgUpdateListing,
  MsgBuy,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";

/* eslint-disable @typescript-eslint/no-explicit-any */

const str = (s: any) => (s === "" || s == null ? undefined : s);
const num = (n: any) => (n === 0 || n == null ? undefined : n);
const bool = (b: any) => (b === true ? true : undefined);
// uint64/int64: decimal string, omitted at zero.
const int64 = (x: any) => (x == null || BigInt(x) === BigInt(0) ? undefined : BigInt(x).toString());
// Plain repeated field: omitted when empty.
const list = (xs: any, f: (e: any) => any = (e) => e) => ((xs?.length ?? 0) > 0 ? xs.map(f) : undefined);
// dont_omitempty repeated field: the chain renders an empty one as null.
const keptList = (xs: any, f: (e: any) => any = (e) => e) => ((xs?.length ?? 0) > 0 ? xs.map(f) : null);

// Non-nullable, dont_omitempty Coin: always present, empty amount is "0".
const coin = (c: any) => ({ denom: str(c?.denom), amount: c?.amount ? c.amount : "0" });

const classFlags = (f: any) => ({
  transferable: bool(f?.transferable),
  burn_authorization: num(f?.burnAuthorization),
  token_metadata_mutable: bool(f?.tokenMetadataMutable),
});

const mintPolicy = (p: any) => ({
  public_mint_enabled: bool(p?.publicMintEnabled),
  price: coin(p?.price),
  start_time: int64(p?.startTime),
  end_time: int64(p?.endTime),
  per_address_limit: num(p?.perAddressLimit),
});

const royaltyShare = (r: any) => ({ address: str(r?.address), weight_bps: num(r?.weightBps) });

const tokenMetadata = (m: any) => ({
  name: str(m?.name),
  description: str(m?.description),
  uri: str(m?.uri),
  uri_hash: str(m?.uriHash),
  attributes: keptList(m?.attributes, (a: any) => ({ key: str(a?.key), value: str(a?.value) })),
});

const tokenRef = (r: any) => ({ class_id: int64(r?.classId), token_id: int64(r?.tokenId) });

// Params.allowed_uri_schemes is the one repeated field in the params, and a
// params proposal decoded from bytes (nested-amino) always carries it as [].
const params = (p: any) => ({
  min_trust_level_create_class: num(p?.minTrustLevelCreateClass),
  max_classes_per_creator: num(p?.maxClassesPerCreator),
  default_receive_policy: num(p?.defaultReceivePolicy),
  max_name_length: num(p?.maxNameLength),
  max_symbol_length: num(p?.maxSymbolLength),
  max_description_length: num(p?.maxDescriptionLength),
  max_uri_length: num(p?.maxUriLength),
  max_attributes: num(p?.maxAttributes),
  max_attribute_key_length: num(p?.maxAttributeKeyLength),
  max_attribute_value_length: num(p?.maxAttributeValueLength),
  max_minters_per_class: num(p?.maxMintersPerClass),
  max_batch_size: num(p?.maxBatchSize),
  allowed_uri_schemes: list(p?.allowedUriSchemes),
  max_royalty_bps: num(p?.maxRoyaltyBps),
  sale_fee_bps: num(p?.saleFeeBps),
  class_creation_fee: str(p?.classCreationFee),
  token_deposit: str(p?.tokenDeposit),
  inbox_fee: str(p?.inboxFee),
  pending_ttl: int64(p?.pendingTtl),
  max_listing_duration: int64(p?.maxListingDuration),
  max_pending_per_pair: num(p?.maxPendingPerPair),
  max_inbox_per_recipient: num(p?.maxInboxPerRecipient),
  max_expirations_per_block: num(p?.maxExpirationsPerBlock),
  market_enabled: bool(p?.marketEnabled),
  public_mint_enabled: bool(p?.publicMintEnabled),
  max_hides_per_sentinel_per_day: num(p?.maxHidesPerSentinelPerDay),
  sentinel_unhide_window_blocks: int64(p?.sentinelUnhideWindowBlocks),
  hide_expiry_blocks: int64(p?.hideExpiryBlocks),
  sentinel_hide_commit_dream: str(p?.sentinelHideCommitDream),
});

// Messages whose only problem is a dont_omitempty `refs` list.
const refsConverter = (aminoType: string, signerKey: string, signerField: string, fromAmino: any) => ({
  aminoType,
  toAmino: (m: any) => ({ [signerKey]: str(m[signerField]), refs: keptList(m.refs, tokenRef) }),
  fromAmino,
});

// MsgList and MsgUpdateListing share a shape; only the Coin differs from the
// package output.
const listingConverter = (aminoType: string, fromAmino: any) => ({
  aminoType,
  toAmino: (m: any) => ({
    seller: str(m.seller),
    class_id: int64(m.classId),
    token_id: int64(m.tokenId),
    price: coin(m.price),
    duration: int64(m.duration),
  }),
  fromAmino,
});

const T = "sparkdream/x/artifact/";

export const artifactAminoOverrides = {
  "/sparkdream.artifact.v1.MsgUpdateParams": {
    aminoType: T + "MsgUpdateParams",
    toAmino: (m: any) => ({ authority: str(m.authority), params: params(m.params) }),
    fromAmino: MsgUpdateParams.fromAmino,
  },
  // royalty_recipients and minters are plain lists (trap 1); mint_policy
  // carries a Coin (trap 3).
  "/sparkdream.artifact.v1.MsgCreateClass": {
    aminoType: T + "MsgCreateClass",
    toAmino: (m: any) => ({
      creator: str(m.creator),
      name: str(m.name),
      symbol: str(m.symbol),
      description: str(m.description),
      uri: str(m.uri),
      uri_hash: str(m.uriHash),
      token_uri_base: str(m.tokenUriBase),
      flags: classFlags(m.flags),
      max_supply: int64(m.maxSupply),
      mint_policy: mintPolicy(m.mintPolicy),
      payout_address: str(m.payoutAddress),
      royalty_bps: num(m.royaltyBps),
      royalty_recipients: list(m.royaltyRecipients, royaltyShare),
      minters: list(m.minters),
      accepted_content_license: str(m.acceptedContentLicense),
    }),
    fromAmino: MsgCreateClass.fromAmino,
  },
  // royalty_recipients and update_mask are plain lists (trap 1).
  "/sparkdream.artifact.v1.MsgUpdateClass": {
    aminoType: T + "MsgUpdateClass",
    toAmino: (m: any) => ({
      owner: str(m.owner),
      class_id: int64(m.classId),
      name: str(m.name),
      description: str(m.description),
      uri: str(m.uri),
      uri_hash: str(m.uriHash),
      token_uri_base: str(m.tokenUriBase),
      payout_address: str(m.payoutAddress),
      royalty_recipients: list(m.royaltyRecipients, royaltyShare),
      royalty_bps: num(m.royaltyBps),
      update_mask: list(m.updateMask),
    }),
    fromAmino: MsgUpdateClass.fromAmino,
  },
  // MintPolicy.price (trap 3).
  "/sparkdream.artifact.v1.MsgSetMintPolicy": {
    aminoType: T + "MsgSetMintPolicy",
    toAmino: (m: any) => ({ owner: str(m.owner), class_id: int64(m.classId), mint_policy: mintPolicy(m.mintPolicy) }),
    fromAmino: MsgSetMintPolicy.fromAmino,
  },
  // add and remove are plain lists, and one of them is always empty (trap 1).
  "/sparkdream.artifact.v1.MsgSetMinters": {
    aminoType: T + "MsgSetMinters",
    toAmino: (m: any) => ({ owner: str(m.owner), class_id: int64(m.classId), add: list(m.add), remove: list(m.remove) }),
    fromAmino: MsgSetMinters.fromAmino,
  },
  // entries and each entry's metadata.attributes are dont_omitempty (trap 2).
  "/sparkdream.artifact.v1.MsgMint": {
    aminoType: T + "MsgMint",
    toAmino: (m: any) => ({
      minter: str(m.minter),
      class_id: int64(m.classId),
      entries: keptList(m.entries, (e: any) => ({ recipient: str(e?.recipient), metadata: tokenMetadata(e?.metadata) })),
      accepted_content_license: str(m.acceptedContentLicense),
    }),
    fromAmino: MsgMint.fromAmino,
  },
  // max_price (trap 3).
  "/sparkdream.artifact.v1.MsgPublicMint": {
    aminoType: T + "MsgPublicMint",
    toAmino: (m: any) => ({
      buyer: str(m.buyer),
      class_id: int64(m.classId),
      quantity: num(m.quantity),
      max_price: coin(m.maxPrice),
    }),
    fromAmino: MsgPublicMint.fromAmino,
  },
  // entries is dont_omitempty (trap 2).
  "/sparkdream.artifact.v1.MsgTransfer": {
    aminoType: T + "MsgTransfer",
    toAmino: (m: any) => ({
      sender: str(m.sender),
      entries: keptList(m.entries, (e: any) => ({
        class_id: int64(e?.classId),
        token_id: int64(e?.tokenId),
        recipient: str(e?.recipient),
      })),
    }),
    fromAmino: MsgTransfer.fromAmino,
  },
  // entries is dont_omitempty (trap 2).
  "/sparkdream.artifact.v1.MsgAcceptIncoming": {
    aminoType: T + "MsgAcceptIncoming",
    toAmino: (m: any) => ({
      recipient: str(m.recipient),
      entries: keptList(m.entries, (e: any) => ({
        class_id: int64(e?.classId),
        token_id: int64(e?.tokenId),
        expected_metadata_hash: str(e?.expectedMetadataHash),
      })),
    }),
    fromAmino: MsgAcceptIncoming.fromAmino,
  },
  // refs is dont_omitempty (trap 2) on these four.
  "/sparkdream.artifact.v1.MsgRejectIncoming": refsConverter(T + "MsgRejectIncoming", "recipient", "recipient", MsgRejectIncoming.fromAmino),
  "/sparkdream.artifact.v1.MsgCancelOutgoing": refsConverter(T + "MsgCancelOutgoing", "signer", "signer", MsgCancelOutgoing.fromAmino),
  "/sparkdream.artifact.v1.MsgBurn": refsConverter(T + "MsgBurn", "owner", "owner", MsgBurn.fromAmino),
  "/sparkdream.artifact.v1.MsgFreezeTokenMetadata": refsConverter(T + "MsgFreezeTokenMetadata", "signer", "signer", MsgFreezeTokenMetadata.fromAmino),
  // token_ids is a plain list (trap 1). A zero id inside a non-empty list is
  // kept as "0"; only zero scalars are omitted.
  "/sparkdream.artifact.v1.MsgRevoke": {
    aminoType: T + "MsgRevoke",
    toAmino: (m: any) => ({
      owner: str(m.owner),
      class_id: int64(m.classId),
      token_ids: list(m.tokenIds, (id: any) => BigInt(id).toString()),
      reason: str(m.reason),
    }),
    fromAmino: MsgRevoke.fromAmino,
  },
  // metadata.attributes is dont_omitempty (trap 2).
  "/sparkdream.artifact.v1.MsgUpdateToken": {
    aminoType: T + "MsgUpdateToken",
    toAmino: (m: any) => ({
      owner: str(m.owner),
      class_id: int64(m.classId),
      token_id: int64(m.tokenId),
      metadata: tokenMetadata(m.metadata),
    }),
    fromAmino: MsgUpdateToken.fromAmino,
  },
  // price / expected_price (trap 3).
  "/sparkdream.artifact.v1.MsgList": listingConverter(T + "MsgList", MsgList.fromAmino),
  "/sparkdream.artifact.v1.MsgUpdateListing": listingConverter(T + "MsgUpdateListing", MsgUpdateListing.fromAmino),
  "/sparkdream.artifact.v1.MsgBuy": {
    aminoType: T + "MsgBuy",
    toAmino: (m: any) => ({
      buyer: str(m.buyer),
      class_id: int64(m.classId),
      token_id: int64(m.tokenId),
      expected_price: coin(m.expectedPrice),
      expected_nonce: int64(m.expectedNonce),
      expected_metadata_hash: str(m.expectedMetadataHash),
    }),
    fromAmino: MsgBuy.fromAmino,
  },
};
