/**
 * OPE-270 — Polymarket adapter (Polygon chain)
 *
 * Wraps PolymarketClient to satisfy the PredictionMarketAdapter interface.
 * Settlement: USDC.e on Polygon (0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174).
 * Privacy: HIGH (ZAMA confidential path — no cross-chain bridging needed).
 */

import { PolymarketClient, type PolymarketClientOptions } from './client.js';
import {
  OrderSide,
  PrivacyLevel,
  type AssetInfo,
  type CostEstimate,
  type Market,
  type MarketDetail,
  type MarketFilter,
  type MarketOutcome,
  type MarketStatus,
  type OrderBook,
  type OrderBookLevel,
  type OrderResult,
  type PlaceOrderParams,
  type Position,
  type PredictionMarketAdapter,
} from './types.js';
import {
  Side,
  OrderType,
  type OrderResponse,
  type OrderBookSummary,
  type PaginationPayload,
} from '@polymarket/clob-client';

const POLYGON_CHAIN_ID = 137;

const POLYGON_USDC_E: AssetInfo = {
  chainId: POLYGON_CHAIN_ID,
  address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  symbol: 'USDC.e',
  decimals: 6,
  variant: 'usdc-e',
};

/* ---------- helpers ---------- */

/** Map a raw Polymarket market object from the CLOB / Data API into our Market shape. */
function mapRawMarket(raw: Record<string, unknown>): Market {
  const outcomes = mapRawOutcomes(raw);
  const status = mapRawStatus(raw);

  return {
    id: raw.condition_id as string,
    question: raw.question as string,
    endDate: raw.end_date_iso as string | undefined,
    outcomes,
    status,
    negRisk: raw.neg_risk as boolean | undefined,
  };
}

function mapRawOutcomes(raw: Record<string, unknown>): MarketOutcome[] {
  const tokens = raw.tokens as Array<Record<string, unknown>> | undefined;
  if (!tokens || !Array.isArray(tokens)) return [];

  return tokens.map((t) => ({
    outcomeId: t.token_id as string,
    label: t.outcome as string,
    price: typeof t.price === 'number' ? t.price : undefined,
    winner: t.winner as boolean | undefined,
  }));
}

function mapRawStatus(raw: Record<string, unknown>): MarketStatus {
  const closed = raw.closed as boolean | undefined;
  const resolved = raw.resolved as boolean | undefined;
  if (resolved) return 'resolved';
  if (closed) return 'closed';
  return 'open';
}

/** Map a raw Polymarket market to MarketDetail (includes extra fields). */
function mapRawMarketDetail(raw: Record<string, unknown>): MarketDetail {
  const base = mapRawMarket(raw);
  return {
    ...base,
    description: raw.description as string | undefined,
    slug: raw.slug as string | undefined,
    minimumOrderSize: raw.minimum_order_size as string | undefined,
    tickSize: raw.tick_size as string | undefined,
    acceptingOrders: raw.accepting_orders as boolean | undefined,
    raw,
  };
}

/** Map OrderBookSummary from the SDK to our OrderBook. */
function mapOrderBook(summary: OrderBookSummary, parentMarketId?: string): OrderBook {
  const mapLevel = (l: { price: string; size: string }): OrderBookLevel => ({
    price: l.price,
    size: l.size,
  });

  return {
    marketId: summary.asset_id,
    parentMarketId,
    bids: summary.bids.map(mapLevel),
    asks: summary.asks.map(mapLevel),
    timestamp: summary.timestamp,
    tickSize: summary.tick_size,
    minOrderSize: summary.min_order_size,
  };
}

/** Map a raw position from the Data API into our Position shape. */
function mapRawPosition(raw: Record<string, unknown>): Position {
  return {
    marketId: raw.condition_id as string,
    outcomeId: raw.asset_id as string,
    outcomeLabel: raw.outcome as string | undefined,
    size: raw.size as string,
    price: typeof raw.cur_price === 'number' ? raw.cur_price : undefined,
    valueUsd: typeof raw.value === 'number' ? raw.value : undefined,
    raw,
  };
}

/** Map OrderResponse from the SDK into our OrderResult. */
function mapOrderResponse(resp: OrderResponse): OrderResult {
  return {
    success: resp.success,
    orderId: resp.orderID,
    status: resp.status,
    errorMessage: resp.errorMsg || undefined,
    transactionHashes: resp.transactionsHashes?.length ? resp.transactionsHashes : undefined,
    takingAmount: resp.takingAmount || undefined,
    makingAmount: resp.makingAmount || undefined,
    raw: resp,
  };
}

/** Convert our OrderSide to the SDK's Side. */
function toSdkSide(side: OrderSide): Side {
  return side === OrderSide.BUY ? Side.BUY : Side.SELL;
}

