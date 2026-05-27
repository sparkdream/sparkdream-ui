// x/identity module types. Added in chain commit efcf392 as the immutable
// single source of truth for a federated chain's identity (denoms, symbols,
// founding date). Genesis-only: no Msg path of any kind, since gov upgrades
// can't be allowed to rename tokens post-launch.

export interface ChainIdentity {
  chain_human_name: string;
  chain_ticker_prefix: string;
  // SPARK
  bond_denom: string;
  bond_display_symbol: string;
  bond_display_name: string;
  bond_display_decimals: number;
  // DREAM
  dream_denom: string;
  dream_display_symbol: string;
  dream_display_name: string;
  dream_display_decimals: number;
  // unix seconds
  founded_at: string;
}

export interface QueryChainIdentityResponse {
  identity: ChainIdentity;
}

export interface QueryBondDenomResponse {
  denom: string;
}

export interface QueryDreamDenomResponse {
  denom: string;
}
