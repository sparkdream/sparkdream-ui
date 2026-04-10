// Chain configuration — defaults are used for SSR and as fallback.
// At runtime the client fetches /api/config for the actual values.

export interface ChainConfig {
  chainId: string;
  chainName: string;
  lcdEndpoint: string;
  rpcEndpoint: string;
  denom: string;
  displayDenom: string;
  bech32Prefix: string;
}

export const defaults: ChainConfig = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID || "sparkdream-test-1",
  chainName: process.env.NEXT_PUBLIC_CHAIN_NAME || "Spark Dream",
  lcdEndpoint: process.env.NEXT_PUBLIC_LCD_ENDPOINT || "https://api-test.sparkdream.io",
  rpcEndpoint: process.env.NEXT_PUBLIC_RPC_ENDPOINT || "https://rpc-test.sparkdream.io",
  denom: process.env.NEXT_PUBLIC_DENOM || "uspark",
  displayDenom: process.env.NEXT_PUBLIC_DISPLAY_DENOM || "SPARK",
  bech32Prefix: process.env.NEXT_PUBLIC_BECH32_PREFIX || "sprkdrm",
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
