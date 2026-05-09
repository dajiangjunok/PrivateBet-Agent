# Polymarket CLOB API Integration — Validation Report

**Ticket:** OPE-267
**Date:** 2026-05-06
**Author:** PrivateBet Agent team
**Verdict:** ✅ **GO** (with mitigations — see §10)

---

## 1. Scope

Validate the Polymarket Central Limit Order Book (CLOB) API as the order-routing layer for the PrivateBet automated betting agent. Goals: confirm endpoint surface, authentication model, signing requirements, rate limits, latency profile, and any blockers for unattended algorithmic trading.

Read-only validation was performed live against `https://clob.polymarket.com` using the official `@polymarket/clob-client@5.8.1` SDK. **No real funds and no orders were placed.**

---

## 2. API Overview

Polymarket exposes four HTTP APIs; this report focuses on the CLOB API since it owns trading.

| API | Base URL | Purpose | Auth |
|---|---|---|---|
| **CLOB** | `https://clob.polymarket.com` | Order book, prices, order placement/cancel, balances | L1 + L2 (for trading); public for market data |
| Gamma | `https://gamma-api.polymarket.com` | Markets, events, tags, search | Public |
| Data | `https://data-api.polymarket.com` | Positions, trades, leaderboards, OI | Public |
| WS | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | Live order book + trade streams | Public for market data |

**Chain:** Polygon mainnet (chainId `137`). Settlement uses the Conditional Token Framework (CTF) on Polygon. Collateral is **pUSD** (formerly USDC.e).

---

## 3. Authentication Flow

The CLOB uses a two-tier wallet-based scheme. There is **no traditional username/password**.

### 3.1 L1 (private-key, EIP-712)

Used once to mint or recover API credentials. The user signs the EIP-712 typed-data struct below with their Polygon EOA:

```ts
const domain = { name: "ClobAuthDomain", version: "1", chainId: 137 };
const types = {
  ClobAuth: [
    { name: "address",   type: "address" },
    { name: "timestamp", type: "string"  },
    { name: "nonce",     type: "uint256" },
    { name: "message",   type: "string"  },
  ],
};
const value = {
  address: signer.address,
  timestamp: nowUnix.toString(),
  nonce: 0,
  message: "This message attests that I control the given wallet",
};
```

L1 headers attached to the request: `POLY_ADDRESS`, `POLY_SIGNATURE`, `POLY_TIMESTAMP`, `POLY_NONCE`.

Endpoints:

- `POST /auth/api-key` — create credentials (one-time per nonce).
- `GET  /auth/derive-api-key` — re-derive credentials for an existing wallet+nonce (idempotent).

Response:

```json
{ "apiKey": "uuid-v4", "secret": "base64", "passphrase": "string" }
```

> **Critical:** the secret cannot be recovered if lost. We must persist all three fields in the wallet-service vault (and back up the (wallet, nonce) tuple so we can re-derive).

### 3.2 L2 (HMAC-SHA256, per-request)

Every authenticated CLOB call carries five headers:

| Header | Value |
|---|---|
| `POLY_ADDRESS` | Signer EOA |
| `POLY_API_KEY` | `apiKey` |
| `POLY_PASSPHRASE` | `passphrase` |
| `POLY_TIMESTAMP` | UNIX seconds |
| `POLY_SIGNATURE` | base64( HMAC-SHA256( secret, `${ts}${method}${path}${body}` ) ) |

The SDK builds these automatically; we never roll our own.

### 3.3 Signature types (proxy wallets)

When constructing the client we declare which kind of wallet is funding orders:

| Type | Value | Use case | Funder address |
|---|---|---|---|
| `EOA` | 0 | Browser wallet (MetaMask) — pays gas itself | The EOA |
| `POLY_PROXY` | 1 | Polymarket email/Magic-Link users | Proxy wallet shown on polymarket.com |
| `GNOSIS_SAFE` | 2 | Most Polymarket users (deterministic Safe proxy) | Proxy wallet |

For a server-side bot, **Type 0 (EOA)** is the simplest: we control the private key, hold POL for gas, and skip proxy deployment. We will use Type 0 unless future privacy requirements push us to Type 2.

### 3.4 Order signing

`createOrder()` signs an EIP-712 `Order` struct (salt, maker, signer, taker, tokenId, makerAmount, takerAmount, expiration, nonce, feeRateBps, side, signatureType). The SDK handles this — we feed it `{tokenID, price, size, side}` and the resulting `SignedOrder` is what `postOrder()` POSTs to `/order`.

