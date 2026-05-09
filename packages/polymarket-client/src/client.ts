import {
  ApiKeyCreds,
  Chain,
  ClobClient,
  OrderType,
  Side,
  SignatureType,
  type BalanceAllowanceParams,
  type BalanceAllowanceResponse,
  type OpenOrder,
  type OpenOrderParams,
  type OpenOrdersResponse,
  type OrderBookSummary,
  type PaginationPayload,
  type Trade,
  type TradeParams,
  type UserMarketOrder,
  type UserOrder,
} from '@polymarket/clob-client';

export const DEFAULT_CLOB_HOST = 'https://clob.polymarket.com';

export type Signer = ConstructorParameters<typeof ClobClient>[2];

export interface PolymarketClientOptions {
  host?: string;
  chainId?: Chain;
  signer?: Signer;
  creds?: ApiKeyCreds;
  signatureType?: SignatureType;
  funderAddress?: string;
  useServerTime?: boolean;
}

export class PolymarketApiError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PolymarketApiError';
  }
}

export class PolymarketClient {
  private readonly inner: ClobClient;
  readonly host: string;

  constructor(options: PolymarketClientOptions = {}) {
    this.host = options.host ?? DEFAULT_CLOB_HOST;
    this.inner = new ClobClient(
      this.host,
      options.chainId ?? Chain.POLYGON,
      options.signer,
      options.creds,
      options.signatureType,
      options.funderAddress,
      undefined,
      options.useServerTime,
    );
  }

  get sdk(): ClobClient {
    return this.inner;
  }

  // ---------- public (no auth) ----------

  async getServerTime(): Promise<number> {
    return this.wrap('getServerTime', () => this.inner.getServerTime());
  }

  async getMarkets(nextCursor?: string): Promise<PaginationPayload> {
    return this.wrap('getMarkets', () => this.inner.getMarkets(nextCursor));
  }

  async getMarket(conditionId: string): Promise<unknown> {
    return this.wrap('getMarket', () => this.inner.getMarket(conditionId));
  }

  async getOrderBook(tokenId: string): Promise<OrderBookSummary> {
    return this.wrap('getOrderBook', () => this.inner.getOrderBook(tokenId));
  }

  async getMidpoint(tokenId: string): Promise<{ mid: string }> {
    return this.wrap('getMidpoint', () => this.inner.getMidpoint(tokenId));
  }

  async getPrice(tokenId: string, side: 'buy' | 'sell'): Promise<{ price: string }> {
    return this.wrap('getPrice', () => this.inner.getPrice(tokenId, side));
  }

  async getSpread(tokenId: string): Promise<{ spread: string }> {
    return this.wrap('getSpread', () => this.inner.getSpread(tokenId));
  }

  async getLastTradePrice(tokenId: string): Promise<{ price: string; side: Side }> {
    return this.wrap('getLastTradePrice', () => this.inner.getLastTradePrice(tokenId));
  }

  // ---------- L1 (private key) ----------

  async createOrDeriveApiKey(nonce = 0): Promise<ApiKeyCreds> {
    return this.wrap('createOrDeriveApiKey', () => this.inner.createOrDeriveApiKey(nonce));
  }

  // ---------- L2 (trading) ----------

  async createOrder(
    order: UserOrder,
    options?: { tickSize?: '0.1' | '0.01' | '0.001' | '0.0001'; negRisk?: boolean },
  ): Promise<unknown> {
    return this.wrap('createOrder', () => this.inner.createOrder(order, options));
  }

  async createAndPostOrder(
    order: UserOrder,
    options?: { tickSize?: '0.1' | '0.01' | '0.001' | '0.0001'; negRisk?: boolean },
    orderType: OrderType.GTC | OrderType.GTD = OrderType.GTC,
  ): Promise<unknown> {
    return this.wrap('createAndPostOrder', () =>
      this.inner.createAndPostOrder(order, options, orderType),
    );
  }

  async createAndPostMarketOrder(
    order: UserMarketOrder,
    options?: { tickSize?: '0.1' | '0.01' | '0.001' | '0.0001'; negRisk?: boolean },
    orderType: OrderType.FOK | OrderType.FAK = OrderType.FOK,
  ): Promise<unknown> {
    return this.wrap('createAndPostMarketOrder', () =>
      this.inner.createAndPostMarketOrder(order, options, orderType),
    );
  }

  async cancelOrder(orderId: string): Promise<unknown> {
    return this.wrap('cancelOrder', () => this.inner.cancelOrder({ orderID: orderId }));
  }

  async cancelOrders(orderIds: string[]): Promise<unknown> {
    return this.wrap('cancelOrders', () => this.inner.cancelOrders(orderIds));
  }

  async cancelAll(): Promise<unknown> {
    return this.wrap('cancelAll', () => this.inner.cancelAll());
  }

  async getOpenOrders(params?: OpenOrderParams): Promise<OpenOrdersResponse> {
    return this.wrap('getOpenOrders', () => this.inner.getOpenOrders(params));
  }

  async getOrder(orderId: string): Promise<OpenOrder> {
    return this.wrap('getOrder', () => this.inner.getOrder(orderId));
  }

  async getTrades(params?: TradeParams): Promise<Trade[]> {
    return this.wrap('getTrades', () => this.inner.getTrades(params));
  }

  async getBalanceAllowance(params?: BalanceAllowanceParams): Promise<BalanceAllowanceResponse> {
    return this.wrap('getBalanceAllowance', () => this.inner.getBalanceAllowance(params));
  }

  async updateBalanceAllowance(params?: BalanceAllowanceParams): Promise<void> {
    return this.wrap('updateBalanceAllowance', () => this.inner.updateBalanceAllowance(params));
  }

  async postHeartbeat(heartbeatId?: string | null): Promise<unknown> {
    return this.wrap('postHeartbeat', () => this.inner.postHeartbeat(heartbeatId));
  }

  // The CLOB does not have a `getPositions` endpoint — positions live on the
  // public Data API (`https://data-api.polymarket.com/positions`). Surfaced
  // here for parity with the OPE-267 contract; pulls via fetch().
  async getPositions(walletAddress: string): Promise<unknown> {
    const url = `https://data-api.polymarket.com/positions?user=${encodeURIComponent(walletAddress)}`;
    return this.wrap('getPositions', async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new PolymarketApiError(
          `Data API ${res.status} ${res.statusText}`,
          await res.text().catch(() => undefined),
          res.status,
        );
      }
      return res.json() as Promise<unknown>;
    });
  }

  private async wrap<T>(op: string, fn: () => Promise<T> | T): Promise<T> {
    try {
      const result = await fn();
      const maybeError = result as { error?: string; status?: number } | null;
      if (
        maybeError &&
        typeof maybeError === 'object' &&
        typeof maybeError.error === 'string' &&
        typeof maybeError.status === 'number' &&
        maybeError.status >= 400
      ) {
        throw new PolymarketApiError(`${op}: ${maybeError.error}`, maybeError, maybeError.status);
      }
      return result;
    } catch (err) {
      if (err instanceof PolymarketApiError) throw err;
      const e = err as { message?: string; status?: number };
      throw new PolymarketApiError(`${op} failed: ${e?.message ?? String(err)}`, err, e?.status);
    }
  }
}

export { Chain, OrderType, Side, SignatureType };
export type {
  ApiKeyCreds,
  BalanceAllowanceParams,
  BalanceAllowanceResponse,
  OpenOrder,
  OpenOrderParams,
  OpenOrdersResponse,
  OrderBookSummary,
  PaginationPayload,
  Trade,
  TradeParams,
  UserMarketOrder,
  UserOrder,
};
