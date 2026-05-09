# Prediction Markets Landscape — Where Can PrivateBet Operate Without Bridging?

**Date:** 2026-05-06
**Author:** PrivateBet research
**Question:** Are there prediction markets on **Ethereum mainnet** (where ZAMA fhEVM works today) that could let us skip the Polygon bridge and cut per-bet cost from ~$13–35 round-trip to ~$0.20–0.40?
**Verdict:** **No serious one exists.** Augur v2 is the only liquid-ish prediction market on Ethereum mainnet today, with **~$1.7M TVL and is mid-fork** — not a viable counterparty for an automated agent. **All meaningful prediction-market liquidity in 2026 sits on Polygon, Base, Solana, Gnosis, or app-chains** — every choice still requires a bridge. A multi-market strategy is **architecturally good but does not change the unit economics**.

---

## 1. TL;DR — chain matrix

| Market | Primary chain(s) | Settlement asset | Public API | Order types | 2026 volume / TVL | Bridge needed for ZAMA-on-Ethereum? |
|---|---|---|---|---|---|---|
| **Polymarket** | Polygon (137) | **pUSD** (1:1 USDC.e wrapper, since Apr 28 2026) | REST CLOB v2 + WebSocket | Limit + market | $1.99B/mo (Apr 2026); $514M TVL | **Yes** — Polygon bridge |
| **Kalshi** | Off-chain CLOB (CFTC-regulated); **on-chain leg on Solana** | USD bank rails; USDC on Solana | REST + WebSocket | Limit + market | **$5.42B/mo (Apr 2026, market leader)** | **No EVM** — not addressable from ZAMA |
| **Limitless** | **Base (8453)** | USDC (native) | REST + WebSocket CLOB | Limit + market | $200M+/mo (Jan 2026); $1B+ cumulative | **Yes** — Base ↔ Ethereum bridge |
| **Azuro** (protocol, not a frontend) | Polygon (137), Gnosis (100), Base (8453), Chiliz (88888); legacy V2 on Arbitrum + Linea | **Per-chain**: USDT (Polygon), wxDAI (Gnosis), WETH (Base), CHZ (Chiliz) | `@azuro-org/sdk` + The Graph subgraphs | Pool-style AMM + LP betting | $400M+ cumulative across all frontends | **Yes** (and not even USDC-denominated except on legacy Arbitrum) |
| **Omen** (DXdao) | **Gnosis (100)** | wxDAI / sDAI | Subgraph (no first-party REST) | Conditional-token AMM | Effectively dormant (no dev since 2022); revived only via OLAS Predict AI agents | **Yes** — Gnosis bridge (and tiny liquidity) |
| **Augur v2** | **Ethereum mainnet (1)** | DAI (legacy); REPv2 governance | Subgraph + on-chain (no maintained REST) | Limit-order via 0x | **~$1.7M TVL; mid-fork (summer 2026)** | **No** — but unusable due to liquidity + ongoing fork |
| **Augur Turbo** | Polygon (137) | USDC.e | Subgraph | AMM (Balancer-based) | ~Inactive | Yes |
| **SX Bet** | **SX Network** (sovereign EVM appchain, Polygon-SDK) | USDC | REST + WebSocket | Hybrid off-chain orderbook + on-chain settlement | $50M+ cumulative; sports-only | **Yes** — multi-hop (SX→Eth) |
| **Myriad Markets** | **Abstract** (zk rollup) + BNB Chain | USDC.e on Abstract; USD1 on BNB | Trust Wallet integration; web app | AMM | $167M+ cumulative; $100M USDC volume | **Yes** — Abstract bridges are nascent |
| **Drift BET** | **Solana** | 30+ tokens as collateral | Drift SDK | Perp-style | New (2026) | **No EVM** |
| **Truemarkets** | **Ethereum + Base** (claimed); on-chain settlement via Uniswap V3 | USDC (Base) | TrueX REST API (CeFi side); on-chain side undocumented | Spot-style | Launched 2025 with Vitalik backing; volume not disclosed | **Possibly no bridge** if Ethereum side is real — see § 4 caveat |

**The hard fact:** if you draw a line at "live, liquid, public-API, EVM, USDC-denominated prediction market on a chain where ZAMA fhEVM is deployable today," the line crosses **zero markets**.

---

## 2. Per-platform deep dive

