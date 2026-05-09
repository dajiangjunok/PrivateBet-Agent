# ZAMA fhEVM Validation Report — Encrypted ERC20 for PrivateBet

**Ticket:** OPE-265 — ZAMA fhEVM 验证 — 加密 ERC20 合约部署与测试
**Date:** 2026-05-06
**Author:** PrivateBet research
**Verdict:** **GO (with caveats)** — see [§ Verdict](#10-verdict-goco-no-go) below.

---

## 1. Executive summary

| Question | Answer |
|---|---|
| Is the ZAMA fhEVM mainnet live? | **Yes.** Ethereum Mainnet went live **2025-12-30** with the first cUSDT confidential transfer (~$0.13 gas). |
| Is there a public testnet? | **Yes.** Ethereum **Sepolia** (chain id `11155111`). |
| Is the JS SDK production-ready? | **Mostly.** `@zama-fhe/relayer-sdk` is shipped and stable enough for testnet PoC. Node.js entry point exists. |
| Is encrypted ERC20 a real, deployable thing? | **Yes.** Two paths: (a) legacy `ConfidentialERC20` from `zama-ai/fhevm-contracts`, (b) the new **ERC-7984** standard implemented in `OpenZeppelin/openzeppelin-confidential-contracts`. |
| Is Polygon supported today? | **No.** Polygon support is on the **H1 2026** roadmap and is being progressively rolled out — not yet a stable host chain for confidential contracts. |
| Is there a Polygon ↔ ZAMA bridge? | **No native bridge.** ZAMA is a *coprocessor / confidentiality layer* on top of a host chain, not a separate L1 with its own bridge. Current production deployment is Ethereum mainnet only. |
| Throughput? | **~20 TPS** today (CPU). 500–1000 TPS targeted by end of 2026 with GPU coprocessors. |
| Expected gas per encrypted transfer? | **~$0.13 on Ethereum mainnet** at typical gas prices (3 decryptions + ZK proof verification of input). On Sepolia: free testnet ETH. |

---

## 2. Network status (as of 2026-05-06)

### 2.1 Live deployments

| Network | Status | Chain ID | Notes |
|---|---|---|---|
| Ethereum Mainnet | **Live** | 1 | Mainnet went live 2025-12-30; first confidential stablecoin (cUSDT) transferred on-chain. |
| Ethereum Sepolia | **Live** | 11155111 | Primary developer testnet. Free faucet ETH available. |

### 2.2 Architecture

ZAMA's fhEVM is **not its own chain** — it is a **coprocessor pattern** layered onto an EVM host chain:

```
┌─────────────────────────────┐   FHE op event    ┌──────────────────────┐
│  Host chain (Ethereum/...)  │ ───────────────▶ │  Coprocessor network │
│  - fhEVM executor contract  │                   │  - Performs actual   │
│  - Stores ciphertext refs   │ ◀─── result ──── │    FHE computation   │
└─────────────────────────────┘                   └──────────────────────┘
              ▲
              │ relayer-sdk (HTTP)
              ▼
┌─────────────────────────────┐
│  dApp / Bot                 │
│  - Encrypts inputs locally  │
│  - Signs decryption requests│
└─────────────────────────────┘
```

The host chain itself **does not** do FHE math. It emits events that a network of coprocessors picks up, computes off-chain, and posts back as ciphertext handles. This is what makes Ethereum-native confidentiality affordable (~$0.13/tx).

### 2.3 Roadmap (relevant to PrivateBet)

| When | What |
|---|---|
| H1 2026 | Polygon, Arbitrum, BNB, Base support added as host chains |
| June 2026 | GPU-accelerated coprocessor rollout begins (testnet) |
| Q3 2026 | GPU coprocessor on mainnet → 500–1000 TPS |
| H2 2026 | Solana SVM confidential support |

For PrivateBet, **Polygon support is the load-bearing milestone** — Polymarket settles on Polygon, so until ZAMA's Polygon host-chain deployment is production-ready we cannot natively co-locate encrypted bet flow with the betting markets.

---

## 3. SDKs and tooling

### 3.1 JavaScript / TypeScript SDK

The current SDK is **`@zama-fhe/relayer-sdk`** (this is the rebranded successor of `fhevmjs`).

Install:

```bash
pnpm add @zama-fhe/relayer-sdk
```

Two entry points:

- `@zama-fhe/relayer-sdk` — browser (uses WASM)
- `@zama-fhe/relayer-sdk/node` — Node.js (what we want for the bot)

Initialization (Sepolia, Node.js):

```ts
import { createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/node';

const fhevm = await createInstance(SepoliaConfig);
```

`SepoliaConfig` bundles ACL contract address, KMS contract address, input verifier address, gateway chain id, network RPC, and relayer URL. Custom config (e.g. for self-hosted relayers, or future Polygon support) accepts the same fields explicitly.

### 3.2 Solidity libraries

| Package | Purpose |
|---|---|
| `zama-ai/fhevm-solidity` | Core Solidity primitives — `euint8/16/32/64/128/256`, `ebool`, `eaddress`, `FHE.add/sub/mul/le/eq/...`, ACL. |
| `zama-ai/fhevm-contracts` | Reference implementations: `ConfidentialERC20`, `ConfidentialERC20Wrapped`, `ConfidentialWETH`, `ConfidentialGovernor`, `ConfidentialERC20Votes`. |
| `OpenZeppelin/openzeppelin-confidential-contracts` | Production-grade implementation of the new **ERC-7984** standard (proposed July 2025), audited by OZ. **Recommended for new builds.** |

### 3.3 Hardhat / Foundry

`zama-ai/fhevm-hardhat-template` and `zama-ai/fhevm-react-template` provide working scaffolds with mock fhEVM for local testing and Sepolia deployment.

---

## 4. Encrypted ERC20: how it works

### 4.1 Token standards

There are two relevant standards — pick one:

**(a) `ConfidentialERC20` (legacy, fhevm-contracts).**
ERC-20-shaped surface, but balances/allowances are `euint64` (encrypted). Has both encrypted-input overloads (with ZK proof) and direct-handle overloads.

```solidity
function transfer(address to, einput encryptedAmount, bytes calldata inputProof) external returns (bool);
function transfer(address to, euint64 amount) external returns (bool);
function transferFrom(address from, address to, einput, bytes calldata) external returns (bool);
function approve(address spender, einput, bytes calldata) external returns (bool);
function balanceOf(address) external view returns (euint64);   // encrypted handle
function allowance(address, address) external view returns (euint64);
function totalSupply() external view returns (uint64);          // public
```

**(b) `ERC-7984` (current standard, OpenZeppelin).**
Built ground-up for confidentiality; identical mental model but cleaner separation between ciphertext handles and proofs. **This is what PrivateBet should target** — it is the standard the ecosystem is converging on, and OpenZeppelin's audited implementation is the safer choice.

### 4.2 The plaintext ↔ encrypted boundary

PrivateBet's core question: *how does USDC (a public ERC-20 on Polygon) become an encrypted bet, and back?*

The pattern is a **wrapper contract** — `ConfidentialERC20Wrapped` (or its 7984 equivalent):

```
USDC (public)  ──deposit(amount)──▶  cUSDC (encrypted)
                                        │
                                        ├─ encrypted transfer A → B
                                        │
USDC (public)  ◀──withdraw(amount)── cUSDC (encrypted)
```

- **Deposit (plaintext → encrypted):** caller approves and transfers public USDC into the wrapper; wrapper mints encrypted cUSDC at 1:1. The deposited amount is *public on-chain* (you can see "Alice put in 100 USDC"), but **subsequent transfers are encrypted**.
- **Encrypted transfer:** caller submits ciphertext + ZK input proof; contract verifies, then `FHE.lte()` checks balance and `FHE.add/sub` updates encrypted balances homomorphically. **No on-chain reveal of amount or recipient balance.**
- **Withdraw (encrypted → plaintext):** caller requests withdrawal of `euint64` amount; contract issues a **decryption request** to the gateway/KMS network, which responds in a callback with the plaintext amount, at which point the wrapper releases the equivalent public USDC.

This means the privacy guarantee is **on the transfer layer, not the on-ramp/off-ramp layer**. Anyone watching the wrapper contract can see deposits and withdrawals; they cannot link them through the encrypted middle.

### 4.3 End-to-end flow for a confidential bet

For PrivateBet, the most plausible Phase-2 flow:

```
1. User deposits USDC      →  wrapper mints cUSDC  (public on host chain)
2. Bot reads encrypted     ←  balanceOf returns euint64 handle
   balance via userDecrypt    User signs EIP-712 reencrypt request → SDK decrypts client-side
3. Bot prepares bet        →  createEncryptedInput(contract, user)
                                .add64(stake)
                                .encrypt()  →  { handles, inputProof }
4. Bot submits bet         →  privateBetRouter.placeBet(market, encHandle, proof)
   - Router transfers cUSDC to escrow via encrypted transferFrom
   - Records encrypted bet
5. Resolution              →  on settlement, oracle posts outcome
   - Router computes encrypted payout = stake * encOdds
   - Transfers cUSDC payout back to user
6. User withdraws          →  wrapper.withdraw(euint64 amount)
   - Decryption oracle callback releases public USDC
```

For this to actually run on Polymarket, we still need the bridge from Polygon (where Polymarket settles) to Ethereum (where ZAMA mainnet lives) — see [§ 6](#6-polygon--zama-bridge-status).

---

## 5. Gas costs and performance

| Operation | Approximate cost |
|---|---|
| `FHE.add(euint64, euint64)` | ~20,000–30,000 gas |
| Scalar variant (e.g. `FHE.add(euint64, uint64)`) | Cheaper — prefer when one operand is plaintext |
| ZK proof verification of an encrypted input | $0.005 – $0.50 in gas value |
| User-side decryption per handle | $0.003 – $0.30 |
| **Whole encrypted transfer (cUSDT mainnet)** | **~$0.13** at typical gas prices |
| Throughput | ~20 TPS today (CPU coprocessor); 500–1000 TPS targeted late 2026 (GPU) |
| Confirmation | Bound by host chain finality (Ethereum: ~12s/block, ~minutes for finality) |

For PrivateBet:
- Bet placement = 1 encrypted transferFrom + bet record write ≈ **2–4 FHE ops + 1 input proof** ≈ **~$0.20–0.40 per bet on Ethereum mainnet.**
- That is **expensive** vs. Polymarket's native Polygon settlement (cents). Acceptable for high-stakes confidential bets, painful for retail-size flow until Polygon host support lands.

---

## 6. Polygon ↔ ZAMA bridge status

**There is no native bridge — and there does not need to be one in the long term.** ZAMA is designed as a coprocessor that sits on top of a host chain rather than a standalone L1. The intent is that Polygon itself becomes a host chain (planned H1 2026), at which point the wrapper and confidential transfer logic would deploy directly on Polygon and inter-op with Polymarket natively.

**Today, your options are:**

| Option | How it works | Verdict |
|---|---|---|
| **Wait for Polygon host support** (H1 2026) | Deploy `cUSDC` wrapper on Polygon directly once available. | **Best long-term**, blocked on ZAMA's rollout schedule. |
| **Deploy on Ethereum mainnet, bridge USDC across** | User bridges USDC Polygon→Ethereum (Polygon PoS bridge / LayerZero / Stargate) → wraps into cUSDC → bets via cross-chain message back to Polymarket on Polygon. | **Works but adds latency, bridge fees, and a 2-chain UX**. ~$5–15 in bridge gas + 5–30 min wait. Polymarket settlement on Polygon then needs a separate cross-chain order-router. |
| **Deploy on Sepolia for the PoC** | Wrap a mock USDC on Sepolia, validate the flow end-to-end, defer Polygon question. | **Recommended for OPE-265 PoC.** |

**Risk:** the H1-2026 Polygon-as-host-chain milestone is on roadmap but the ZAMA team has not (as of this report) published a firm production date, audit status, or live RPC for it. Treat the Polygon path as **pending verification** and re-validate before Phase 2 commit.

---

## 7. Limitations and gotchas

1. **No on-chain decrypt without a callback round-trip.** Anything that needs the *plaintext value* on-chain (e.g. comparison against a public oracle price, payout to an external system) needs an async decryption request → KMS callback. This breaks the synchronous EVM tx model and forces 2-tx flows.
2. **`euint64` ceiling.** Standard token balance type is `euint64` → max ~1.8 × 10¹⁹. Fine for USDC (6 decimals → up to ~$18T), but be deliberate about decimals.
3. **`view` calls cannot return useful encrypted data.** `balanceOf` returns a *handle*, not a ciphertext. To see your own balance you must call `userDecrypt` via the SDK, which requires an EIP-712 signature. This is a noticeable UX wrinkle for the Telegram bot.
4. **ACL is explicit.** `FHE.allow(handle, address)` must be called for any address that needs to operate on a ciphertext later. Forgetting this is the #1 newbie footgun and will revert downstream txs with cryptic errors.
5. **No public mempool privacy.** Encrypted *amounts* are private, but the **fact that Alice called `transfer(to=Bob, ...)`** is fully visible. To hide the social graph you also need a mixer/anonymity-set layer on top — out of scope for fhEVM alone.
6. **Coprocessor liveness assumption.** Off-chain coprocessor network must be healthy. ZAMA reported scheduled security upgrades on **2026-05-04 (testnet)** and **2026-05-11 (mainnet)** — production code must handle relayer/coprocessor downtime gracefully.
7. **Throughput.** ~20 TPS network-wide today is a hard ceiling. Acceptable for OPE; would not scale a retail bot past ~hundreds of users without GPU rollout.
8. **SDK churn.** `fhevmjs` → `@zama-fhe/relayer-sdk` rename happened recently; older blog posts and tutorials still reference the old package and the old `@fhevm/sdk` namespace. Pin versions.
9. **Standards transition.** `ConfidentialERC20` is being superseded by **ERC-7984**. Build against 7984 to avoid a migration in 6 months.

---

## 8. Recommended PoC scope (Phase 2 minimum)

1. Deploy a `MockUSDC` (plain ERC20) and a `ConfidentialERC20Wrapped` (or 7984 equivalent) on **Ethereum Sepolia**.
2. Bot service:
   - Connect to Sepolia via Alchemy/Infura RPC.
   - Use `@zama-fhe/relayer-sdk/node` with `SepoliaConfig`.
   - Implement `wrapUsdc(amount)`, `transferConfidential(to, amount)`, `userDecryptBalance()`, `unwrapUsdc(amount)`.
3. Validate end-to-end: deposit → encrypted transfer → decrypt own balance → withdraw.
4. Measure: gas per op, latency, coprocessor round-trip times.
5. **Defer** the Polygon/Polymarket integration question to Phase 3, gated on either (a) ZAMA Polygon host-chain GA, or (b) bridge architecture decision.

---

## 9. Open questions for product

1. Are users willing to pay ~$0.20–0.40 per encrypted bet (Ethereum gas) until Polygon host support lands?
2. Is the privacy goal "hide bet **size**" or "hide bet **graph**"? fhEVM alone solves the first; the second needs an additional mixer/CoinJoin layer.
3. What is acceptable settlement latency? Cross-chain bridge approach adds 5–30 min per round trip.
4. Should we self-host a relayer (control + cost) or use ZAMA's hosted relayer (simpler)?

---

## 10. Verdict (GO / NO-GO)

### **GO** for Phase 2 PoC on Sepolia.

**Why GO:**
- Mainnet is live and processing real transactions (~$0.13/tx demonstrated).
- Tooling is real: `@zama-fhe/relayer-sdk` works in Node, OpenZeppelin's audited ERC-7984 implementation is shipping.
- The encrypted-ERC20 + wrapper pattern matches PrivateBet's "plaintext USDC in, encrypted bet, plaintext USDC out" requirement exactly.
- We can build and validate the full flow on Sepolia today with no blockers.

**Why "with caveats":**
- **Polygon co-residency with Polymarket is not solved.** Until ZAMA's H1-2026 Polygon host-chain deployment is GA-with-audit, any production launch needs either (a) wait, or (b) an explicit cross-chain bridge architecture between Polygon (Polymarket) and Ethereum (cUSDC). Neither is free — Phase 3 must pick one before committing.
- **Throughput ceiling (~20 TPS network-wide)** means we cannot rely on fhEVM as a high-frequency settlement layer in 2026 H1. Use for moderate-volume confidential bets only.
- **SDK and standards are in flux.** Pin `@zama-fhe/relayer-sdk` versions; build against ERC-7984 not legacy `ConfidentialERC20`.

**Recommendation:** Proceed to PoC build (see `packages/privacy-layer/src/zama-poc.ts`). Re-evaluate Polygon path at end of Phase 2 with fresh data on ZAMA's Polygon rollout.

---

## Appendix A — Source list

- [Zama Confidential Blockchain Protocol Litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper)
- [Introducing the fhEVM Coprocessor](https://www.zama.org/post/fhevm-coprocessor)
- [Zama Protocol Mainnet Launches, Token Listing in April 2026 — Phemex](https://phemex.com/news/article/zama-protocol-launches-mainnet-on-ethereum-plans-token-listing-in-april-2026-50660)
- [Ethereum's Privacy Breakthrough: Zama Mainnet Delivers Confidential Transactions For $0.13 — MEXC](https://blog.mexc.com/news/ethereums-privacy-breakthrough-zama-mainnet-delivers-confidential-transactions/)
- [zama-ai/fhevm — GitHub](https://github.com/zama-ai/fhevm)
- [zama-ai/fhevm-contracts — GitHub](https://github.com/zama-ai/fhevm-contracts)
- [zama-ai/fhevm-solidity — GitHub](https://github.com/zama-ai/fhevm-solidity)
- [zama-ai/relayer-sdk — GitHub](https://github.com/zama-ai/relayer-sdk)
- [@zama-fhe/relayer-sdk — npm](https://www.npmjs.com/package/@zama-fhe/relayer-sdk)
- [ConfidentialERC20.sol — fhevm-contracts](https://github.com/zama-ai/fhevm-contracts/blob/main/contracts/token/ERC20/ConfidentialERC20.sol)
- [Confidential ERC-20 Tokens Using Homomorphic Encryption and the fhEVM](https://www.zama.org/post/confidential-erc-20-tokens-using-homomorphic-encryption)
- [ERC-7984: The Confidential Token Standard Explained](https://www.zama.org/post/erc-7984-the-confidential-token-standard-explained)
- [ERC-7984: Confidential Fungible Token (EIP)](https://eips.ethereum.org/EIPS/eip-7984)
- [OpenZeppelin Confidential Contracts (ERC-7984)](https://docs.openzeppelin.com/confidential-contracts/token)
- [Operations on encrypted types — Zama Solidity Guides](https://docs.zama.org/protocol/solidity-guides/smart-contract/operations)
- [Build Secure Confidential Smart Contracts on Zama FHEVM with OpenZeppelin](https://www.openzeppelin.com/networks/zama)
