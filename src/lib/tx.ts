// Transaction signing helpers using CosmJS + Keplr.

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
export function buildBlogMsg(typeUrl: string, value: Record<string, unknown>) {
  return { typeUrl, value };
}
