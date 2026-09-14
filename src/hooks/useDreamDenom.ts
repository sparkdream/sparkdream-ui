"use client";

import { useChainConfig } from "@/contexts/ChainConfigContext";

/**
 * Display ticker of the internal DREAM token for the chain this UI is pointed
 * at. It is per-chain like SPARK itself — "DREAM" on mainnet and the public
 * testnet, "DRMZ" on sparkdream-dev-1 — so UI copy that names the token reads
 * it from here rather than hardcoding the word.
 *
 * Comments, identifiers and chain param keys keep saying DREAM: they name the
 * concept, not the ticker a given chain prints.
 */
export function useDreamDenom(): string {
  return useChainConfig().config.dreamDisplayDenom;
}

/**
 * Swaps the DREAM ticker into static copy that cannot call a hook — the param
 * metadata in `paramMeta.ts`, whose labels and hints are a module-level table
 * built long before a config exists. Callers hold the denom from
 * `useDreamDenom()` and run the table's strings through this at render time.
 */
export function withDreamDenom(text: string, denom: string): string {
  return denom === "DREAM" ? text : text.replace(/\bDREAM\b/g, denom);
}