### 2.1 Polymarket — the elephant
- **Chain:** Polygon PoS (137) only. There is **no** Ethereum mainnet deployment, no Base deployment, no L2 deployment.
- **Settlement asset:** as of CLOB v2 (April 28 2026), **pUSD** — a regular Polygon ERC-20 backed 1:1 by USDC.e via the Collateral Onramp. Old USDC.e contracts are deprecated as collateral; the wrapper is mandatory for v2.
- **API:** REST CLOB + WebSocket; documented at `docs.polymarket.com`. Order signing via EIP-712. The API is mature and is what the OPE-267 PoC client wraps.
- **Liquidity:** $1.99B taker volume in April 2026; $514M TVL post-CLOB-v2. **Dwarfs every other on-chain prediction market.**
- **Why it stays on Polygon:** custody of ~$500M, deep market-maker integration, MetaMask UX optimized for Polygon, and a regulatory posture (CFTC settlement Feb 2025) that prefers a stable jurisdictional footprint. Polymarket has *never* signaled Ethereum-mainnet plans. Treat this as fixed.
- **Verdict for PrivateBet:** primary target market; bridge is unavoidable. This is the OPE-266 plan as written.

### 2.2 Kalshi — biggest, wrong stack
- Kalshi overtook Polymarket in 2026: **$5.42B taker volume in April 2026** vs Polymarket's $1.99B.
- **Architecture:** centralized order book under CFTC oversight (DCM since 2021). Ledger is internal; settlement is via USD bank rails. Recently launched an **on-chain leg on Solana** for crypto-native users.
- **Why irrelevant to PrivateBet:** Kalshi is not an EVM target. The on-chain leg is Solana-only. ZAMA fhEVM is EVM-only. Even if both ever bridged, Kalshi requires KYC for fiat rails — incompatible with the "confidential betting agent" thesis.
- **Verdict:** ignore. Worth tracking only as competitive intelligence.

### 2.3 Limitless — best-fit if we ever get to Base
- **Chain:** Base (8453) only.
- **Settlement asset:** **native USDC** (not USDC.e). Every YES/NO share pair is fully collateralized 1:1 by USDC.
- **API:** REST + WebSocket CLOB. Authentication via wallet signature, order creation via EIP-712, order submission via REST. Docs at `docs.limitless.exchange`.
- **Liquidity:** $200M+ monthly volume in January 2026, $1B+ cumulative. Hourly + daily resolution markets — well-suited to a high-frequency trading agent.
- **Why interesting for PrivateBet:** USDC-native is a much cleaner integration than Polymarket's pUSD wrapper hack. If ZAMA ever ships Base host-chain support, Limitless becomes the **highest-priority integration target after Polymarket**.
- **Catch:** ZAMA does *not* support Base today (see [zama-chain-support.md](./zama-chain-support.md)). For now, Limitless requires the same kind of Eth↔Base bridge as Polymarket requires Eth↔Polygon. Across SDK handles both routes equivalently — bridge cost ~$3–6 each leg + $5 total round-trip.

### 2.4 Azuro — protocol, not a chain
- **Chains (V3, current):** Polygon (USDT), Gnosis (wxDAI), Base (WETH), Chiliz (CHZ). **V2 legacy** also on Arbitrum (USDC.e) and Linea (USDA).
- **What it is:** a *protocol layer* that provides liquidity-pool-backed odds and a betting engine for ~30 third-party frontends (BetSwirl, Azuro Sport, etc.). Azuro itself is not a destination — it's the rails.
- **API:** `@azuro-org/sdk`, `@azuro-org/toolkit`, `@azuro-org/dictionaries` NPM packages + The Graph subgraphs per chain. Reasonably mature.
- **Order model:** AMM-style — bettors bet *against an LP pool*, not against each other. There's no peer-to-peer order book; odds come from a curated parameterized model. This has a real consequence: **Azuro doesn't expose limit orders**. You bet at the offered odds or you don't bet.
- **Why interesting in principle:** Azuro is theoretically chain-agnostic. Anyone could deploy it on Ethereum mainnet. In practice, Azuro DAO has shown no public intent to do so — gas would kill the LP model on L1.
- **Cumulative volume:** $400M+ across all chains and frontends. Per-chain volume on any given network is **a fraction of Polymarket's monthly throughput**.
- **Verdict:** secondary integration for sports-specific betting if needed; not a substitute for Polymarket. Doesn't help the bridge problem.

