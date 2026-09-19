// Chain configuration — defaults are used for SSR and as fallback.
// At runtime the client fetches /api/config for the actual values
// (which read non-NEXT_PUBLIC_* server env vars, see api/config/route.ts).

export interface ChainConfig {
  chainId: string;
  chainName: string;
  lcdEndpoint: string;
  rpcEndpoint: string;
  explorerUrl: string;
  denom: string;
  displayDenom: string;
  // Display ticker of the internal DREAM token, which is per-chain like
  // SPARK itself (e.g. "DRMZ" on sparkdream-dev-1). UI copy that names the
  // internal token should use this instead of hardcoding "DREAM".
  dreamDisplayDenom: string;
  bech32Prefix: string;
  remoteManifestUrl: string;
  /**
   * Development-only. Federation peer actions are signed directly by the
   * connected wallet instead of being wrapped in a Commons Council proposal.
   * See lib/devFlags for why the chain permits it and why it must stay off
   * on any shared network.
   */
  directCouncilSigning: boolean;
}

export const defaults: ChainConfig = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID || "sparkdream-test-1",
  chainName: process.env.NEXT_PUBLIC_CHAIN_NAME || "Spark Dream",
  lcdEndpoint: process.env.NEXT_PUBLIC_LCD_ENDPOINT || "https://api-test.sparkdream.io",
  rpcEndpoint: process.env.NEXT_PUBLIC_RPC_ENDPOINT || "https://rpc-test.sparkdream.io",
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL || "https://explorer-testnet.sparkdream.io/sparkdream",
  denom: process.env.NEXT_PUBLIC_DENOM || "uspark.sparkdreamtest",
  displayDenom: process.env.NEXT_PUBLIC_DISPLAY_DENOM || "SPARK",
  dreamDisplayDenom: process.env.NEXT_PUBLIC_DREAM_DISPLAY_DENOM || "DREAM",
  bech32Prefix: process.env.NEXT_PUBLIC_BECH32_PREFIX || "sprkdrm",
  remoteManifestUrl: process.env.NEXT_PUBLIC_REMOTE_MANIFEST_URL || "",
  directCouncilSigning: process.env.NEXT_PUBLIC_DIRECT_COUNCIL_SIGNING === "1",
};

export function buildChainInfo(c: ChainConfig) {
  return {
    chainId: c.chainId,
    chainName: c.chainName,
    rpc: c.rpcEndpoint,
    rest: c.lcdEndpoint,
    bip44: { coinType: 118 },
    bech32Config: {
      bech32PrefixAccAddr: c.bech32Prefix,
      bech32PrefixAccPub: `${c.bech32Prefix}pub`,
      bech32PrefixValAddr: `${c.bech32Prefix}valoper`,
      bech32PrefixValPub: `${c.bech32Prefix}valoperpub`,
      bech32PrefixConsAddr: `${c.bech32Prefix}valcons`,
      bech32PrefixConsPub: `${c.bech32Prefix}valconspub`,
    },
    currencies: [
      {
        coinDenom: c.displayDenom,
        coinMinimalDenom: c.denom,
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: c.displayDenom,
        coinMinimalDenom: c.denom,
        coinDecimals: 6,
        gasPriceStep: { low: 0.01, average: 0.025, high: 0.04 },
      },
    ],
    stakeCurrency: {
      coinDenom: c.displayDenom,
      coinMinimalDenom: c.denom,
      coinDecimals: 6,
    },
  };
}
