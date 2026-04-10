// Keplr wallet type declarations

interface KeplrKey {
  name: string;
  algo: string;
  pubKey: Uint8Array;
  address: Uint8Array;
  bech32Address: string;
  isNanoLedger: boolean;
}

interface Keplr {
  experimentalSuggestChain(chainInfo: unknown): Promise<void>;
  enable(chainId: string): Promise<void>;
  getKey(chainId: string): Promise<KeplrKey>;
  getOfflineSigner(chainId: string): any;
  getOfflineSignerOnlyAmino(chainId: string): any;
}

interface Window {
  keplr: Keplr;
}
