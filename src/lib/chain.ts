// Keplr chain suggestion configuration for Spark Dream

export const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID || "sparkdream-test-1";
export const LCD_ENDPOINT = process.env.NEXT_PUBLIC_LCD_ENDPOINT || "https://api-test.sparkdream.io";
export const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC_ENDPOINT || "https://rpc-test.sparkdream.io";
export const DENOM = process.env.NEXT_PUBLIC_DENOM || "uspark";
export const DISPLAY_DENOM = process.env.NEXT_PUBLIC_DISPLAY_DENOM || "SPARK";
export const BECH32_PREFIX = process.env.NEXT_PUBLIC_BECH32_PREFIX || "sprkdrm";

export const chainInfo = {
  chainId: CHAIN_ID,
  chainName: process.env.NEXT_PUBLIC_CHAIN_NAME || "Spark Dream",
  rpc: RPC_ENDPOINT,
  rest: LCD_ENDPOINT,
  bip44: {
    coinType: 118,
  },
  bech32Config: {
    bech32PrefixAccAddr: BECH32_PREFIX,
    bech32PrefixAccPub: `${BECH32_PREFIX}pub`,
    bech32PrefixValAddr: `${BECH32_PREFIX}valoper`,
    bech32PrefixValPub: `${BECH32_PREFIX}valoperpub`,
    bech32PrefixConsAddr: `${BECH32_PREFIX}valcons`,
    bech32PrefixConsPub: `${BECH32_PREFIX}valconspub`,
  },
  currencies: [
    {
      coinDenom: DISPLAY_DENOM,
      coinMinimalDenom: DENOM,
      coinDecimals: 6,
    },
  ],
  feeCurrencies: [
    {
      coinDenom: DISPLAY_DENOM,
      coinMinimalDenom: DENOM,
      coinDecimals: 6,
      gasPriceStep: {
        low: 0.01,
        average: 0.025,
        high: 0.04,
      },
    },
  ],
  stakeCurrency: {
    coinDenom: DISPLAY_DENOM,
    coinMinimalDenom: DENOM,
    coinDecimals: 6,
  },
};
