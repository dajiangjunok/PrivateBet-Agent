# End-to-End Fund Path Validation — Phase 1 Synthesis

**Ticket:** OPE-268 — 端到端链路验证 — 完整资金路径集成测试
**Date:** 2026-05-06
**Author:** PrivateBet Agent team
**Status:** Phase 1 final report (synthesis of OPE-265, OPE-266, OPE-267)
**Verdict:** **CONDITIONAL GO** — proceed to Phase 2 only with the scope adjustments in §5. The architecture is technically validated; the *unit economics* on the Ethereum-anchored path do not work for retail bet sizes. See [§ 5 GO/NO-GO Decision](#5-phase-2-gono-go-decision).

---

## 0. TL;DR

| Question | Answer |
|---|---|
| Does the full deposit→bet→withdraw path work end-to-end with today's infrastructure? | **Yes, technically.** Every component (Across, ZAMA fhEVM, Polymarket CLOB, Uniswap V3 USDC↔USDC.e) is live on mainnet today. |
| What does a $100 round-trip bet cost? | **$12–20 best case, $30–40 on a high-gas day.** L1 Ethereum gas dominates (wrap + unwrap + 2× bridge initiate). The original "<$5 round-trip" PRD target is **not achievable** on Ethereum mainnet. |
| What does it cost on a $1,000 bet? | Same dollar cost; **1.2–4% of stake**. This is the smallest size at which the architecture is plausibly viable. |
| End-to-end latency (deposit → bet → withdraw)? | **10–25 min**, well inside the <30 min PRD target. The 1–5 min ZAMA decryption callback is the slowest single leg. |
| Is the architecture **as specified in the PRD** the right one for production? | **No, only as a stopgap.** The strategically correct path is to wait for ZAMA Polygon host-chain support (H1 2026 roadmap, unconfirmed GA) and eliminate the bridge layer entirely. The Ethereum-anchored design should be built as a **swappable adapter**, not the long-term answer. |
| Should Phase 2 proceed? | **Yes, with the scope changes in §5.4** — minimum bet size raised to $200, "deposit-once, bet-many" UX as default, bridge layer behind a swappable adapter, and a Phase 3 gate on ZAMA Polygon GA. |

---

## 1. End-to-End Fund Path

The original PRD path "Polygon ↔ ZAMA" is a misnomer. ZAMA fhEVM is a **coprocessor on Ethereum mainnet**, not a chain (see [OPE-265 §2.2](./zama-fhevm-validation.md#22-architecture)). The real shape is **two host chains (Polygon, Ethereum) joined by a bridge**, with ZAMA's encryption layered onto the Ethereum side.

### 1.1 Deposit path

```
External wallet (Polygon, USDC.e)
        │
        │ user-initiated transfer
        ▼
Sub-Wallet A (Polygon)                                       [hot key managed by wallet-service]
        │
        │ Across SpokePool.deposit(USDC.e, dst=1)            ~$0.02 Polygon gas + $1 relayer fee
        ▼
Across Protocol relayer fronts liquidity on Ethereum         ~3–5 min
        │
        ▼
USDC (native, Ethereum mainnet)                              held by Sub-Wallet A's L1 mirror
        │
        │ approve(cUSDC wrapper, max)                        ~$1.50 L1 gas (one-time per user)
        │ wrapper.deposit(amount)                            ~$2.00 L1 gas + $0.01–0.50 ZK proof
        ▼
cUSDC (encrypted ERC-7984 balance, Ethereum)
        │
        │ encrypted transfer to derived sub-address          ~$0.13 / hop (ZAMA cost)
        │ (intermediate hops form the encrypted pool /
        │  break the address graph between deposit and bet)
        ▼
Sub-address N (Ethereum, encrypted balance held)
```

**Key observations:**
- The **Polygon-side deposit (USDC.e → Across)** is fully public. Privacy starts only inside the cUSDC encrypted pool.
- **Address derivation** (Sub-Wallet A on Polygon → Sub-address N on Ethereum) is independent: the wallet-service derives Ethereum sub-addresses deterministically (BIP-32 children) and uses a fresh address per bet flow to break linkability.
- The wrap step (`wrapper.deposit`) is a **public on-chain event**: anyone can see `address X deposited 100 USDC into the cUSDC wrapper`. Subsequent encrypted transfers between sub-addresses inside the pool are not visible. This is the core privacy guarantee — **on the transfer layer, not the on-ramp** ([OPE-265 §4.2](./zama-fhevm-validation.md#42-the-plaintext--encrypted-boundary)).

### 1.2 Bet path

```
Encrypted balance at Sub-address N (Ethereum)
        │
        │ wrapper.requestUnwrap(euint64 amount)              ~$1.50 L1 gas + decrypt request
        │ KMS callback → releases plaintext USDC             1–5 min (ZAMA decryption oracle)
        ▼
USDC (native, Ethereum) at Sub-address N
        │
        │ approve(Across SpokePool, USDC, max)               ~$1.50 L1 gas (one-time)
        │ SpokePool.deposit(USDC, dst=137)                   ~$3.00 L1 gas
        ▼
Across relayer fills on Polygon                              ~3–5 min
        │
        ▼
USDC (native, Polygon) at Sub-Wallet B                       [fresh Polygon address derived
        │                                                     for this bet]
        │ Uniswap V3 swap USDC → USDC.e                      ~$0.05 Polygon gas + ≤0.05% slip
        ▼
USDC.e (= pUSD) at Sub-Wallet B
        │
        │ Polymarket SDK:                                    ~50–300 ms p50 from eu-west-1
        │   - approve CTF Exchange + adapter (one-time)      ~$0.05 Polygon gas
        │   - createOrder() — EIP-712 sign locally           <5 ms
        │   - postOrder() — L2 HMAC headers + signed body    150–300 ms
        ▼
Resting GTC order (or FAK/FOK fill) on Polymarket CLOB
```

**Key observations:**
- **Sub-Wallet B is unrelated to Sub-Wallet A.** Both are derived by the wallet-service, but the on-chain trace from A to B passes through the encrypted pool, breaking the public link.
- Polymarket trading uses **Type 0 (EOA)** signature mode (see [OPE-267 §3.3](./polymarket-clob-validation.md#33-signature-types-proxy-wallets)) — Sub-Wallet B itself signs orders, no proxy wallet needed.
- Sub-Wallet B must hold a small **POL balance (≥ 0.5 POL)** for Polygon gas. The bridge does not deliver POL; the bot must top up POL separately or deposit USDC and swap a portion to POL. This is a **per-sub-wallet cost** the PRD did not flag.
- Polymarket's **heartbeat opt-in** ([OPE-267 §6](./polymarket-clob-validation.md#6-heartbeats-anti-stale-orders)) auto-cancels open orders if missed >10s. The bot must run heartbeats per active sub-wallet — if we use many short-lived sub-wallets, heartbeat overhead and re-auth overhead grow linearly.

### 1.3 Withdraw path

```
Polymarket settlement (CTF redeem after market resolves)
        │
        │ proceeds in pUSD/USDC.e at Sub-Wallet B            on-chain Polygon settlement
        ▼
USDC.e at Sub-Wallet B (Polygon)
        │
        │ (optional) Uniswap V3 swap USDC.e → USDC          ~$0.05 + ≤0.05% slip
        │ approve Across SpokePool                          one-time
        │ SpokePool.deposit(USDC, dst=1)                    ~$0.02 Polygon gas
        ▼
Across relayer fills on Ethereum                            ~3–5 min
        │
        ▼
USDC at L1 mirror of Sub-Wallet B
        │
        │ wrapper.deposit(amount) — re-wrap into cUSDC      ~$2.00 L1 gas + ZK proof
        ▼
cUSDC at Sub-address M (encrypted, mixed)                   [optional mixing hops here]
        │
        │ encrypted transfer to a fresh sub-address         ~$0.13 / hop
        │ wrapper.requestUnwrap(...)                        ~$1.50 + decrypt
        ▼
USDC at Sub-address P (Ethereum)
        │
        │ approve Across; SpokePool.deposit(dst=137)        ~$3 + relayer fee
        ▼
USDC.e at user's specified external address (Polygon)
```

**Key observations:**
- The withdraw path is **structurally symmetric** to the deposit path but pays the L1-gas tax twice: once to re-wrap from settlement, once to unwrap to the external address.
- Privacy on the *withdraw* side is only meaningful if the user re-wraps into cUSDC and mixes before unwrapping. If they don't, the path is simply Polymarket → Sub-Wallet B → bridge → external — which **leaks the link between Sub-Wallet B and the user's external wallet**. The PRD's withdraw path includes the rewrap step; we must keep it, even though it doubles the L1 gas cost on settlement.
- For the common case of **bet-many-times before withdraw** (recommended UX, see §5), most settled bets land back at Sub-Wallet B, get re-wrapped in batches, and the user only pays this withdraw-side tax periodically.

---

## 2. Cost Breakdown

All numbers assume Ethereum mainnet at ~30 gwei, ETH at $3,500, MATIC negligible, $100 bet size, Across as bridge ([OPE-266 §4](./bridge-poc.md#4-end-to-end-cost-breakdown)).

### 2.1 Deposit (Polygon USDC.e → encrypted balance on Ethereum)

| Step | Chain | Cost (USD) | Notes |
|---|---|---|---|
| Approve Across SpokePool for USDC.e | Polygon | $0.01 | One-time per Sub-Wallet A |
| `deposit(USDC.e, dst=1)` | Polygon | $0.02 | |
| Across protocol fee | – | $0.10 + $1 relayer | 0.10% + flat relayer reward |
| Approve cUSDC wrapper for USDC | Ethereum | $1.50 | One-time per L1 sub-address |
| `wrapper.deposit(amount)` | Ethereum | $2.00 + $0.01–0.50 ZK | ERC-7984 mint + input proof |
| Encrypted transfer hop (×2 hops in pool) | Ethereum (ZAMA) | 2 × $0.13 = $0.26 | Mixing / address rotation |
| **Subtotal — deposit** | | **$5.40 – $5.90** | **~5 min** end-to-end |

### 2.2 Bet (encrypted balance → Polymarket order placed)

| Step | Chain | Cost (USD) | Notes |
|---|---|---|---|
| `wrapper.requestUnwrap(euint64)` | Ethereum | $1.50 | Encrypted balance check |
| ZAMA decrypt callback gas (passed through) | Ethereum | $0.10 – $0.50 | KMS oracle posts plaintext |
| Approve Across SpokePool for USDC | Ethereum | $1.50 | One-time per L1 sub-address |
| `deposit(USDC, dst=137)` | Ethereum | $3.00 | |
| Across protocol fee | – | $0.10 + $1 relayer | |
| Uniswap V3 USDC → USDC.e swap | Polygon | $0.05 + ≤0.01% slip | Negligible |
| Polymarket approves (CTF Exchange, adapter, pUSD) | Polygon | $0.05 (×3 contracts) | One-time per Sub-Wallet B |
| Polymarket order signing (local) + `postOrder` | – | $0 | Free; gas only on settlement |
| POL top-up for Sub-Wallet B (if not pre-funded) | Polygon | $0.10 (≥ 0.5 POL) | Required for any cancel/redeem tx |
| **Subtotal — bet** | | **$7.40 – $7.80** | **~5–10 min** (callback dominates) |

### 2.3 Withdraw (settlement → user external)

| Step | Chain | Cost (USD) | Notes |
|---|---|---|---|
| Polymarket CTF redeem (built into settlement) | Polygon | $0.10 | After market resolves |
| Uniswap V3 USDC.e → USDC swap | Polygon | $0.05 | Optional but typical |
| Approve Across SpokePool | Polygon | $0.01 | One-time |
| `deposit(USDC, dst=1)` | Polygon | $0.02 | |
| Across protocol fee | – | $1 | |
| Approve cUSDC wrapper for USDC (Ethereum) | Ethereum | $1.50 | One-time |
| `wrapper.deposit(amount)` — re-wrap for mixing | Ethereum | $2.00 + $0.01–0.50 | Required for privacy |
| Encrypted transfer hops (×2) | Ethereum (ZAMA) | $0.26 | |
| `wrapper.requestUnwrap(...)` | Ethereum | $1.50 + $0.10–0.50 | |
| Approve Across SpokePool for USDC | Ethereum | $1.50 | One-time |
| `deposit(USDC, dst=137)` to user external | Ethereum | $3.00 | |
| Across protocol fee | – | $1 | |
| **Subtotal — withdraw** | | **$11.95 – $12.95** | **~10–15 min** |

### 2.4 Round-trip totals

| Scenario | Total USD | Total time |
|---|---|---|
| Best case (~30 gwei, all approvals already done) | **~$13** | ~15 min |
| Typical (~50 gwei) | **~$20** | ~20 min |
| First-time user (no approvals done, every approve hits) | **+$6 first run** = ~$26 | ~20 min |
| High-gas day (~80 gwei) | **~$35** | ~25 min |
| Extreme (~150 gwei, congestion) | **~$60+** | ~25–40 min |

**Cost-as-percent-of-stake:**

| Bet size | Round-trip % at $20 typical | At $35 high-gas |
|---|---|---|
| $50 | **40%** — unusable | **70%** — unusable |
| $100 | **20%** — unusable for repeat bets | **35%** — unusable |
| $200 | 10% | 17.5% |
| $500 | 4% | 7% |
| $1,000 | **2%** | 3.5% |
| $5,000 | 0.4% | 0.7% |

The PRD's `< $5 round-trip` is **structurally unattainable** on Ethereum mainnet. The minimum is bounded below by the gas cost of (wrap + unwrap + 2× bridge initiate) ≈ 4 × ~$1.50 = $6, and that is before any Across fees or ZAMA costs.

---

## 3. Timing Analysis

### 3.1 Per-leg latency

| Leg | Median | Worst case | Bottleneck |
|---|---|---|---|
| Sub-Wallet A → Across deposit confirm (Polygon) | 30 s | 2 min | Polygon block finality |
| Across relayer fills on Ethereum | 3–5 min | 15–30 min (slow-fill) | Relayer inventory / fee acceptance |
| Wrap into cUSDC (Ethereum) | 30 s | 5 min | Ethereum block confirmation |
| Encrypted transfer hop in pool | 30 s – 1 min | 5 min | ZAMA coprocessor round-trip |
| `requestUnwrap` + KMS callback | **1–5 min** | 15 min | **ZAMA decryption oracle** (slowest leg) |
| Across L1→Polygon | 3–5 min | 15–30 min | Same as L2→L1 |
| Uniswap swap on Polygon | <30 s | 2 min | Polygon gas spike |
| Polymarket `postOrder` | 150–300 ms | 1 s | Network |
| **End-to-end deposit→order placed** | **8–15 min** | **35–50 min** | |
| **Settlement→user external withdraw** | **10–15 min** | **40–60 min** | |
| **Full round-trip (excluding bet-resolution wait)** | **18–25 min** | **75–110 min** | |

The PRD `< 30 min` round-trip target is met in the median case but **not on bad-gas days or relayer-stall days**. We meet it ~80% of the time at typical conditions.

### 3.2 Where delays occur (and what to do)

1. **ZAMA decrypt callback (1–5 min, p99 ~15 min).** Off-chain coprocessor round-trip. *Not under our control.* Mitigation: surface the pending state in the bot UI; time-bound retries to 15 min, after which alert. ZAMA scheduled upgrades on **2026-05-04 (testnet)** and **2026-05-11 (mainnet)** ([OPE-265 §7](./zama-fhevm-validation.md#7-limitations-and-gotchas)) — production retry must be robust to maintenance windows.
2. **Across slow-fill (worst case 15–30 min).** If no relayer accepts the quote, Across falls back to a slow-fill from HubPool, ~2 hr. Mitigation: pad the quote to ensure relayer profitability; if no fill in 5 min, refund and retry with higher fee or fall back to Polygon PoS bridge (slow but trust-minimized).
3. **Ethereum gas spikes.** A user submitting at the wrong moment can wait 2 blocks for confirmation. Mitigation: priority-fee oracle, refuse to broadcast if base fee > configured ceiling, queue for retry.
4. **Polymarket order rejection** (heartbeat lapse, balance/allowance drift, geo-block IP change). Mitigation: refresh `getBalanceAllowance()` before each order; pre-validate min order size and tick size; alert on `INVALID_*` errors.

---

## 4. Risk Assessment

### 4.1 Per-step risk matrix

| Step | Risk class | Severity | Failure mode | Recovery |
|---|---|---|---|---|
| Sub-Wallet A holds USDC.e | Custody | **High** | Hot key compromise | KMS/HSM custody; per-wallet balance cap (e.g. ≤$500 transient) |
| Across deposit (Polygon) | Bridge | Low | Relayer collusion / spoke-pool exploit | Cap per-tx size; fall back to PoS bridge |
| Across relayer fills L1 | Bridge | Low–Med | No relayer takes the quote | Slow-fill auto-refund (~2 hr); retry with higher fee |
| L1 USDC → cUSDC wrap | Smart contract | **Med** | Wrapper bug, ACL misconfiguration | Use OZ ERC-7984 (audited); never custom-write the wrapper |
| Encrypted transfers (ZAMA) | Coprocessor | **Med** | Coprocessor downtime / gateway pause | Retry with backoff; surface "encrypted ops unavailable" UX |
| Decrypt callback | Coprocessor | **Med** | Callback never fires | 15 min timeout → user-visible retry; on persistent failure escalate |
| L1 → Polygon (Across) | Bridge | Low–Med | Same as Polygon → L1 | Same |
| USDC ↔ USDC.e DEX swap | DEX | Low | Slippage spike on thin liquidity | Cap swap size to $10k; route via Uniswap V3 0.01% pool |
| Polymarket order placement | API | Low | API down, geo-block trips, allowance drift | Retry; refresh allowance; ops alert if region IP changes |
| Polymarket heartbeat lapse | API | Low | Bot crash → all orders cancel ≤10s | Acceptable safety property; restart playbook re-posts |
| Sub-Wallet B custody | Custody | **High** | Hot key compromise | Same as Sub-Wallet A; rotate per session |
| **Aggregate L1 gas spike** | Cost | **High** | $13 round-trip becomes $60 | Refuse to proceed if total cost > N% of stake (config; default 5%) |
| **Geo-block IP shift** | Compliance | **High** | Polymarket order rejected from blocked region | Run only in eu-west-1; monitor `/api/geoblock`; alert on change |

### 4.2 Single points of failure

1. **ZAMA coprocessor network.** The host chain (Ethereum) is fine; FHE math happens off-chain. If the coprocessor network has an incident, *all encrypted operations stop*. There is no fallback to plaintext. Mitigation: design the orchestrator to **pause new encrypted-leg work** while still allowing settlement of in-flight bets that don't require fresh FHE ops.
2. **Across relayer network.** If no relayer in the network has USDC inventory on the destination chain, deposits get queued for slow-fill (~2 hr). Mitigation: monitor Across `getQuote` response for fillable size; fall back to Stargate or Polygon PoS bridge for stalled flows.
3. **Polymarket Cloudflare front.** Single CDN dependency; rare but real. Mitigation: WS fallback + cached order-book; defer non-critical reads if API down.
4. **Ethereum L1 gas.** Not a "failure" but a *cost denial-of-service*. A 200 gwei day means a $100 bet costs $50+ in gas. Mitigation: hard ceiling on bot-initiated L1 ops; queue and wait if base fee > N gwei (configurable).
5. **Wallet-service KMS.** Holds the private keys for every sub-wallet. Single root-of-trust. Mitigation: HSM-backed; audit access; per-wallet spending caps; periodic key rotation.

### 4.3 Risk-weighted summary

| Risk class | Aggregate severity | Manageable? |
|---|---|---|
| Custody / private-key compromise | **High** | Yes, with HSM and caps |
| L1 gas economics | **High** | Only by raising minimum bet size |
| Bridge availability | **Medium** | Yes, with multi-bridge fallback |
| ZAMA coprocessor liveness | **Medium** | Yes, with retry + pause-state |
| Geo-compliance | **Medium** | Yes, with region pinning |
| Smart contract bugs | **Medium** | Yes, by using audited OZ contracts |
| Polymarket API stability | **Low** | Yes, with heartbeat + WS fallback |

There are **no unmanageable risks** in the architecture. Every risk has a documented mitigation. The dominant concern is **economic, not technical**: the L1-gas cost structure constrains the achievable product market more than the PRD assumed.

---

## 5. Phase 2 GO/NO-GO Decision

### 5.1 Recommendation: **CONDITIONAL GO**

Proceed to Phase 2 build, but with the explicit scope adjustments in §5.4. The architecture works; the Phase 1 surprises are all about **cost-driven product constraints**, not about technical feasibility.

### 5.2 GO conditions

All five must be true to proceed:

1. **Minimum bet size raised to $200** (and surfaced clearly in product copy). Below this, gas exceeds 5% of stake and the product is structurally unviable on the Ethereum-anchored path.
2. **Default UX is "deposit-once, bet-many, withdraw-occasionally."** Users keep cUSDC on Ethereum and only pay the full round-trip tax on actual withdraw events. A typical user might deposit weekly and withdraw monthly. *This is the single biggest cost lever — it amortizes the L1-gas tax across many bets.*
3. **Bridge layer behind a swappable adapter.** Implement Across as v1, but the orchestrator interface must allow swapping in (a) CCTP for native-USDC users, (b) Polygon PoS as a fallback, and (c) the eventual "no-bridge" ZAMA-on-Polygon path with no business-logic rewrite.
4. **L1 gas ceiling enforced at the orchestrator.** The bot refuses to broadcast L1 ops if base fee exceeds a configured ceiling (default 80 gwei). This caps the worst-case round-trip cost at ~$35 and avoids surprise $60+ bills.
5. **Phase 3 gate on ZAMA Polygon GA.** End of Phase 2 includes a re-validation pass; if ZAMA Polygon host-chain support is GA-with-audit by then, Phase 3 plans the bridge-rip-out, not feature growth on the bridge layer.

### 5.3 Product implications

**These are PRD-level changes that need product sign-off:**

| Implication | What changes |
|---|---|
| Minimum bet size | Was implicit ($10–$100 retail framing). **Now $200.** |
| Round-trip cost SLO | Was `< $5`. **Now `< $25 typical, < $40 worst case`.** |
| Round-trip latency SLO | Was `< 30 min`. **Stays at `< 30 min p50`,** but acknowledge `< 60 min p95` is achievable. |
| Withdraw cadence | Was per-bet implicit. **Default is per-N-bets / weekly batch.** |
| Per-user POL gas top-up | Was implicit. **Now explicit: bot maintains ≥0.5 POL per active sub-wallet.** |
| Geo-block | Was not addressed. **Production runs from `eu-west-1` (or `eu-central-1`); 33 countries blocked; documented in user-facing T&Cs.** |
| Privacy guarantee scope | Was "bet privacy." **Sharpened: "bet **size** privacy + sub-wallet rotation breaks the public link between deposit-source and bet-execution wallet."** It does not hide the *fact* of betting on Polymarket from a chain analyst — a deeper anonymity-set primitive (Railgun/Aztec, see §6.B) would be needed for that. |
| Throughput cap | Was unstated. **Now explicit: ZAMA mainnet network-wide is ~20 TPS; PrivateBet is *bound by a network-shared resource*, not by our backend. Acceptable for OPE moderate-volume; not for retail mass-market.** |

### 5.4 Recommended MVP scope adjustments

Compared to the original PRD:

**Keep:**
- Telegram bot front end.
- Polymarket CLOB as the order-routing layer (validated GO, no changes).
- Sub-wallet derivation pattern for Polygon-side privacy.
- ZAMA fhEVM (ERC-7984 wrapper) as the encrypted-balance primitive.

**Cut / defer:**
- **Cut: per-bet auto-withdraw to user external.** Replace with batched, user-initiated withdraw.
- **Cut: bet sizes < $200.** Out of scope for MVP.
- **Defer: native Polygon-side fhEVM.** Not viable in 2026 H1; revisit at Phase 3 gate.
- **Defer: any HFT/market-making features on Polymarket.** ≥200 ms one-way latency rules these out ([OPE-267 §9](./polymarket-clob-validation.md#9-latency-profile)). MVP is limit/market orders, not maker strategies.
- **Defer: anonymity-set / mixer features beyond simple address rotation.** Not blocking for MVP at the PRD's privacy goal.

**Add (not in original PRD):**
- **Add: L1 gas-ceiling guard** in orchestrator.
- **Add: deposit/withdraw batching mode** (single L1 tx for N users — open question, see §5.5).
- **Add: explicit geo-block compliance check** at bot startup and on each order placement.
- **Add: heartbeat-aware order lifecycle** (cancel-on-disconnect is a feature, not a bug — wire it in deliberately).
- **Add: bridge-adapter interface** with at minimum two implementations (Across, PoS fallback).
- **Add: ZAMA coprocessor health monitor** + pause state for in-flight orchestrator runs.

### 5.5 Timeline risk factors

| Risk | Probability | Impact | Action |
|---|---|---|---|
| ZAMA Polygon host-chain slips past H1 2026 | **Med-High** (no firm GA date as of 2026-05-06) | Bridge layer becomes long-lived rather than stopgap | Build bridge layer well; do not assume rip-out is imminent |
| Ethereum L1 gas baseline rises (e.g. another shitcoin season) | Med | Round-trip cost balloons; min-bet $200 → $500 | Gas-ceiling guard provides graceful degradation |
| ZAMA SDK breaks compat (`@zama-fhe/relayer-sdk` is < 1 year old) | Low–Med | 1–2 week unplanned rework | Pin versions; integration tests in CI run weekly |
| Polymarket geo-block expands to EU | Low | Production region needs migration | Region-agnostic infra pattern; `eu-west-1` is the *current* unblocked choice, not a permanent one |
| ERC-7984 vs `ConfidentialERC20` standard churn | Low | Need wrapper migration | Build against ERC-7984 (current OZ standard) — already done in OPE-265 |
| Across protocol incident | Low | 1–2 days of degraded bridging | Adapter swap to Stargate or PoS |
| Coprocessor maintenance window | **High frequency, low impact** | Hours of downtime per upgrade (e.g. 2026-05-04, 2026-05-11) | Pause-state in orchestrator; user-visible status page |

**Most-likely-to-bite scenario:** ZAMA Polygon host slips to H2 2026 or later. In that case the bridge layer outlives its "stopgap" framing by 6–12 months. The architecture must be production-quality even if it ships as the v1 long-term answer.

---

## 6. Alternative Architectures

If at end of Phase 2 the cost economics are still unworkable, three pivot options exist. They are listed in **decreasing order of resemblance to the current PRD** — Option A keeps the most, Option C the least.

### 6.A Option A — Wait for ZAMA Polygon host-chain (H1 2026 roadmap)

**The architecture:** drop the bridge layer entirely. Deploy the cUSDC wrapper (or 7984-equivalent) directly on Polygon once ZAMA's Polygon host-chain support is GA-with-audit. The whole flow lives on Polygon: USDC.e → cUSDC.e on Polygon → encrypted bet → Polymarket on Polygon. One chain, no bridge.

**Pros:**
- **Round-trip cost drops from ~$20 to ~$0.10** (Polygon gas only).
- **Round-trip time drops from ~20 min to ~30–60 s.**
- Architecture simplifies dramatically: one chain, one set of contracts, no relayer dependency.
- Polymarket settlement co-located with encrypted balance — no swap leg.

**Cons:**
- **Timeline uncertainty.** ZAMA's H1 2026 roadmap item has no firm GA date or live RPC as of 2026-05-06. Slippage to H2 2026 is plausible.
- **Throughput still capped at network-wide ~20 TPS.** GPU rollout (Q3 2026 mainnet) is what unlocks scale, not Polygon support.
- **Polygon coprocessor security model is new** — when it ships it will start with the same audit-and-mainnet bake-in cycle Ethereum's deployment went through, which took ~6 months.

**When it becomes the right answer:** when ZAMA publishes a firm Polygon GA date and audit. Reassess at end of Phase 2.

### 6.B Option B — Privacy via Railgun or Aztec on Polygon directly

**The architecture:** drop ZAMA entirely. Use Railgun (zk-SNARK shielded balances; live on Polygon) or Aztec (zk-rollup, native L2) as the privacy primitive. User deposits USDC.e into Railgun's shielded pool, transfers privately within the pool, and withdraws to Sub-Wallet B for Polymarket trading.

**Pros:**
- **Lives on Polygon today** — no bridge needed for Railgun (Aztec is its own L2 but bridges are mature).
- **Larger anonymity set.** Railgun has been shielding tokens since 2022; the pool is non-trivially large. Aztec's anonymity set is even larger.
- **Round-trip cost ~$0.20–1** (Polygon gas + small Railgun fee). 100× cheaper than the ZAMA path today.
- **Strictly stronger privacy** for the "hide bet graph" use case ([OPE-265 §7](./zama-fhevm-validation.md#7-limitations-and-gotchas) noted fhEVM does *not* hide the social graph).
- **Throughput is not network-shared** — Railgun is just a Solidity contract, no off-chain coprocessor bottleneck.

**Cons:**
- **Different mental model.** zk-SNARK shielded notes vs. encrypted balances — different developer ergonomics, different SDK. Railgun's `@railgun-community/wallet` is good but less mature than ZAMA's tooling for *programmable* encrypted operations.
- **No homomorphic operations on encrypted balances.** Railgun shields, but you can't compute on shielded values on-chain. This rules out features like "encrypted automated odds-shading" or "encrypted limit orders against an encrypted bankroll." If those are PRD requirements, Option B is a non-starter.
- **Aztec specifically** is a separate L2; bridging Polymarket-Polygon ↔ Aztec adds back the bridge complexity we were trying to escape.
- **Regulatory posture** — privacy-pool tooling has had occasional sanctions friction (Tornado Cash precedent). Railgun has not been sanctioned but the category risk is real.

**When it becomes the right answer:** if the user-stated privacy goal is *"hide the fact that I bet on Polymarket"* (graph privacy) more than *"hide my bet sizes from a public observer"* (amount privacy), and if homomorphic computation on encrypted balances is **not** required.

### 6.C Option C — Simple address rotation, no FHE

**The architecture:** drop encryption entirely. Wallet-service derives a fresh Sub-Wallet per session, funds it via Across (or similar) from a master wallet, places bets on Polymarket, and rotates wallets per N bets / per session. No ZAMA, no Railgun, just sub-wallet hygiene + bridge.

**Pros:**
- **Simplest possible implementation.** ~70% of the orchestrator complexity disappears. No coprocessor round-trips, no decryption callbacks, no wrapper contracts.
- **Round-trip cost ~$0.10** (Polygon gas only) — bridges only used if the user wants to fund from outside Polygon.
- **Throughput: Polygon native** (~7,000 TPS theoretical, plenty in practice).
- **Latency: seconds, not minutes.**
- **Mature tech.** Sub-wallet derivation, BIP-32, gas-funded relayers — all production-stable for a decade.

**Cons:**
- **Privacy is materially weaker.** A chain analyst with reasonable heuristics can cluster sub-wallets back to their funding source by observing timing, amount, and gas-funding patterns. This is the same level of privacy Polymarket-via-CEX already provides — which is to say, *not much*.
- **No on-chain unlinkability against a sophisticated observer.** Address rotation alone does not break Sybil-style heuristics.
- **Doesn't satisfy the PRD's "private bet" framing.** If the product is sold on privacy, this option is a marketing problem.

**When it becomes the right answer:** if Phase 2 reveals that users are willing to pay for **convenience and address hygiene** rather than **cryptographic privacy**, and if the cost of true privacy (Options A or B) makes the product non-viable. This is the **fastest path to revenue** but the one most at odds with the PRD's stated value proposition.

### 6.D Trade-off summary

| Dimension | Current (bridge + ZAMA) | A: Wait for ZAMA Polygon | B: Railgun/Aztec on Polygon | C: Address rotation only |
|---|---|---|---|---|
| Time to ship | **6 months** (Phase 2) | Blocked on ZAMA | ~3 months | **~6 weeks** |
| Round-trip cost ($100 bet) | $13–35 | ~$0.10 | $0.20–1 | ~$0.10 |
| Round-trip latency | 15–25 min | 30–60 s | 30–60 s | 10–30 s |
| Privacy strength | Strong (amount) + medium (graph) | Same | Strong (graph) + n/a (amount) | Weak |
| Architectural complexity | High | Low | Med | Very low |
| Throughput | ~20 TPS (ZAMA-bound) | ~20 TPS (ZAMA-bound) | Polygon native | Polygon native |
| Homomorphic ops on encrypted balance | Yes | Yes | No | n/a |
| Regulatory posture | Standard | Standard | Privacy-pool category risk | Standard |
| Fits original PRD | Yes (with §5 changes) | Yes — better | Partially (no FHE) | No (privacy is weak) |

**Most-likely correct production architecture in 12 months:** Option A, if ZAMA delivers on H1 2026 Polygon. Otherwise the v1 (current) bridge+ZAMA architecture matures into the long-term answer until Polygon host ships.

---

## 7. Summary of Phase 1 Findings That Change the PRD

Concrete diff to the original product spec, distilled from this report:

1. **Minimum bet size: was implicit retail; now `≥ $200`.** L1-gas economics force this.
2. **Round-trip cost SLO: was `< $5`; now `< $25 typical, < $40 high-gas`.**
3. **Default UX: was per-bet deposit/withdraw; now `deposit-once, bet-many, withdraw-batched`.** Single biggest cost lever.
4. **Privacy guarantee: was "private bets"; now "encrypted bet **amounts** + sub-wallet rotation."** The PRD copy should not promise graph-level privacy on the v1 architecture.
5. **Geographic compliance: was unaddressed; now production runs in `eu-west-1` only, with 33 countries blocked from order placement.**
6. **Throughput: was unstated; now bounded by ZAMA network-wide ~20 TPS until Q3 2026 GPU rollout.**
7. **POL top-ups: was unaddressed; now bot maintains ≥0.5 POL per active Polygon sub-wallet.**
8. **Bridge dependency: was "Polygon ↔ ZAMA bridge" (a non-existent thing); now `Polygon ↔ Ethereum L1 USDC bridge via Across`, with adapter pattern for future replacement.**
9. **No HFT / market-making strategies in MVP.** ≥200 ms one-way latency to Polymarket rules these out. Restrict MVP to limit and market orders.
10. **Standards target is ERC-7984, not legacy `ConfidentialERC20`.** Already enforced in OPE-265 PoC code.
11. **Phase 3 gate condition: end-of-Phase-2 re-validation of ZAMA Polygon GA.** If shipped, Phase 3 is "rip out the bridge"; if not, Phase 3 is "harden the bridge for long-term operation."

---

## 8. Final Verdict

**CONDITIONAL GO for Phase 2.**

The end-to-end fund path **technically validates** end-to-end on production-grade infrastructure today. Every component — Across bridge, ZAMA fhEVM mainnet, Polymarket CLOB, Uniswap V3 USDC.e pool — is live, audited, and accessible from current SDKs. There are no architectural blockers.

The Phase 1 surprises are **economic, not technical**. The original PRD's `< $5 round-trip` target is structurally unattainable on the Ethereum-anchored path; the realistic floor is `~$13`. This forces a `≥ $200` minimum bet size and a deposit-once-bet-many UX as the default, which are PRD-level changes that need product sign-off **before Phase 2 build commits to scope.**

If the product team can accept the §5.3 implications, **proceed.** If the product depends on retail-size bets (sub-$200) or per-bet round-trips, **do not proceed on the current architecture** — pivot to Option B (Railgun/Aztec) or Option C (address rotation) instead, both of which run natively on Polygon at ~$0.10 per round-trip but trade off either programmable encryption (B) or privacy strength (C).

The strategic best case remains **Option A — wait for ZAMA Polygon host-chain (H1 2026 roadmap)**, which collapses the current bridge layer entirely and brings round-trip cost to ~$0.10 with no architecture rewrite. Build the v1 bridge+ZAMA implementation cleanly enough to be ripped out when that ships.

---

## Appendix A — Source reports

- [OPE-265 — ZAMA fhEVM Validation Report](./zama-fhevm-validation.md)
- [OPE-266 — Polygon ↔ Ethereum Bridge PoC Report](./bridge-poc.md)
- [OPE-267 — Polymarket CLOB Validation Report](./polymarket-clob-validation.md)

## Appendix B — Open questions for Phase 2 product review

1. Does product accept `≥ $200` minimum bet size? If not, which alternative architecture (§6) should we pivot to?
2. Is treasury-subsidized gas (mask the L1 cost from users) on the table for early adoption? Cost: ~$15/user/round-trip.
3. Is **batch deposit** (pool 10 users into one wrap operation) acceptable? Saves ~$2/user but couples user balances cryptographically — privacy and accounting implications need a separate design.
4. What is the target **withdraw cadence**? Per-bet (current PRD assumption, expensive), per-day (manageable), per-week (cheap), per-month (cheapest)?
5. What is the **stated privacy guarantee** in user-facing copy? "Encrypted bet amounts" is honest; "anonymous betting" is not, on the v1 architecture.
6. Acceptable production region constraint? `eu-west-1` only; can the user base support that?
7. **Re-validation cadence for ZAMA Polygon GA** — monthly check-in starting 2026-09? Phase 3 gating decision needs a forcing function.