> Even with valid L2 headers, **every order body itself must carry an EIP-712 signature**. This prevents a stolen API key from minting orders without the wallet's private key.

---

## 4. Key Endpoints

Confirmed against the installed SDK (`dist/endpoints.d.ts`) and live calls.

### 4.1 Public (no auth)

| Method | Path | Purpose |
|---|---|---|
| `getServerTime` | `GET /time` | UNIX seconds (clock-skew check) |
| `getMarkets` | `GET /markets?next_cursor=…` | Paginated list (limit 1000) |
| `getMarket` | `GET /markets/{conditionId}` | Single market |
| `getSimplifiedMarkets` | `GET /simplified-markets` | Lightweight list |
| `getSamplingMarkets` | `GET /sampling-markets` | Reward-eligible markets |
| `getOrderBook` | `GET /book?token_id=…` | Bids/asks + tick + neg_risk |
| `getOrderBooks` | `GET /books` | Batch (POST-style payload) |
| `getMidpoint` / `getPrice` / `getSpread` | `/midpoint` `/price` `/spread` | Quote helpers |
| `getLastTradePrice` | `GET /last-trade-price` | Last fill |
| `getTickSize` / `getNegRisk` / `getFeeRateBps` | `/tick-size` `/neg-risk` `/fee-rate` | Per-token metadata |
| `getPricesHistory` | `GET /prices-history` | OHLC-style history |
| `getMarketTradesEvents` | `GET /live-activity/events/{conditionId}` | Recent trades |

### 4.2 L2-authenticated (trading)

| Method | Path | Purpose |
|---|---|---|
| `createOrder` / `createMarketOrder` | local | Build and EIP-712-sign |
| `postOrder` | `POST /order` | Submit signed order |
| `postOrders` | `POST /orders` | Batch submit |
| `createAndPostOrder` | one-shot | Common path for limits (GTC/GTD) |
| `createAndPostMarketOrder` | one-shot | FOK/FAK |
| `cancelOrder` | `DELETE /order` | By orderID |
| `cancelOrders` / `cancelAll` | `/orders` `/cancel-all` | Bulk cancel |
| `cancelMarketOrders` | `/cancel-market-orders` | Cancel by market |
| `getOpenOrders` | `GET /data/orders` | Resting orders |
| `getOrder` | `GET /data/order/{id}` | Single by ID |
| `getTrades` | `GET /data/trades` | Fill history |
| `getBalanceAllowance` | `GET /balance-allowance` | pUSD/CTF balance + spending caps |
| `updateBalanceAllowance` | `POST /balance-allowance/update` | Refresh allowance state |
| `postHeartbeat` | `POST /v1/heartbeats` | Keep-alive (see §6) |
| `isOrderScoring` | `GET /order-scoring` | Liquidity-rewards eligibility |
| `createOrDeriveApiKey` | `/auth/api-key` `/auth/derive-api-key` | Mint creds |

### 4.3 Order types (`OrderType` enum)

- `GTC` — Good-Til-Cancelled (limit, rests on book).
- `GTD` — Good-Til-Date (limit, requires `expiration` ≥ now+60s).
- `FOK` — Fill-Or-Kill (market; fully fill or reject).
- `FAK` — Fill-And-Kill (market; partial fill, cancel rest).

There is no separate "MARKET" enum — it is `FOK` or `FAK` against current best price.

### 4.4 Live read-only test results

Run from a Linux dev box, sequential (no warm cache):

```
getServerTime         avg 612 ms (n=5)
getMarkets (1k page)  582 ms
getOrderBook (active) avg 619 ms (n=10, p50 621, max 641)
getMidpoint / getPrice / getSpread / getLastTradePrice  ~620 ms each
```

Sample `getMarket` response (29 fields): `condition_id`, `question`, `market_slug`, `tokens[]` (token_id, outcome, price, winner), `minimum_order_size`, `minimum_tick_size`, `accepting_orders`, `enable_order_book`, `neg_risk`, `neg_risk_market_id`, `maker_base_fee`, `taker_base_fee`, `seconds_delay`, `end_date_iso`, plus housekeeping flags.

Sample `getOrderBook` response:

```js
{ market: "0x384e2707…", asset_id: "78433024…", bids: [{price, size}…], asks: […],
  min_order_size: 5, tick_size: "0.01", neg_risk: false }
```

---

## 5. Rate Limits

Cloudflare-enforced **throttling** (delays/queues, not 429s) on sliding 10s / 1m / 10m windows.

