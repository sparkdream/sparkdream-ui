"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { buildChainInfo, type ChainConfig, defaults } from "@/lib/chain";

interface ChainConfigState {
  config: ChainConfig;
  chainInfo: ReturnType<typeof buildChainInfo>;
  ready: boolean;
}

const ChainConfigContext = createContext<ChainConfigState>({
  config: defaults,
  chainInfo: buildChainInfo(defaults),
  ready: false,
});

export function useChainConfig() {
  return useContext(ChainConfigContext);
}

export function ChainConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ChainConfig>(defaults);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: ChainConfig) => {
        setConfig(data);
        setReady(true);
      })
      .catch(() => {
        // Fall back to build-time defaults
        setReady(true);
      });
  }, []);

  return (
    <ChainConfigContext.Provider
      value={{ config, chainInfo: buildChainInfo(config), ready }}
    >
      {children}
    </ChainConfigContext.Provider>
  );
}
