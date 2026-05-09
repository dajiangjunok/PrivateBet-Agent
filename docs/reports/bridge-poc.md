# Polygon ↔ Ethereum Bridge Validation — USDC Path for PrivateBet

**Ticket:** OPE-266 — 跨链桥 PoC — Polygon ↔ Ethereum (ZAMA fhEVM) 资金流转验证
**Date:** 2026-05-06
**Author:** PrivateBet research
**Verdict:** **GO (with cost caveats)** — see [§ 10 Verdict](#10-verdict-goco-no-go) below.

---

## 1. Executive summary

| Question | Answer |
|---|---|
| Does a "Polygon ↔ ZAMA" bridge exist? | **No, and it is not the right framing.** ZAMA fhEVM is a coprocessor on Ethereum mainnet (see [OPE-265 report](./zama-fhevm-validation.md)). What we actually need is a **Polygon ↔ Ethereum L1** bridge for USDC. |
| Is Polygon ↔ Ethereum L1 a solved problem for USDC? | **Yes.** Multiple production bridges with billions $ in cumulative volume: Across, Stargate (LayerZero), Hop, Polygon PoS native, Circle CCTP. |
| Can we move USDC round-trip in **< 30 minutes**? | **Yes.** Across or CCTP v2 routinely settle one-way in 1–5 min. Round-trip end-to-end through ZAMA wrap/unwrap: **5–20 min**. |
| Can we move USDC round-trip for **< $5**? | **No, not on Ethereum mainnet today.** L1 gas dominates: a single Ethereum-side ERC20 + bridge tx pair costs $5–15 at ~30 gwei. **Realistic round-trip: $15–35.** |
| Polymarket collateral variant? | **pUSD (formerly USDC.e)** — the *bridged* USDC, not Circle's native USDC. This rules out the cheapest CCTP-only path and forces either (a) a swap leg on Polygon, or (b) a bridge that handles USDC.e directly. |
| Recommended bridge for the PoC? | **Across Protocol.** Best fit: native USDC.e support both directions, ~3–5 min latency, optimistic intent model, low protocol fee (~0.05–0.15%). |
| Long-term recommendation? | **Wait for ZAMA Polygon host-chain support (H1 2026 roadmap).** Eliminates the Ethereum-L1 gas tax entirely. Bridging is a tactical bridge, not the strategic answer. |

---

## 2. The actual cross-chain shape

The OPE-265 report established that **ZAMA fhEVM is not a chain.** It is a coprocessor pattern layered onto a host chain — currently Ethereum mainnet only. So the "Polygon ↔ ZAMA" leg in the original spec rephrases to:

```
Polygon (Polymarket / pUSD)  ◀── USDC bridge ──▶  Ethereum mainnet (cUSDC wrapper / fhEVM)
```

Three legs need to work end-to-end for a confidential bet:

```
            ┌──────────────────────────────── DEPOSIT ───────────────────────────────┐
User USDC.e ─▶ bridge ─▶ USDC (L1) ─▶ approve+wrap ─▶ cUSDC (L1, encrypted)
  Polygon                  Ethereum                       Ethereum (ZAMA)
                                                              │
                                                              │ encrypted transfers,
                                                              │ encrypted bet to escrow,
                                                              │ encrypted payout
                                                              ▼
            ┌──────────────────────────────── WITHDRAW ──────────────────────────────┐
cUSDC (L1) ─▶ unwrap ─▶ USDC (L1) ─▶ bridge ─▶ USDC (Polygon) ─▶ swap ─▶ USDC.e (Polygon)
  Ethereum (ZAMA)         Ethereum                  Polygon                  Polygon
                              │                                              │
                              │ decryption oracle                            │ if user wants
                              │ callback (1–5 min)                           │ to bet again
                                                                              ▼
                                                                          Polymarket
```

The asymmetry matters: bridges typically deal in **native USDC** (Circle's mintable USDC), while Polymarket uses **USDC.e** (the legacy bridged token). The two are not the same address and not freely interchangeable on-chain — you swap between them on a DEX (Uniswap V3 has a deep USDC↔USDC.e pool on Polygon, ~stable peg, ~0.01% slippage at $1k size).

---

## 3. Bridge comparison

All numbers reflect typical operating conditions on Ethereum mainnet at moderate gas (~30 gwei). Costs include both protocol fees and L1/L2 gas. "Latency" is end-to-end finalized transfer.

| Bridge | One-way latency | Protocol fee | L1 gas | L2 gas | USDC variant | Notes |
|---|---|---|---|---|---|---|
| **Across** | **~3–5 min** | 0.05–0.15% + relayer fee (~$1–2 flat) | ~$3–6 | ~$0.02 | Native USDC + **USDC.e** | Optimistic intent; relayer fronts liquidity on dest chain. Best USDC.e support among third parties. |
| Circle CCTP v2 | 30 s – 2 min | **0** | ~$3–7 | ~$0.02 | **Native USDC only** | Burn-and-mint via Circle attestation. Fastest and cheapest, but does not move USDC.e. |
| Stargate (LayerZero) | ~1–3 min | 0.04–0.06% + LZ msg fee (~$0.50–2) | ~$5–10 | ~$0.05 | Native USDC (uses CCTP under hood) | Unified-pool model; deeper liquidity than Across at large size. |
| Hop Protocol | ~5–10 min | 0.10–0.30% + bonder fee (~$0.50–2) | ~$3–6 | ~$0.05 | hUSDC + canonical USDC | AMM model; introduces hUSDC intermediate token, slightly worse UX. |
| Hyperlane | ~1–5 min | Variable (no first-party USDC route) | ~$3–6 | ~$0.05 | Generic ERC20 (warp routes) | General message-passing; would need a dedicated warp route deployment. Overkill. |
| Polygon PoS bridge (native) | **L1→L2: ~22 min**<br/>**L2→L1: 1–3 hr** | **0** | ~$3–8 | ~$0.05 | USDC.e (native bridged token) | Trust-minimized (no relayer / no third party); slow withdrawals due to checkpoint + 1-hour exit window. |

**TL;DR ranking for our use case:**

| Rank | Bridge | Why |
|---|---|---|
| 1 | **Across** | Handles USDC.e directly, fast, mature, simple SDK (`@across-protocol/sdk`). |
| 2 | Stargate | Slightly faster on native USDC, but forces an extra Polygon-side swap to pUSD. |
| 3 | Polygon PoS | Use only if trust-minimization matters more than speed — slow withdrawals are a UX killer for retail. |
| – | CCTP v1/v2 | Disqualified standalone — does not move USDC.e. Useful as a leg inside a hybrid path (e.g. Across may use CCTP internally for native USDC inventory rebalancing). |

---

## 4. End-to-end cost breakdown

Assumptions: $100 USDC bet size, Ethereum gas ~30 gwei, ETH ~$3,500, MATIC negligible, using Across for both legs.

### 4.1 Deposit path (Polygon USDC.e → Ethereum cUSDC)

| Step | Where | Cost (USD) | Time | Notes |
|---|---|---|---|---|
| 1. Approve Across SpokePool for USDC.e | Polygon | $0.01 | <30 s | One-time per user. |
| 2. `deposit(USDC.e, amount, dst=1, ...)` | Polygon | $0.02 | <30 s | Across spoke pool. |
| 3. Across relayer fronts USDC on L1 | Ethereum | (in fee) | ~3 min | Relayer fills from inventory; user pays relayer fee in input token. |
| 4. Approve cUSDC wrapper for USDC | Ethereum | $1.50 | ~30 s | One-time per user. |
| 5. `wrapper.deposit(amount)` → mints cUSDC | Ethereum | $2.00 + ZK proof verify $0.01–0.50 | ~30 s | ERC-7984 wrapper or `ConfidentialERC20Wrapped`. |
| **Across protocol fee** | – | **0.10% × $100 = $0.10** + flat $1 relayer | – | – |
| **Total deposit** | – | **~$5–8** | **~5 min** | Dominated by L1 gas for the wrap step. |

### 4.2 Withdraw path (Ethereum cUSDC → Polygon USDC.e)

| Step | Where | Cost (USD) | Time | Notes |
|---|---|---|---|---|
| 1. `wrapper.requestUnwrap(euint64 amount)` | Ethereum | $1.50 + decrypt $0.10 | ~30 s | Encrypted balance check + decryption request. |
| 2. KMS callback releases plaintext USDC | Ethereum | $0.50 (relayer pays callback gas, may be passed through) | **1–5 min** | Off-chain coprocessor round trip. |
| 3. Approve Across SpokePool for USDC | Ethereum | $1.50 | <30 s | One-time per user. |
| 4. `deposit(USDC, amount, dst=137, ...)` | Ethereum | $3.00 | <30 s | – |
| 5. Across relayer fills on Polygon | Polygon | (in fee) | ~3 min | – |
| 6. (Optional) Swap USDC → USDC.e on Uniswap V3 | Polygon | $0.05 + 0.01% slippage | <30 s | Only needed if user wants to bet on Polymarket again. |
| **Across protocol fee** | – | **~$1** | – | – |
| **Total withdraw** | – | **~$7–12** | **~5–10 min** | Decryption callback adds 1–5 min to the timing; gas for two L1 txs (unwrap + bridge initiate) dominates cost. |

### 4.3 Round-trip totals (deposit + withdraw)

| Metric | Estimate |
|---|---|
| **Total cost** | **$12–20** (best case, low gas day, no extra approvals) |
| **Worst case** | **$30–40** (high gas day @ ~80 gwei) |
| **Total time** | **10–20 min** end-to-end (deposit + bet + withdraw, excluding bet-resolution wait) |

The < **$5 round-trip** target in the brief is **not achievable on Ethereum mainnet today.** The dominant cost is L1 gas, not bridge fees — even Circle CCTP (zero protocol fee) cannot get you under $5 round-trip because each L1 transaction (wrap, unwrap, bridge initiate, bridge claim) carries a $1.50–3 baseline in 21k–80k gas.

The < **30 min** target is comfortably met. Across alone settles one-way in ~5 min; the slow leg is the ZAMA decryption callback (1–5 min).

---

## 5. Recommended bridge: Across Protocol

### 5.1 Why Across

1. **USDC.e first-class support both ways.** Polymarket settles in pUSD/USDC.e; Across handles this token natively without forcing a Polygon-side DEX swap. CCTP, Stargate, and Hop all force at least one swap leg.
2. **Fastest realistic latency.** ~3–5 min one-way for USDC, comparable to CCTP and faster than Hop or PoS native.
3. **Optimistic intent model is right-sized for our flow.** Relayers front liquidity from their own balance; users pay a small fee. No 7-day challenge period as in optimistic rollup bridges; "optimistic" here just means the relayer takes the inventory risk.
4. **Mature SDK and TypeScript types.** `@across-protocol/sdk` is shipped, documented, used by ~50+ integrators including Uniswap and CoW Swap. Quote API is REST and trivially mockable.
5. **Audited and battle-tested.** Live since 2022, ~$10B cumulative volume, no insolvency events. Hub-and-spoke architecture means a single audited HubPool on Ethereum + per-chain SpokePools.

### 5.2 When to switch

- **If the user is already holding native USDC on Polygon (not USDC.e)**: use **CCTP v2** instead — saves the protocol fee and is faster. Requires detecting the variant and routing accordingly.
- **For very large transfers (> $50k)**: consider **Stargate** for deeper unified-pool liquidity. Across relayers may underprice large quotes or refuse them.
- **If trust-minimization is a hard requirement** (e.g. for a regulated product variant): fall back to **Polygon PoS native bridge** despite the slow L2→L1 leg. No relayers, no off-chain components, just checkpointed L1↔L2 message passing.

---

## 6. Risk assessment

| Step | Risk | Severity | Mitigation |
|---|---|---|---|
| Polygon-side approve+deposit (Across) | Spoke pool exploit / relayer collusion | Low | Across has clean audit history; cap per-tx size; fall back to PoS bridge if relayer queue stalls. |
| Across relayer fills L1 | Relayer insolvency / no inventory | Low–Med | Quote API surfaces fillable size; if no relayer fills in N minutes, deposit auto-refunds via slow-fill from HubPool (~2 hr). |
| L1 USDC → cUSDC wrap | Wrapper contract bug | Med | Use OpenZeppelin's audited ERC-7984 implementation, not legacy `ConfidentialERC20`. |
| ZAMA encrypted transfers | Coprocessor downtime, gateway pause | Med | OPE-265 noted scheduled upgrades 2026-05-04 (testnet) and 2026-05-11 (mainnet). Bot must retry on transient relayer errors. |
| Decrypt callback | Stuck pending, gateway latency spike | Med | Time-bound the decryption request; if no callback in 15 min, surface to user and retry. |
| L1 USDC → Polygon (Across) | Same as Polygon→L1 | Low–Med | Same mitigations. |
| Optional USDC→USDC.e swap on Polygon | DEX liquidity / slippage | Low | Uniswap V3 USDC↔USDC.e pool has deep liquidity at $1–10k size; slippage <0.05%. Skip swap if user is happy with native USDC. |
| Aggregate gas cost | Ethereum gas spike | **High** | Quote gas at submission time; refuse to proceed if total cost > X% of bet size (configurable, default 5%). |

---

## 7. Comparison with the wait-for-Polygon path

The OPE-265 report flagged Polygon as a host chain on ZAMA's H1 2026 roadmap. If/when that ships, the entire bridge layer disappears:

| | Bridge today (Across) | Wait for ZAMA Polygon host |
|---|---|---|
| Round-trip cost | $12–20 | ~$0.10 (Polygon gas only) |
| Round-trip time | 10–20 min | 30–60 s |
| Architectural complexity | 2 chains, 1 bridge, optional DEX swap | 1 chain |
| Counterparty surface | Polygon + Ethereum + Across + ZAMA + DEX | Polygon + ZAMA |
| When | Today | Unconfirmed; "H1 2026" on roadmap |
| Risk of slipping | – | Med — ZAMA team has not (as of 2026-05-06) published a firm Polygon GA date or live RPC |

**Strategic recommendation:** treat the bridge path as a **bridge** — literally — to span the gap until ZAMA Polygon ships. Build it cleanly enough to swap out, do not build it as if it were the long-term answer.

---

## 8. Open questions for product

1. What's the minimum bet size that justifies $12–20 in round-trip gas? Below ~$200 stake, gas is >5% of capital — a hard sell for retail.
2. Do we want to subsidize gas (treasury covers L1 cost) for early users to mask the cost, or surface it transparently?
3. Should we support **batch deposits** — pool 10 users' USDC into one wrap operation to amortize the L1 wrap gas? (Conflicts with per-user encrypted balance segregation; needs careful design.)
4. Is a **deposit-once, bet-many-times** UX acceptable, where the user keeps cUSDC on Ethereum and only withdraws periodically? This is the single biggest cost lever — daily round-trip is unaffordable, weekly is fine.

---

## 9. Recommended PoC scope (Phase 2)

Building on the OPE-265 PoC (`packages/privacy-layer/src/zama-poc.ts`):

1. **Sepolia + Polygon Mumbai/Amoy testnet path.** Across has a testnet deployment; use it to validate the bridge SDK integration without spending real funds.
2. **Mock the bridge in unit tests.** Bridge integration is straightforward enough that the PoC value is in *the cross-chain orchestration*, not in proving the bridge works (it does — it has $10B of volume).
3. **Build the orchestrator state machine** (deposit-pending, bridge-in-flight, wrap-pending, ready, withdraw-pending, bridge-out, complete). This is where the real engineering risk lives, not in the bridge call itself.
4. **Measure end-to-end timing on testnet** for at least 5 round-trip flows. Validate the < 30 min claim.
5. **Defer mainnet** until OPE-265's Phase 2 mainnet milestone.

Skeleton interfaces for the orchestrator are at `packages/privacy-layer/src/bridge-plan.ts`.

---

## 10. Verdict (GO / NO-GO)

### **GO** — for the PoC and Phase 2 build, with the following understanding:

**Why GO:**
- All required infrastructure exists in production today: Across, CCTP, Polygon PoS bridge, Polymarket on Polygon, ZAMA fhEVM on Ethereum.
- < 30 min round-trip target is **comfortably met** with Across (~10–20 min end-to-end).
- USDC.e direct support via Across removes the awkward Polygon-side swap leg.
- Engineering risk is in *orchestration*, not in any individual component. That is a tractable problem.

**Why NOT a clean GO:**
- < $5 round-trip target is **not achievable**. Ethereum L1 gas alone makes a round trip cost $12–20 today, $30+ on a high-gas day.
- This makes the product economically unviable for bet sizes < ~$200 unless we (a) batch deposits, (b) subsidize gas, or (c) wait for ZAMA Polygon host support.
- The "wait for ZAMA Polygon" path is **strictly better** if it ships on schedule. The bridge path should be designed as a **stopgap**, with a clean replacement story.

**Recommendation:**
1. Build the bridge integration as a **swappable adapter** behind the interfaces in `bridge-plan.ts`. Treat Across as the v1 implementation; CCTP, Stargate, and the eventual "no bridge needed" Polygon-host path are all swappable backends.
2. Default to a **deposit-once, bet-many, withdraw-occasionally** UX to amortize the L1 gas tax.
3. Re-validate at end of Phase 2 with fresh data on ZAMA's Polygon rollout. If Polygon host is GA by then, **rip the bridge layer out** rather than maintain it.

---

## Appendix A — Source list

- [Across Protocol Docs](https://docs.across.to/)
- [Across SDK — `@across-protocol/sdk`](https://github.com/across-protocol/sdk)
- [Circle CCTP — Cross-Chain Transfer Protocol](https://www.circle.com/cross-chain-transfer-protocol)
- [CCTP v2 announcement (March 2025)](https://www.circle.com/blog/cctp-v2)
- [Stargate Finance Docs](https://stargateprotocol.gitbook.io/stargate)
- [LayerZero V2 Docs](https://docs.layerzero.network/)
- [Hop Protocol Docs](https://docs.hop.exchange/)
- [Polygon PoS Bridge Overview](https://docs.polygon.technology/pos/architecture/bridge/)
- [Polygon PoS Bridge — Withdraw Process](https://docs.polygon.technology/pos/how-to/bridging/ethereum-polygon/erc20/)
- [Polygon Native USDC migration (Circle, Nov 2023)](https://www.circle.com/blog/native-usdc-now-available-on-polygon-pos)
- [Polymarket — pUSD/USDC.e collateral](https://docs.polymarket.com/)
- [OPE-265 — ZAMA fhEVM Validation Report](./zama-fhevm-validation.md)
- [OPE-267 — Polymarket CLOB Validation Report](./polymarket-clob-validation.md)
