import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    chainId: process.env.NEXT_PUBLIC_CHAIN_ID || "sparkdream-test-1",
    chainName: process.env.NEXT_PUBLIC_CHAIN_NAME || "Spark Dream",
    lcdEndpoint: process.env.NEXT_PUBLIC_LCD_ENDPOINT || "https://api-test.sparkdream.io",
    rpcEndpoint: process.env.NEXT_PUBLIC_RPC_ENDPOINT || "https://rpc-test.sparkdream.io",
    denom: process.env.NEXT_PUBLIC_DENOM || "uspark",
    displayDenom: process.env.NEXT_PUBLIC_DISPLAY_DENOM || "SPARK",
    bech32Prefix: process.env.NEXT_PUBLIC_BECH32_PREFIX || "sprkdrm",
  });
}
