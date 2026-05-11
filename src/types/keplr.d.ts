// Keplr wallet type declarations

interface KeplrKey {
  name: string;
  algo: string;
  pubKey: Uint8Array;
  address: Uint8Array;
  bech32Address: string;
  isNanoLedger: boolean;
}

interface KeplrSignOptions {
  /** If true, Keplr does NOT override the fee in the sign doc with its own gas-price calculation. */
  preferNoSetFee?: boolean;
  /** If true, Keplr does NOT override the memo in the sign doc. */
  preferNoSetMemo?: boolean;
  /** Render the sign doc in ledger-friendly amino form even on direct-mode sign. */
  disableBalanceCheck?: boolean;
}

interface KeplrInteractionOptions {
  sign?: KeplrSignOptions;
}

interface Keplr {
  /**
   * Session-wide signing defaults. Setting `defaultOptions.sign.preferNoSetFee`
   * to true prevents Keplr from silently overriding the fee in our sign doc
   * with its own gas-price calculation.
   */
  defaultOptions?: KeplrInteractionOptions;
  experimentalSuggestChain(chainInfo: unknown): Promise<void>;
  enable(chainId: string): Promise<void>;
  getKey(chainId: string): Promise<KeplrKey>;
  getOfflineSigner(chainId: string): any;
  getOfflineSignerOnlyAmino(chainId: string): any;
  signAmino(chainId: string, signer: string, signDoc: any, signOptions?: KeplrSignOptions): Promise<any>;
  signDirect(chainId: string, signer: string, signDoc: any, signOptions?: KeplrSignOptions): Promise<any>;
}

interface Window {
  keplr: Keplr;
}
