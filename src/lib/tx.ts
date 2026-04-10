// Transaction signing helpers using CosmJS + Keplr.

import { SigningStargateClient } from "@cosmjs/stargate";
import { Registry } from "@cosmjs/proto-signing";
import { RPC_ENDPOINT, DENOM } from "./chain";

// Default fee for blog transactions
export function defaultFee(gas: string = "200000") {
  return {
    amount: [{ denom: DENOM, amount: "5000" }],
    gas,
  };
}

// Get a signing client connected to the chain via Keplr
export async function getSigningClient(
  offlineSigner: ReturnType<typeof window.keplr.getOfflineSigner>
): Promise<SigningStargateClient> {
  const client = await SigningStargateClient.connectWithSigner(
    RPC_ENDPOINT,
    await offlineSigner,
    { registry: new Registry() }
  );
  return client;
}

// Commons transaction message type URLs
export const CommonsMsgTypeUrls = {
  SubmitProposal: "/sparkdream.commons.v1.MsgSubmitProposal",
  VoteProposal: "/sparkdream.commons.v1.MsgVoteProposal",
  ExecuteProposal: "/sparkdream.commons.v1.MsgExecuteProposal",
  UpdateGroupMembers: "/sparkdream.commons.v1.MsgUpdateGroupMembers",
} as const;

// Session transaction message type URLs
export const SessionMsgTypeUrls = {
  CreateSession: "/sparkdream.session.v1.MsgCreateSession",
  RevokeSession: "/sparkdream.session.v1.MsgRevokeSession",
  ExecSession: "/sparkdream.session.v1.MsgExecSession",
} as const;

// Blog transaction message type URLs
export const MsgTypeUrls = {
  CreatePost: "/sparkdream.blog.v1.MsgCreatePost",
  UpdatePost: "/sparkdream.blog.v1.MsgUpdatePost",
  DeletePost: "/sparkdream.blog.v1.MsgDeletePost",
  HidePost: "/sparkdream.blog.v1.MsgHidePost",
  UnhidePost: "/sparkdream.blog.v1.MsgUnhidePost",
  CreateReply: "/sparkdream.blog.v1.MsgCreateReply",
  UpdateReply: "/sparkdream.blog.v1.MsgUpdateReply",
  DeleteReply: "/sparkdream.blog.v1.MsgDeleteReply",
  HideReply: "/sparkdream.blog.v1.MsgHideReply",
  UnhideReply: "/sparkdream.blog.v1.MsgUnhideReply",
  React: "/sparkdream.blog.v1.MsgReact",
  RemoveReaction: "/sparkdream.blog.v1.MsgRemoveReaction",
  PinPost: "/sparkdream.blog.v1.MsgPinPost",
  PinReply: "/sparkdream.blog.v1.MsgPinReply",
} as const;

// Build a blog message for signing.
// Since these are custom module messages not in the default registry,
// we use amino signing via Keplr's signAndBroadcast.
export function buildBlogMsg(typeUrl: string, value: Record<string, unknown>) {
  return { typeUrl, value };
}