### 2.5 Omen — declining-but-alive on Gnosis Chain
- **Chain:** Gnosis Chain (100). Brief Polygon presence years ago; effectively single-chain now.
- **Settlement asset:** wxDAI / sDAI (yield-bearing DAI on Gnosis).
- **Maintenance status:** DXdao has **not actively developed Omen since 2022**. The protocol still works because it's stateless smart contracts on a stable chain, but no UI improvements, no liquidity incentives, no marketing.
- **Renaissance via OLAS Predict:** the OLAS network's autonomous-agent ecosystem has revived Omen as an **AI-agent-only market** — 361 daily active AI agents, 8.2M+ transactions on Gnosis Chain in late 2025. This is interesting noise but not a high-liquidity human-tradable book.
- **Verdict:** ignore for production. Worth watching if PrivateBet ever wants to test against an AI-agent-only counterparty pool — but it's the wrong chain for ZAMA, and the asset (wxDAI) is the wrong denomination.

### 2.6 Augur v2 — the only Ethereum-mainnet option, and it's a ghost
- **Chain:** Ethereum mainnet (1). The original 2018 Augur v1 contracts are all on L1. Augur v2 (2020) refactored onto 0x for limit-order matching, still on L1.
- **Settlement asset:** DAI (default reporting bond and trade settlement token); REPv2 for governance and dispute escalation. **Not USDC-native.**
- **TVL:** **~$1.7M.** Reduce that by typical concentration in long-tail dispute-bond positions and the *tradable* notional is much smaller.
- **2026 status:** **mid-fork.** Lituus Foundation took stewardship in 2025; a fork was triggered April 2026 forcing all REPv2 holders to migrate over a June–August window. Two dev teams (Dark Florists shipping AugurCP on Eth mainnet; Lituus Labs shipping a modern L2 deployment) are in parallel work.
- **API:** subgraph + on-chain access only. The legacy Augur SDK exists but is unmaintained. No production REST/WebSocket.
- **Verdict for PrivateBet:** **Augur v2 is the only "no bridge needed" prediction market on a ZAMA-supported chain.** That sounds great until you look closer. Liquidity is too thin to support automated trading at any meaningful size; the fork makes any market created today potentially invalid post-migration; and the asset is DAI, not USDC. It's a research curio, not a production target. **Skip.**
- **The Lituus Labs L2 deployment is worth watching** — if they pick a low-gas L2 *and* ZAMA gets there in 2026, that's a meaningful unlock, but neither side has committed to a chain.

### 2.7 SX Bet / SX Network — sport-only sovereign appchain
- **Chain:** SX Network — its own EVM-compatible chain built on Polygon SDK. Chain ID 416 (mainnet). Hybrid off-chain order book + on-chain settlement.
- **Settlement asset:** USDC.
- **API:** REST + WebSocket; documented and used by sportsbook frontends.
- **Volume:** $50M+ cumulative. Niche: **sports-only** — no politics, crypto, or culture markets.
- **Why irrelevant for PrivateBet right now:** sport-only narrows the agent's market universe; sovereign appchain means bridging is harder than mainstream L2s; USDC on SX Network requires its own bridge route. Nothing about this beats Polymarket on any axis except sports-specific liquidity for niche events.

### 2.8 Myriad Markets — Abstract chain, surprising volume
- **Chain:** Abstract (zk rollup; chain ID 2741) primary; BNB Chain secondary.
- **Settlement asset:** USDC.e on Abstract. USD1 (World Liberty Financial stablecoin) on BNB.
- **Volume:** $167M+ cumulative as of January 2026; $100M+ in USDC trading volume; 400k+ active traders.
- **Why interesting:** real volume on a low-gas zk rollup. Trading already cheap natively.
- **Why irrelevant for PrivateBet today:** Abstract is not a ZAMA host chain; bridging Abstract↔Ethereum is nascent (Across has limited Abstract support as of May 2026); USD1 is a niche stablecoin. **Track but don't integrate.**

### 2.9 Drift BET — Solana-only
- **Chain:** Solana. Drift's prediction market product launched late 2025.
- **Collateral:** 30+ tokens supported, USDC is a primary one.
- **Why irrelevant:** non-EVM. ZAMA fhEVM has no SVM equivalent and won't for a long time (the Solana SPL listings on `docs.zama.org` are LayerZero OFT token bridges, not fhEVM coprocessor deployments — verified in the chain-support audit).