| Path family | Limit |
|---|---|
| CLOB (general) | **9,000 req / 10s** |
| Market data on CLOB | 500–1,500 req / 10s per endpoint |
| `POST /order` | **3,500 / 10s burst, 36,000 / 10 min sustained** |
| `DELETE /order` | similar dual burst+sustained |
| `/time` health | 100 / 10s |
| Gamma `/markets` | 300 / 10s |
| Data `/positions` | 150 / 10s |

For our agent's expected load (≤ 1 order/sec per market, monitoring O(10) markets) we are nowhere near these ceilings. The bigger risk is the **WebSocket feed** for real-time book updates; we'll prefer the WS over polling once we wire it in.

**No documented anti-bot measures** beyond Cloudflare rate-shaping. There is no CAPTCHA on API endpoints. Account-wide blacklisting is reserved for balance/allowance violators (e.g., orders without backing collateral).

---

## 6. Heartbeats (anti-stale-orders)

Once a session begins posting heartbeats (`POST /v1/heartbeats`), missing one for **>10 s** triggers the server to **cancel all open orders** for that account. This is opt-in — if we never call `postHeartbeat()` we never enter that contract — but for a 24/7 agent we should opt in: it bounds the blast radius of a bot crash to ≤10 s of stale resting orders.

Cadence: ping every 5 s, pass the prior `heartbeat_id` to chain the session.

---

## 7. Geographic Restrictions

Order placement is blocked from **33 countries/territories**, including **US, UK, Canada (Ontario), France, Germany, Australia, Japan**, OFAC-sanctioned states, and ON/Crimea/Donetsk/Luhansk regions. Detection is IP-based (`GET https://polymarket.com/api/geoblock`).

Tiers:

- **Fully blocked** — cannot open or close.
- **Close-only** — Poland, Singapore, Thailand, Taiwan can exit but not open.
- **UI-only block** — Japan: API works, web UI doesn't.

**Implication for our agent:** the runtime must run from a non-blocked region. Recommended: AWS `eu-west-1` (Ireland — not blocked) or a non-US cloud region with stable Polygon RPC. We must also document this for ops: VPN-tunnelling out of a blocked region is ToS-questionable and we will not pursue it.

---

## 8. USDC.e / pUSD Approval Flow

Before the first order, the **funder** address must approve the relevant exchange contracts to spend its pUSD (collateral) and CTF tokens (outcome shares). This is a one-time on-chain transaction per (funder, contract) pair.

Contracts the SDK references (Polygon mainnet):

| Contract | Role |
|---|---|
| **CTF Exchange** | Settles non-neg-risk markets |
| **Neg Risk CTF Exchange** | Settles neg_risk multi-outcome markets |
| **Neg Risk Adapter** | Wraps positions for neg_risk markets |
| **CTF (Conditional Tokens)** | ERC-1155 outcome shares — needs `setApprovalForAll(true)` for both exchanges |
| **pUSD (USDC.e)** | ERC-20 collateral — needs `approve(MAX_UINT256)` for both exchanges + adapter |

The SDK's `updateBalanceAllowance()` triggers the on-chain approval via the funder wallet. The **wallet-service** package will own this flow: at startup, check `getBalanceAllowance()`, top up approvals if missing. Do this once, not per-trade.

EOA funder must also hold **POL** (≥ ~0.5 POL) for gas on signing/cancellation broadcasts.

---

## 9. Latency Profile

Measured from this dev environment (residential ISP, ~400 ms RTT to Cloudflare PoP):

| Operation | Median | Notes |
|---|---|---|
| `getServerTime` | 612 ms | TLS + Cloudflare + app |
| `getOrderBook` | 619 ms | Same — network-bound |
| `getMidpoint`/`getPrice` | ~620 ms | |
| Order signing (local) | <5 ms | EIP-712 hash + ECDSA |
| `POST /order` (estimated) | ~700–900 ms from this box | Adds DB write + matcher |

