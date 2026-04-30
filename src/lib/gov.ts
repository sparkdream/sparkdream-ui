// Helpers shared across pages that submit governance proposals.

interface ModuleAccountResponse {
  account?: {
    base_account?: { address?: string };
  };
}

/**
 * Fetch the address of the cosmos-sdk `gov` module account. This is what
 * keepers compare against when a Msg has `option (cosmos.msg.v1.signer) =
 * "authority"` and the authority defaults to x/gov. Wrap any inner message
 * (e.g. MsgCancelMarket, MsgUpdateParams) inside a MsgSubmitProposal whose
 * inner messages carry this address as their `authority`.
 *
 * Returns "" on failure; callers should treat that as "let the chain fill it"
 * which usually means the inner-message validation will reject it. If the
 * call returned an address, use it; otherwise surface the network error.
 */
export async function getGovModuleAddress(): Promise<string> {
  const res = await fetch(`/api/lcd/cosmos/auth/v1beta1/module_accounts/gov`);
  if (!res.ok) throw new Error(`gov module address: ${res.status}`);
  const data = (await res.json()) as ModuleAccountResponse;
  const addr = data.account?.base_account?.address;
  if (!addr) throw new Error("gov module address: missing in response");
  return addr;
}