### 2.10 Truemarkets — needs verification before betting on it
- **Claim:** built on Ethereum + Base; on-chain settlement via Uniswap V3; launched 2025 with Vitalik Buterin's NFT backing ($107k of patron NFTs in Aug 2024).
- **Reality check:** the public-facing apex now appears to be **TrueX, a centralized exchange** (CeFi REST/WS API at `docs.truex.co`). Whether the on-chain prediction-market product (the original "Truemarkets" pitch) is still operating at meaningful volume on Ethereum L1, or whether it's been deprioritized in favor of TrueX's CeFi exchange, is unclear from public sources.
- **What we'd need to confirm before integrating:**
  1. Are there live Truemarkets prediction-market contracts on Ethereum L1 as of May 2026? (Check Etherscan, `network_config.json` in `truemarketsorg/true-contracts`.)
  2. Is there active liquidity? Daily volume, open interest.
  3. Does the on-chain side have a documented API or only EVM RPC?
- **Verdict:** **the only realistic Ethereum-mainnet candidate other than Augur**, but with too many unknowns to commit to without a focused 1-week investigation. Worth a follow-up ticket.

---

## 3. Why "Ethereum mainnet prediction market" is structurally rare

It's not an accident that Polymarket sits on Polygon and Limitless on Base while Ethereum mainnet only hosts the dying Augur. The reasoning is symmetric for almost every prediction-market project:

- **Per-bet gas is a tax on small bets.** A $5 yes/no shares trade with $2 of gas is unviable. L1 gas at 30 gwei costs $1–3 per CLOB or AMM action. L2 / Polygon gas costs $0.005–0.05.
- **Order book latency.** Polymarket's CLOB needs ~2-second blocks for live odds updates during sports events; Ethereum's 12-second blocks are too slow for a UX that competes with DraftKings.
- **MEV and front-running.** L1 mempools are adversarial enough that AMM-style markets get sandwiched aggressively. Polygon and Base both have less hostile mempools (and Polymarket runs sequencers/relayers that further suppress front-run risk).
- **Risk-of-fork legacy.** Augur was specifically designed for Ethereum L1 with REP fork-based dispute resolution; everything since has decided that fork resolution is solvable off-chain (UMA optimistic oracle for Polymarket, conditional tokens framework for Omen) and so the L1 host requirement disappeared.

The structural conclusion: **the prediction-market product category will not move *back* to Ethereum mainnet absent a force majeure** (post-merge L1 gas drop to <$0.05/tx — not happening — or regulatory mandate). PrivateBet should plan accordingly.

---

## 4. What this means for PrivateBet's economics

### 4.1 Multi-market strategy: architecturally yes, economically no
Building a `PredictionMarketAdapter` interface so the agent can route bets across Polymarket / Limitless / Azuro / Omen is **good engineering** for three reasons:
1. **Vendor risk.** If Polymarket has a regulatory shutdown (it nearly did in early 2025), other markets remain.
2. **Arbitrage opportunities.** The same event traded on Polymarket and Limitless can have 1–3 cent spreads — an agent that can route to the best price beats a single-market agent.
3. **Specialization.** Limitless is hourly-crypto-heavy; Azuro/SX are sports-heavy; Polymarket is politics-and-everything. An agent that routes by category gets better fills.

But it does **not** materially change the cost model:

| Bridge route | Per round-trip bridge cost | Latency | Available liquidity |
|---|---|---|---|
| Eth ↔ Polygon (Polymarket) | $12–20 (Across) | 5–20 min | $500M TVL, $1.99B/mo |
| Eth ↔ Base (Limitless) | $10–18 (Across or CCTP for native USDC) | 5–15 min | $200M/mo |
| Eth ↔ Gnosis (Omen) | $10–15 (xDAI bridge or Connext) | 5–30 min | Effectively zero |
| Eth ↔ Arbitrum (Azuro V2 legacy) | $10–18 (Across or Stargate) | 3–10 min | <$10M |
| **Eth → Eth (Augur on L1)** | **$0** | n/a | **<$1.7M, mid-fork — unusable** |

The "Eth → Eth" row is the only no-bridge path, and it's a dead end.

For every viable target market, **the bridge cost is bounded by Ethereum L1 gas, not by the bridge protocol fee**. Across charges 0.05–0.15%; CCTP charges 0%. The cost is the L1 transaction itself (wrap, approve, deposit, claim — each $1–3 at 30 gwei). Cutting from Polygon to Base saves nothing on the L1 side. **The only thing that actually reduces the bridge tax is ZAMA shipping a non-Ethereum host chain** (per [zama-chain-support.md](./zama-chain-support.md)).

