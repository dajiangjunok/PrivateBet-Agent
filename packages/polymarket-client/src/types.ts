/**
 * OPE-270 — PredictionMarketAdapter unified interface.
 *
 * Adapter contract that lets the bot package plug in different prediction
 * markets (Polymarket on Polygon today; Limitless on Base, Azuro, ZAMA-native
 * markets later) behind a single shape.
 *
 * Concretely, `marketId` in our model is the high-level question identifier
 * (Polymarket: `condition_id`). Each `Market` carries one or more
 * `MarketOutcome`s, each of which has its own `outcomeId` — this is what
 * `getOrderBook` and `placeOrder` operate on at the per-outcome level
 * (Polymarket: ERC-1155 `tokenID`).
 */

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export type OrderKind = 'limit' | 'market';
export type OrderTimeInForce = 'GTC' | 'GTD' | 'FOK' | 'FAK';
export type MarketStatus = 'open' | 'closed' | 'resolved';
export type MarketType = 'clob' | 'amm' | 'pool';

/**
 * Privacy posture of an adapter, judged by what bridging the agent has to do
 * to fund and exit the market in private.
 *
 * - HIGH: market settles on a confidential chain; no bridging required.
 * - MEDIUM: single bridge required between the confidential layer and the
 *   market's settlement chain (e.g. Polymarket on Polygon ↔ ZAMA cUSDC on L1).
 * - LOW: market is fully public and bridging alone cannot preserve privacy.
 */
export enum PrivacyLevel {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export interface AssetInfo {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** Variant tag for fungible-but-not-equivalent tokens (e.g. 'usdc-e' vs 'native-usdc'). */
  variant?: string;
}

export interface MarketOutcome {
  /** Adapter-specific outcome identifier (Polymarket: `tokenID`). */
  outcomeId: string;
  label: string;
  /** Last-known mark price as a probability in [0, 1]. */
  price?: number;
  winner?: boolean;
}

export interface Market {
  id: string;
  question: string;
  /** ISO 8601 timestamp; absent if the market has no defined end. */
  endDate?: string;
  outcomes: MarketOutcome[];
  status: MarketStatus;
  /** True for Polymarket multi-outcome / mutually-exclusive event markets. */
  negRisk?: boolean;
}

export interface MarketDetail extends Market {
  description?: string;
  slug?: string;
  /** Smallest tradeable size in outcome shares, as a decimal string. */
  minimumOrderSize?: string;
  /** Smallest price increment, as a decimal string. */
  tickSize?: string;
  acceptingOrders?: boolean;
  /** Untyped passthrough of the upstream payload for adapter-specific consumers. */
  raw?: unknown;
}

export interface MarketFilter {
  /** Pagination cursor (Polymarket: `next_cursor`). */
  cursor?: string;
  /** Drop markets that are closed or have stopped accepting orders. */
  activeOnly?: boolean;
  /** Free-text search; ignored by adapters whose backend does not support it. */
  query?: string;
}

export interface OrderBookLevel {
  /** Price as a decimal string in the settlement asset. */
  price: string;
  /** Size as a decimal string in outcome shares. */
  size: string;
}

export interface OrderBook {
  /** Outcome-level identifier this book is for (Polymarket: `tokenID`). */
  marketId: string;
  /** Parent question id, when available (Polymarket: `condition_id`). */
  parentMarketId?: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  /** Adapter-supplied timestamp; format is adapter-specific. */
  timestamp?: string;
  tickSize?: string;
  minOrderSize?: string;
}

export interface PlaceOrderParams {
  /** Outcome to trade (Polymarket: `tokenID`). */
  outcomeId: string;
  side: OrderSide;
  /** Limit price in [0, 1]. Required for `limit`; optional for `market`. */
  price?: number;
  /**
   * Limit orders: shares of the outcome token.
   * Market BUY orders: USD amount to spend.
   * Market SELL orders: shares to sell.
   */
  size: number;
  /** Defaults to `'limit'` if unspecified. */
  kind?: OrderKind;
  /** Defaults to `'GTC'` for limit, `'FOK'` for market. */
  timeInForce?: OrderTimeInForce;
  feeRateBps?: number;
  /** UNIX seconds; only meaningful for `GTD` time-in-force. */
  expiration?: number;
  /** Adapter-specific options (e.g. Polymarket `tickSize`, `negRisk`). */
  extra?: Record<string, unknown>;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  status?: string;
  errorMessage?: string;
  /** On-chain settlement hashes for fills matched at submit time. */
  transactionHashes?: string[];
  takingAmount?: string;
  makingAmount?: string;
  raw?: unknown;
}

export interface Position {
  marketId: string;
  outcomeId: string;
  outcomeLabel?: string;
  /** Shares held in the outcome token, as a decimal string. */
  size: string;
  /** Last-known mark price in [0, 1]. */
  price?: number;
  /** Notional value in the settlement asset. */
  valueUsd?: number;
  raw?: unknown;
}

export interface CostEstimate {
  /** Aggregate estimated cost across all legs, in USD. */
  totalUsd: number;
  /** Combined source + destination chain gas. */
  gasUsd?: number;
  /** Bridge protocol + relayer fees, when a bridge is involved. */
  bridgeFeeUsd?: number;
  /** Swap fee / slippage component (e.g. USDC ↔ USDC.e). */
  swapFeeUsd?: number;
  /** End-to-end latency estimate in milliseconds. */
  estimatedLatencyMs?: number;
  /** Free-form notes about the assumptions behind the estimate. */
  notes?: string;
}

export interface PredictionMarketAdapter {
  readonly name: string;
  readonly privacyLevel: PrivacyLevel;

  getMarketType(): MarketType;
  getChainId(): number;
  getSettlementAsset(): AssetInfo;

  getMarkets(filters?: MarketFilter): Promise<Market[]>;
  getMarket(marketId: string): Promise<MarketDetail>;
  getOrderBook(marketId: string): Promise<OrderBook>;

  placeOrder(params: PlaceOrderParams): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  getPositions(account?: string): Promise<Position[]>;

  /** Per-trade gas / operator-relay cost on the market's home chain. */
  estimateGasCost(): Promise<CostEstimate>;
  /**
   * Cost of moving USDC across the privacy boundary (e.g. Polygon USDC.e ↔
   * Ethereum cUSDC). Returns `null` when the adapter does not need a bridge.
   */
  estimateBridgeCost?(): Promise<CostEstimate | null>;
}
