// x/shield LCD response shapes (snake_case, as the LCD returns them).

export type NullifierScopeType =
  | "NULLIFIER_SCOPE_UNSPECIFIED"
  | "NULLIFIER_SCOPE_EPOCH"
  | "NULLIFIER_SCOPE_MESSAGE_FIELD"
  | "NULLIFIER_SCOPE_GLOBAL";

export type ShieldBatchMode =
  | "SHIELD_BATCH_MODE_UNSPECIFIED"
  | "SHIELD_BATCH_MODE_IMMEDIATE_ONLY"
  | "SHIELD_BATCH_MODE_ENCRYPTED_ONLY"
  | "SHIELD_BATCH_MODE_EITHER";

export interface ShieldedOpRegistration {
  message_type_url: string;
  proof_domain: string;
  min_trust_level: number;
  nullifier_domain: number;
  nullifier_scope_type: NullifierScopeType;
  scope_field_path: string;
  active: boolean;
  batch_mode: ShieldBatchMode;
  /** CONSUME (default; omitted by older nodes) or OWNERSHIP (managing
   *  anonymously created content: the proof reproduces its owner tag). */
  nullifier_mode?: "NULLIFIER_MODE_CONSUME" | "NULLIFIER_MODE_OWNERSHIP";
}

export interface ShieldedOpsResponse {
  registrations: ShieldedOpRegistration[];
}

export interface VerificationKeyResponse {
  verification_key: {
    circuit_id: string;
    /** base64 */
    vk_bytes?: string;
    description?: string;
  };
}

export interface ShieldEpochResponse {
  epoch_state: {
    current_epoch: string;
    epoch_start_height: string;
    decryption_key_available: boolean;
  };
}

export interface TrustTreeLeaf {
  index: string;
  /** base64 */
  hash: string;
}

export interface TrustTreeResponse {
  /** base64; empty before the tree is first built */
  root?: string;
  depth: number;
  leaf_count: string;
  leaves: TrustTreeLeaf[];
  pagination?: { next_key?: string | null; total?: string };
}
