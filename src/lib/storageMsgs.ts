// Builders for the x/storage messages a member signs. The forms call these,
// and aminoSigning.test.ts signs what they build and has the chain verify it,
// so a form can never sign a shape the test did not cover.

import { StorageMsgTypeUrls } from "./tx";

export interface StorageMsg {
  typeUrl: string;
  value: Record<string, unknown>;
}

export function requestCopyMsg(a: {
  requester: string;
  backend: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  url: string;
  /** The most to pay in total, in base units: the quote's `total`. */
  maxFee: string;
}): StorageMsg {
  return {
    typeUrl: StorageMsgTypeUrls.RequestPermanentCopy,
    value: {
      requester: a.requester,
      backend: a.backend,
      sha256: a.sha256,
      sizeBytes: BigInt(a.sizeBytes),
      contentType: a.contentType,
      url: a.url,
      maxFee: a.maxFee,
    },
  };
}

export function addSourceMsg(member: string, requestId: string, url: string, maxFee: string): StorageMsg {
  return { typeUrl: StorageMsgTypeUrls.AddSource, value: { member, requestId: BigInt(requestId), url, maxFee } };
}

export function cancelRequestMsg(requester: string, requestId: string): StorageMsg {
  return { typeUrl: StorageMsgTypeUrls.CancelRequest, value: { requester, requestId: BigInt(requestId) } };
}

/** `maxFee` is "0" for the requester, who disputes for nothing. */
export function disputeCompletionMsg(member: string, requestId: string, maxFee: string): StorageMsg {
  return { typeUrl: StorageMsgTypeUrls.DisputeCompletion, value: { member, requestId: BigInt(requestId), maxFee } };
}