**This is not the latency the production agent will see.** Hosted in a colocated cloud region (suggest AWS `eu-west-1` or `eu-central-1`, both unblocked and close to Polymarket's Cloudflare anycast), expect:

- Public read: **50–150 ms p50**.
- `POST /order`: **150–300 ms p50**.

For an arbitrage strategy this is fine; for HFT-style market making against centralised crypto exchanges it is not. The agent's strategy budget should assume **≥200 ms one-way** to Polymarket and design around that.

---

## 10. Gotchas & Limitations

1. **Heartbeat cancels orders on disconnect.** Good for safety, but if our process restarts mid-session we must either replay open orders or accept the cancellation. Document in runbook.
2. **EIP-712 signatures are per-order.** L2 headers alone do not authorise an order body — losing the L2 secret leaks read access only, but loses the wallet's private key = full takeover. Wallet-service must keep the private key in HSM/KMS.
3. **`createOrDeriveApiKey()` is not idempotent on `nonce` collision.** If we rotate the `nonce` we mint *new* creds; we must either always pass `nonce=0` or persist the chosen nonce.
4. **Tick-size cache.** SDK caches tick size per token (default 1 hr TTL). If a market's tick changes (rare but happens at re-list), call `clearTickSizeCache(tokenID)`.
5. **First market in `getMarkets()` is a closed 2023 NCAAB market** — the API returns a mix of historical and live markets. Always filter `active && !closed && accepting_orders`. Use `getSamplingMarkets()` if we want only reward-eligible markets.
6. **`neg_risk` markets are different.** Multi-outcome markets (e.g., "who wins the election") use a different exchange contract. Trade routing code must branch on `neg_risk`.
7. **No native MARKET order type.** Use `FOK` for "all or nothing at current price" and `FAK` for "take what's there, drop the rest". Both via `createAndPostMarketOrder()`.
8. **Min order size varies per market** (`minimum_order_size`, often 5–15 shares). Below the minimum, the order is rejected with `INVALID_ORDER_MIN_TICK_SIZE`/`INVALID_ORDER_NOT_ENOUGH_BALANCE`. Pre-validate.
9. **Geo-block.** Operating from the US is a ToS violation. Production deploy must live in an unblocked region.
10. **Cancellation is async on-chain for some flows.** `cancelOrder` returns immediately but the on-chain cancel can take a block; rely on `getOpenOrders` for ground truth, not cancel-response status alone.

---

## 11. SDK Snapshot

```
package: @polymarket/clob-client
version: 5.8.1
runtime deps: viem ^2.46.3, axios ^1.0.0, browser-or-node ^2.1.1,
              @polymarket/builder-signing-sdk ^1.0.0
peer (signing): ethers v6 OR viem v2 — we use ethers v6 in wallet-service
chain const: Chain.POLYGON = 137
exports: ClobClient, Side, OrderType, SignatureType, ApiKeyCreds, Trade,
         OpenOrder, OrderBookSummary, ApiError, ExchangeOrderBuilder, …
```

The SDK is actively maintained (last publish ~1 month before this report). A `clob-client-v2` package exists but is in early adoption — we'll stick with v5.x until v6/v2 is stable.

---

## 12. Verdict — **GO**

The Polymarket CLOB API meets every functional requirement for an automated-trading agent:

- ✅ Stable REST + WS surface, public read endpoints, well-documented L2 auth.
- ✅ Official, maintained TypeScript SDK with a complete method catalogue.
- ✅ Order types (GTC / GTD / FOK / FAK) cover both passive and aggressive strategies.
- ✅ Rate limits an order of magnitude above our expected load.
- ✅ Heartbeat mechanism gives us a safety hand-brake for unattended operation.

**Mitigations to land before mainnet:**

1. Deploy in an unblocked region (eu-west-1) and document the constraint.
2. Wallet-service stores private key + API creds in encrypted vault; nonce persisted alongside.
3. One-time approval bootstrapper (`updateBalanceAllowance`) wired into wallet-service init.
4. Heartbeat opted-in for live sessions; restart playbook accounts for auto-cancellation.
5. Strategy budgets assume ≥200 ms one-way latency; HFT-class strategies are out of scope.

---

## References

- [Polymarket API docs index](https://docs.polymarket.com/api-reference/introduction)
- [Authentication guide](https://docs.polymarket.com/api-reference/authentication.md)
- [Rate limits](https://docs.polymarket.com/api-reference/rate-limits.md)
- [Geo-block](https://docs.polymarket.com/api-reference/geoblock.md)
- [Order creation](https://docs.polymarket.com/trading/orders/create.md)
- [Public methods](https://docs.polymarket.com/trading/clients/public.md)
- [L2 methods](https://docs.polymarket.com/trading/clients/l2.md)
- [Trading quickstart](https://docs.polymarket.com/trading/quickstart.md)
- [@polymarket/clob-client on npm](https://www.npmjs.com/package/@polymarket/clob-client)
- [GitHub: Polymarket/clob-client](https://github.com/Polymarket/clob-client)
- [CLOB OpenAPI spec](https://docs.polymarket.com/api-spec/clob-openapi.yaml)