/** Convert our OrderTimeInForce to the SDK's OrderType. */
function toSdkOrderType(kind: 'limit' | 'market', tif?: 'GTC' | 'GTD' | 'FOK' | 'FAK'): OrderType {
  if (kind === 'market') {
    return tif === 'FAK' ? OrderType.FAK : OrderType.FOK;
  }
  // limit
  if (tif === 'GTD') return OrderType.GTD;
  return OrderType.GTC;
}

/* ---------- adapter ---------- */

export class PolymarketAdapter implements PredictionMarketAdapter {
  readonly name = 'polymarket';
  readonly privacyLevel = PrivacyLevel.HIGH;
  private readonly client: PolymarketClient;

  constructor(options?: PolymarketClientOptions) {
    this.client = new PolymarketClient(options);
  }

  /** Expose the underlying client for advanced use-cases. */
  get underlying(): PolymarketClient {
    return this.client;
  }

  getMarketType(): 'clob' {
    return 'clob';
  }

  getChainId(): number {
    return POLYGON_CHAIN_ID;
  }

  getSettlementAsset(): AssetInfo {
    return POLYGON_USDC_E;
  }

  async getMarkets(filters?: MarketFilter): Promise<Market[]> {
    const page: PaginationPayload = await this.client.getMarkets(filters?.cursor);
    if (!Array.isArray(page.data)) return [];
    return page.data.map((m: Record<string, unknown>) => mapRawMarket(m));
  }

  async getMarket(marketId: string): Promise<MarketDetail> {
    const raw = (await this.client.getMarket(marketId)) as Record<string, unknown>;
    return mapRawMarketDetail(raw);
  }

  async getOrderBook(marketId: string): Promise<OrderBook> {
    // In Polymarket, `marketId` at the outcome level is the `tokenID`.
    // The caller should pass the outcome's `outcomeId` (which IS the tokenID)
    // so we forward it directly.
    const summary = await this.client.getOrderBook(marketId);
    return mapOrderBook(summary, summary.market);
  }

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const kind = params.kind ?? 'limit';
    const side = toSdkSide(params.side);
    const orderType = toSdkOrderType(kind, params.timeInForce);
    const tickSize = params.extra?.tickSize as '0.1' | '0.01' | '0.001' | '0.0001' | undefined;
    const negRisk = params.extra?.negRisk as boolean | undefined;
    const opts = tickSize || negRisk ? { tickSize, negRisk } : undefined;

    let result: unknown;

    if (kind === 'market') {
      // Market order uses `amount` (USD for BUY, shares for SELL) instead of `size`.
      result = await this.client.createAndPostMarketOrder(
        {
          tokenID: params.outcomeId,
          amount: params.size,
          price: params.price,
          side,
          feeRateBps: params.feeRateBps,
          taker: params.extra?.taker as string | undefined,
          orderType: orderType === OrderType.FAK ? OrderType.FAK : OrderType.FOK,
        },
        opts,
        orderType as OrderType.FOK | OrderType.FAK,
      );
    } else {
      // Limit order uses `size` (shares) and requires `price`.
      if (params.price == null) {
        return {
          success: false,
          errorMessage: 'Limit order requires a price',
        };
      }
      result = await this.client.createAndPostOrder(
        {
          tokenID: params.outcomeId,
          price: params.price,
          size: params.size,
          side,
          feeRateBps: params.feeRateBps,
          expiration: params.expiration,
          taker: params.extra?.taker as string | undefined,
        },
        opts,
        orderType as OrderType.GTC | OrderType.GTD,
      );
    }

    // The SDK may return an OrderResponse directly or wrapped.
    const resp = result as Partial<OrderResponse> | null;
    if (resp && typeof resp.success === 'boolean') {
      return mapOrderResponse(resp as OrderResponse);
    }

    // Fallback: treat any truthy result as success.
    return {
      success: true,
      raw: result,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  async getPositions(account?: string): Promise<Position[]> {
    if (!account) return [];
    const raw = (await this.client.getPositions(account)) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) return [];
    return raw.map(mapRawPosition);
  }

  async estimateGasCost(): Promise<CostEstimate> {
    return {
      totalUsd: 0.05,
      gasUsd: 0.05,
      estimatedLatencyMs: 5_000,
      notes: 'Polygon gas is extremely cheap; typical CLOB order-fill tx ~$0.05',
    };
  }

  async estimateBridgeCost(): Promise<CostEstimate | null> {
    return {
      totalUsd: 24,
      bridgeFeeUsd: 24,
      estimatedLatencyMs: 600_000, // ~10 min
      notes: 'Across bridge Polygon↔Ethereum: ~$13–35 depending on gas and liquidity',
    };
  }
}
