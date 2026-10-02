import { NextResponse } from "next/server";

// Runtime config: read non-NEXT_PUBLIC_* vars so values can be changed via the
// deployment env without a rebuild. Next.js inlines NEXT_PUBLIC_* at build time
// (both client and server), so those can only ever reflect the build-time value
// — we keep them as a second-tier fallback for local dev convenience.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    chainId:      process.env.CHAIN_ID      || process.env.NEXT_PUBLIC_CHAIN_ID      || "sparkdream-test-1",
    chainName:    process.env.CHAIN_NAME    || process.env.NEXT_PUBLIC_CHAIN_NAME    || "Spark Dream",
    lcdEndpoint:  process.env.LCD_ENDPOINT  || process.env.NEXT_PUBLIC_LCD_ENDPOINT  || "https://api-test.sparkdream.io",
    rpcEndpoint:  process.env.RPC_ENDPOINT  || process.env.NEXT_PUBLIC_RPC_ENDPOINT  || "https://rpc-test.sparkdream.io",
    explorerUrl:  process.env.EXPLORER_URL  || process.env.NEXT_PUBLIC_EXPLORER_URL  || "https://explorer-testnet.sparkdream.io/sparkdream",
    denom:        process.env.CHAIN_DENOM   || process.env.NEXT_PUBLIC_DENOM         || "uspark.sparkdreamtest",
    displayDenom: process.env.DISPLAY_DENOM || process.env.NEXT_PUBLIC_DISPLAY_DENOM || "SPARK",
    dreamDisplayDenom:
      process.env.DREAM_DISPLAY_DENOM || process.env.NEXT_PUBLIC_DREAM_DISPLAY_DENOM || "DREAM",
    bech32Prefix: process.env.BECH32_PREFIX || process.env.NEXT_PUBLIC_BECH32_PREFIX || "sprkdrm",
    remoteManifestUrl:
      process.env.REMOTE_MANIFEST_URL || process.env.NEXT_PUBLIC_REMOTE_MANIFEST_URL || "",
    peerChains: peerChains(process.env.PEER_CHAINS),
  });
}

// PEER_CHAINS: {"<chain id>": "<REST API URL>", ...} for the chains this one
// relays with. Anything that does not parse as that shape is ignored.
function peerChains(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === "string" && /^https?:\/\//.test(e[1])
      )
    );
  } catch {
    return {};
  }
}