### 4.2 Where multi-market does change the picture
- **If ZAMA ships Base support** (no public timeline, but Base is a frequently-rumored next chain in their Discord), then Limitless becomes a no-bridge target with USDC-native settlement and a real CLOB API. **That's a step-change.** Worth monitoring weekly.
- **If Lituus Labs picks an L2 for AugurCP** that ZAMA also supports, then Augur becomes viable for ETH-native confidential betting — but this is a chain of two unlikely conditions.
- **For the "deposit-once, bet-many, withdraw-occasionally" UX** (recommended in the bridge PoC report), the bridge is amortized over many bets. So the bridge tax goes from $20/bet → $20/100 bets = $0.20/bet *if the user bets 100 times before withdrawing*. Multi-market helps here because more markets = more bets per deposit window = better amortization.

### 4.3 Recommended posture
**Phase 2 (PoC):** focus on Polymarket only. Don't waste time on multi-market until the orchestration is solid for one market. Augur is a tempting "look ma, no bridge" demo target, but the practical issue is liquidity is below the threshold where any agent strategy works.

**Phase 3 (production):** add **Limitless on Base** as the second adapter. Reasons:
1. USDC-native (cleaner than pUSD).
2. Hourly markets give the agent more trading reps.
3. Different bridge route (Eth↔Base via CCTP is cheaper than Eth↔Polygon if user already has native USDC).
4. ZAMA's likeliest next host chain is widely speculated to be a major L2 (Polygon or Base); if Base lands first, Limitless becomes the no-bridge primary.

**Phase 4 (opportunistic):** add Azuro for sports-only flows where its odds model beats Polymarket's CLOB liquidity for niche games. Don't build this until there's user demand.

**Skip permanently:** Omen, Augur v2, SX Bet, Drift BET, Kalshi. None align with PrivateBet's stack and product thesis.

**Investigate once:** Truemarkets — is the on-chain Ethereum L1 product still alive and liquid? **One-week scoping ticket** worth opening separately.

---

## 5. Adapter interface implications

Whatever multi-market support gets built, the adapter shape should be:

```ts
interface PredictionMarketAdapter {
  readonly chainId: number;
  readonly settlementToken: ERC20Address;
  readonly orderTypes: ('market' | 'limit')[];
  readonly liquidityModel: 'clob' | 'amm' | 'pool';

  listMarkets(filter: MarketFilter): Promise<Market[]>;
  getQuote(marketId: string, side: 'YES' | 'NO', size: bigint): Promise<Quote>;
  placeOrder(order: Order): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  getPosition(marketId: string, account: Address): Promise<Position>;
}
```

This matches the OPE-267 PolymarketClient skeleton. Expect three concrete implementations long-term: Polymarket (CLOB on Polygon), Limitless (CLOB on Base), Azuro (pool-style on multiple chains, no `placeOrder` for limit). Keep the interface minimal so non-CLOB venues (Azuro, Omen) can be plugged in without bending CLOB-shaped abstractions.

---

## 6. Open questions to revisit

1. **ZAMA's next host chain.** If Base, Limitless integration becomes high priority. If Polygon, single-chain Polymarket integration becomes trivial. If neither, the bridge layer is permanent and we should productionize it.
2. **Truemarkets on-chain status.** Worth a 1-week scoping ticket: is the Ethereum L1 prediction-market deployment still live and liquid? If yes, this is the only no-bridge target with potentially-real volume.
3. **Lituus Labs / AugurCP L2 choice.** If they pick a chain ZAMA supports, Augur becomes viable.
4. **Polymarket cross-chain UX.** Polymarket has no Ethereum L1 contracts and has signaled none, but rumors of a "Polymarket Plasma" L2 surface periodically. Confirm by quarterly check of `docs.polymarket.com` deployment addresses.
5. **Kalshi crypto-rails expansion.** They've launched Solana on-chain markets in 2026 — will they ever launch Ethereum L1 or L2 markets? Probably not (regulatory friction), but a periodic check is cheap.

---

## 7. Final recommendation

**Single-market for Phase 2; two-market (Polymarket + Limitless) for Phase 3.** Multi-market does not eliminate the bridge tax — only ZAMA shipping a non-Ethereum host chain does that. The architecture should support 2–3 adapters cleanly so we can flip the primary venue when ZAMA's chain support changes, but don't burn cycles on Omen / Augur / SX / Kalshi / Drift — they don't fit the EVM + USDC + decent-liquidity + open API criteria simultaneously.

