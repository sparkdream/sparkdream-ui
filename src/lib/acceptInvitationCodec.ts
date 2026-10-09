import { BinaryReader, BinaryWriter } from "@sparkdreamnft/sparkdreamjs/binary";

/**
 * MsgAcceptInvitation with the chain's `accepted_content_license` field
 * (field 3): joining is agreeing that everything the member publishes is
 * dedicated to the public domain, and the chain refuses an acceptance whose
 * value is not "CC0-1.0" (x/rep error 1208).
 *
 * The published sparkdreamjs predates the field, so its codec drops it from
 * both the protobuf body and the amino sign doc. This local codec and
 * converter replace the package's for this one message (registered after
 * `loadRep`, spread after `repAmino` in WalletContext). Drop both once a
 * sparkdreamjs release regenerated from the current rep/v1/tx.proto ships the
 * field, after checking its converter emits the same keys as below.
 */
export const ACCEPT_INVITATION_TYPE_URL = "/sparkdream.rep.v1.MsgAcceptInvitation";

export interface AcceptInvitationValue {
  invitee: string;
  invitationId: bigint;
  acceptedContentLicense: string;
}

export const AcceptInvitationCodec = {
  typeUrl: ACCEPT_INVITATION_TYPE_URL,
  encode(message: AcceptInvitationValue, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.invitee !== "") {
      writer.uint32(10).string(message.invitee);
    }
    if (message.invitationId !== BigInt(0)) {
      writer.uint32(16).uint64(message.invitationId);
    }
    if (message.acceptedContentLicense !== "") {
      writer.uint32(26).string(message.acceptedContentLicense);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): AcceptInvitationValue {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: AcceptInvitationValue = { invitee: "", invitationId: BigInt(0), acceptedContentLicense: "" };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.invitee = reader.string();
          break;
        case 2:
          message.invitationId = reader.uint64();
          break;
        case 3:
          message.acceptedContentLicense = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
      }
    }
    return message;
  },
  fromPartial(object: Partial<{ invitee: string; invitationId: bigint | number | string; acceptedContentLicense: string }>): AcceptInvitationValue {
    return {
      invitee: object.invitee ?? "",
      invitationId: object.invitationId !== undefined && object.invitationId !== null ? BigInt(object.invitationId.toString()) : BigInt(0),
      acceptedContentLicense: object.acceptedContentLicense ?? "",
    };
  },
};

/**
 * Amino converter matching the chain's aminojson: scalar fields are omitted
 * when zero, uint64 is a string.
 */
export const acceptInvitationAmino = {
  [ACCEPT_INVITATION_TYPE_URL]: {
    aminoType: "sparkdream/x/rep/MsgAcceptInvitation",
    toAmino: (message: AcceptInvitationValue) => ({
      invitee: message.invitee === "" ? undefined : message.invitee,
      invitation_id: message.invitationId !== BigInt(0) ? message.invitationId.toString() : undefined,
      accepted_content_license: message.acceptedContentLicense === "" ? undefined : message.acceptedContentLicense,
    }),
    fromAmino: (object: { invitee?: string; invitation_id?: string; accepted_content_license?: string }): AcceptInvitationValue => ({
      invitee: object.invitee ?? "",
      invitationId: object.invitation_id ? BigInt(object.invitation_id) : BigInt(0),
      acceptedContentLicense: object.accepted_content_license ?? "",
    }),
  },
};
