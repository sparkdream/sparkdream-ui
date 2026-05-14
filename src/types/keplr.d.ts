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
  // `OfflineSigner` from `@cosmjs/proto-signing` is the union of direct +
  // amino signers — what `SigningStargateClient.connectWithSigner` accepts.
  // Inline `import("…")` types keep this file ambient (no top-level import
  // would convert it into a module and break the global `Window` augmentation).
  getOfflineSigner(chainId: string): import("@cosmjs/proto-signing").OfflineSigner;
  getOfflineSignerOnlyAmino(chainId: string): import("@cosmjs/amino").OfflineAminoSigner;
  signAmino(
    chainId: string,
    signer: string,
    signDoc: import("@cosmjs/amino").StdSignDoc,
    signOptions?: KeplrSignOptions
  ): Promise<import("@cosmjs/amino").AminoSignResponse>;
  signDirect(
    chainId: string,
    signer: string,
    signDoc: import("cosmjs-types/cosmos/tx/v1beta1/tx").SignDoc,
    signOptions?: KeplrSignOptions
  ): Promise<import("@cosmjs/proto-signing").DirectSignResponse>;
}

interface Window {
  keplr: Keplr;
}