The Polymarket-on-Polygon + Across-bridge plan from OPE-266 remains the right Phase 2 target.

---

## 8. Sources

### Per-platform
- [Polymarket — CLOB v2 / pUSD upgrade (Apr 28 2026)](https://help.polymarket.com/en/articles/14762452-polymarket-exchange-upgrade-april-28-2026)
- [Polymarket TVL crosses $500M post-CLOB-v2 (Apr 30 2026)](https://www.cryptotimes.io/2026/04/30/polymarkets-clob-v2-goes-live-with-1m-rewards-new-pusd-token/)
- [April 2026 prediction market volumes — Kalshi $5.42B vs Polymarket $1.99B](https://news.bitcoin.com/prediction-market-traders-push-april-2026-volume-to-8-6b-kalshi-takes-the-lead/)
- [Kalshi launches on-chain on Solana](https://finance.yahoo.com/news/kalshi-pushes-further-crypto-chain-222753575.html)
- [Limitless Exchange docs](https://docs.limitless.exchange/)
- [Limitless on Base — DappRadar guide](https://dappradar.com/blog/the-ultimate-guide-to-defi-prediction-markets-with-limitless-on-base)
- [Azuro deployment addresses (Polygon / Gnosis / Base / Chiliz)](https://gem.azuro.org/hub/blockchains/deployment-addresses)
- [Azuro × Chiliz partnership (sports prediction markets)](https://medium.com/chiliz/azuro-integration-enables-developers-to-build-advanced-sports-prediction-platforms-on-chiliz-chain-ceb1b65316bd)
- [Omen — DXdocs](https://dxdocs.eth.limo/docs/Products/omen/)
- [Gnosis: AI agents (OLAS Predict) reviving Omen-style markets](https://www.gnosis.io/blog/the-rise-of-ai-agents-in-prediction-markets-how-gnosis-infrastructure-is-powering-the-future-of-information-finance)
- [Augur Reboot 2025 Roadmap](https://www.augur.net/blog/augur-reboot-2025/)
- [Augur fork begins April 2026](https://bitcoinfoundation.org/news/prediction-markets/augur-fork-begins-dispute/)
- [SX Network architecture overview](https://medium.com/sportx-bet/sx-network-the-blockchain-for-prediction-markets-603badcdad3b)
- [Myriad Markets — USDC on Abstract chain](https://decrypt.co/308896/prediction-market-myriad-launches-usdc-markets)
- [Drift BET on Solana](https://www.rootdata.com/news/246872)
- [Truemarkets official launch as decentralized prediction market](https://coingape.com/brandtalk/pulse/truemarkets-officially-launches-as-a-decentralized-prediction-market/)
- [TrueX REST API (CeFi side of True Markets)](https://docs.truemarkets.co/apis/cefi/rest/v1)

### Cross-cutting
- [Top 10 Crypto Prediction Markets 2026 (QuickNode)](https://www.quicknode.com/builders-guide/best/top-10-crypto-prediction-markets)
- [Best Decentralized Prediction Markets, 2026 (CryptoNews)](https://cryptonews.com/cryptocurrency/best-decentralized-prediction-markets/)
- [DefiLlama: Prediction Market category](https://defillama.com/protocols/prediction-market)
- [Top Prediction Market APIs in 2026 (Medium / Tinnerholm)](https://medium.com/@samuel.tinnerholm/the-top-prediction-market-apis-in-2026-ecb02baae641)
- [UMA Optimistic Oracle (Polymarket settlement layer)](https://docs.uma.xyz/protocol-overview/example-projects)

### Prior PrivateBet research
- [`docs/reports/zama-chain-support.md`](./zama-chain-support.md) — chains where ZAMA fhEVM is deployable today.
- [`docs/reports/zama-fhevm-validation.md`](./zama-fhevm-validation.md) — OPE-265 validation of the fhEVM stack.
- [`docs/reports/bridge-poc.md`](./bridge-poc.md) — OPE-266 Polygon ↔ Ethereum bridge PoC.
- [`docs/reports/polymarket-clob-validation.md`](./polymarket-clob-validation.md) — OPE-267 Polymarket CLOB integration plan.
- [`docs/reports/e2e-validation.md`](./e2e-validation.md) — end-to-end Phase 2 validation synthesis.
