/**
 * OPE-271 — Limitless Exchange adapter (Base chain)
 *
 * CLOB-based prediction market on Base (8453).
 * Settlement: native USDC on Base.
 * Bridge cost to Ethereum (ZAMA): ~$5 via Across.
 */

import type {
  PredictionMarketAdapter,
  Market,
  MarketDetail,
  MarketFilter,
  OrderBook,
  PlaceOrderParams,
  OrderResult,
  Position,
  AssetInfo,
  CostEstimate,
} from './types.js';
import { PrivacyLevel } from './types.js';
import { PolymarketAdapter } from './polymarket-adapter.js';

const BASE_CHAIN_ID = 8453;

const BASE_USDC: AssetInfo = {
  chainId: BASE_CHAIN_ID,
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  symbol: 'USDC',
  decimals: 6,
  variant: 'native',
};

export class LimitlessAdapter implements PredictionMarketAdapter {
  readonly name = 'limitless';
  readonly privacyLevel = PrivacyLevel.MEDIUM;
  private _apiUrl: string;

  constructor(apiUrl?: string) {
    this._apiUrl = apiUrl || process.env.LIMITLESS_API_URL || 'https://api.limitless.exchange';
  }

  /** Base URL for the Limitless REST API */
  get baseUrl(): string {
    return this._apiUrl;
  }

  getMarketType(): 'clob' {
    return 'clob';
  }

  getChainId(): number {
    return BASE_CHAIN_ID;
  }

  getSettlementAsset(): AssetInfo {
    return BASE_USDC;
  }

  async getMarkets(_filters?: MarketFilter): Promise<Market[]> {
    // TODO: Call GET /markets
    return [];
  }

  async getMarket(_marketId: string): Promise<MarketDetail> {
    throw new Error('Not implemented: getMarket');
  }

  async getOrderBook(_marketId: string): Promise<OrderBook> {
    throw new Error('Not implemented: getOrderBook');
  }

  async placeOrder(_params: PlaceOrderParams): Promise<OrderResult> {
    throw new Error('Not implemented: placeOrder');
  }

  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error('Not implemented: cancelOrder');
  }

  async getPositions(_account?: string): Promise<Position[]> {
    return [];
  }

  async estimateGasCost(): Promise<CostEstimate> {
    return {
      totalUsd: 5.02,
      gasUsd: 0.02,
      bridgeFeeUsd: 5.0,
      estimatedLatencyMs: 300_000, // ~5 min
      notes: 'Base gas ~$0.02; Across bridge Eth↔Base ~$5',
    };
  }

  async estimateBridgeCost(): Promise<CostEstimate> {
    return {
      totalUsd: 5.0,
      bridgeFeeUsd: 5.0,
      estimatedLatencyMs: 180_000, // ~3 min
      notes: 'Across bridge Ethereum↔Base',
    };
  }
}

/**
 * Factory: create the right adapter for a market source.
 */
export async function createMarketAdapter(source: string): Promise<PredictionMarketAdapter> {
  switch (source) {
    case 'polymarket': {
      return new PolymarketAdapter();
    }
    case 'limitless':
      return new LimitlessAdapter();
    default:
      throw new Error(`Unknown market source: ${source}`);
  }
}
