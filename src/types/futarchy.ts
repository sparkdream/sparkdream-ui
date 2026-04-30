// Futarchy module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

// On-chain market record. All numeric/decimal fields arrive as strings.
export interface Market {
  // Metadata
  index: string;
  creator: string;
  symbol: string;
  question: string;

  // Configuration
  denom: string;
  min_tick: string;

  // Temporal
  end_block: string;
  redemption_blocks: string;
  resolution_height: string;
  status: string;

  // LMSR state — b sets liquidity (b = subsidy / ln(2)); pool_yes / pool_no
  // are the cumulative shares minted on each side.
  b_value: string;
  pool_yes: string;
  pool_no: string;

  // Liquidity tracking
  initial_liquidity: string;
  liquidity_withdrawn: string;

  // Snapshot price for CANCELLED / RESOLVED_INVALID redemptions. Empty for
  // ACTIVE or RESOLVED_YES/NO markets.
  settlement_price_yes: string;
}

export interface FutarchyParams {
  min_liquidity: string;
  max_duration: string;
  default_min_tick: string;
  max_redemption_delay: string;
  trading_fee_bps: string;
  max_lmsr_exponent: string;
}

// Market status string values (set by the keeper/EndBlocker).
export const MarketStatus = {
  ACTIVE: "ACTIVE",
  RESOLVED_YES: "RESOLVED_YES",
  RESOLVED_NO: "RESOLVED_NO",
  RESOLVED_INVALID: "RESOLVED_INVALID",
  CANCELLED: "CANCELLED",
} as const;
export type MarketStatusValue = (typeof MarketStatus)[keyof typeof MarketStatus];

export const MARKET_STATUS_LABELS: Record<string, string> = {
  [MarketStatus.ACTIVE]: "Active",
  [MarketStatus.RESOLVED_YES]: "Resolved YES",
  [MarketStatus.RESOLVED_NO]: "Resolved NO",
  [MarketStatus.RESOLVED_INVALID]: "Invalid",
  [MarketStatus.CANCELLED]: "Cancelled",
};

// API response types

interface Pagination {
  next_key: string | null;
  total: string;
}

export interface GetMarketResponse {
  market: Market;
}

export interface ListMarketResponse {
  market: Market[];
  pagination: Pagination;
}

export interface GetMarketPriceResponse {
  // Marginal price per share at the current pool state, as a decimal string
  // in [0, 1].
  price: string;
  // Shares minted for the supplied amount_in (omitted when amount is empty).
  shares_out: string;
}

export interface FutarchyParamsResponse {
  params: FutarchyParams;
}
