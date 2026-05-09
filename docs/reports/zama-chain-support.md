# ZAMA fhEVM Chain Support — Where Can We Actually Deploy?

**Date:** 2026-05-06
**Author:** PrivateBet research
**Question:** Which low-gas L2s does ZAMA support NOW or launching SOON, so we can avoid Ethereum mainnet's $0.13–0.40 per encrypted bet?
**Verdict:** **NONE of the major L2s (Arbitrum, Base, Optimism, BNB, Polygon) are live host chains today.** Plan around Ethereum-only for at least 1–2 quarters.

---

## 1. TL;DR

| Question | Answer |
|---|---|
| Which chains can host fhEVM dApps **today**? | **Ethereum Mainnet (1) + Sepolia (11155111). That's it.** |
| Which L2s are in active testnet/beta as host chains? | **None.** |
| Confirmed near-term host-chain additions? | **Shibarium — Q2 2026** (per partnership announcement). No public testnet live yet. |
| Vague "soon" promises? | "Other EVM chains in H1 2026" was the line for ~12 months. We are now at end of H1 2026 and nothing has shipped. Treat as slipped. |
| Is Polygon a host chain or in testnet? | **No.** Earlier-2025 announcements implied "Polygon late 2025"; this also slipped. No public timeline today. |
| What about BSC, HyperEVM, Solana — they appear in Zama docs? | **Misleading.** Those pages list where the **$ZAMA token** is bridged via LayerZero OFT. The fhEVM coprocessor is **not** deployed there. You cannot deploy a confidential ERC20 on BSC/HyperEVM/Solana. |
| What about the Arbitrum rollup mentioned in the litepaper? | **Internal only.** Zama's Gateway runs on a dedicated Arbitrum L2 chain (chain id `261131` mainnet / `10901` testnet). dApps cannot deploy there — it's protocol infrastructure (decryption requests, KMS coordination). |
| Cheapest available path for PrivateBet? | **Ethereum mainnet (~$0.13–0.40 per encrypted op) + USDC bridge to/from Polygon.** No cheaper path exists today. |

---

## 2. Hard evidence (what's actually shipped)

### 2.1 The relayer SDK ships exactly two configs

`@zama-fhe/relayer-sdk` v0.4.3 (released 2026-05-06 — today) — `src/configs.ts` exports:

| Export | Chain ID | Gateway Chain ID |
|---|---|---|
| `MainnetConfig` | `1` (Ethereum mainnet) | `261131` |
| `MainnetConfigV1` / `MainnetConfigV2` | `1` | `261131` |
| `SepoliaConfig` | `11155111` | `10901` |
| `SepoliaConfigV1` / `SepoliaConfigV2` | `11155111` | `10901` |

**No L2 configs. No Arbitrum/Base/Optimism/BNB/Polygon objects exist in the SDK.** The V1/V2 variants are version migrations, not new chains.

Source: [zama-ai/relayer-sdk/src/configs.ts](https://github.com/zama-ai/relayer-sdk/blob/main/src/configs.ts), [.env.mainnet](https://github.com/zama-ai/relayer-sdk/blob/main/.env.mainnet), [.env.testnet](https://github.com/zama-ai/relayer-sdk/blob/main/.env.testnet).

### 2.2 What appears on the docs "chains" page (and what it actually means)

`docs.zama.org/protocol/protocol-apps/chains` lists:

| Chain | Chain ID | LayerZero EID | What's actually deployed |
|---|---|---|---|
| Ethereum | 1 | 30101 | **fhEVM coprocessor + $ZAMA token + cUSDC, cUSDT, cWETH, cBRON, cZAMA, ctGBP, cXAUt** |
| Gateway | 261131 | 30397 | Internal protocol only (dedicated Arbitrum rollup; not for dApp use) |
| BSC | 56 | 30102 | **$ZAMA OFT token only** (LayerZero bridge mint) |
| HyperEVM | 999 | 30367 | **$ZAMA OFT token only** |
| Solana | — | 30168 | **$ZAMA OFT token only (SPL)** |
| Sepolia (testnet) | 11155111 | 40161 | **fhEVM coprocessor (testnet)** |
| Gateway testnet | 10901 | 40424 | Internal protocol only |
| BSC Testnet | 97 | 40102 | $ZAMA OFT token only |

**The trap:** Reading "BSC: chain 56, deployed" in Zama docs naturally suggests "we can deploy a confidential ERC20 on BSC." We cannot. BSC has only the $ZAMA token (a normal ERC20 bridged from Ethereum via LayerZero), with no FHEVMExecutor, ACL, KMSVerifier, InputVerifier, or relayer. Same for HyperEVM and Solana. The only chains with the actual coprocessor stack are **Ethereum mainnet and Sepolia**.

### 2.3 Confidential ERC20 ecosystem on Ethereum is real and growing

Already deployed on Ethereum mainnet (a positive signal — we're not the first dApp):

- **cUSDC** — `0xe978F22157048E5DB8E5d07971376e86671672B2`
- cUSDT, cWETH, cZAMA, ctGBP (confidential GBP), cXAUt (confidential gold), cBRON

So on the chain we *can* use, the on-ramp from public USDC → cUSDC is already live and battle-tested.

---

## 3. Per-chain status (Arbitrum, Base, Optimism, BNB, Polygon)

| Chain | fhEVM host status | $ZAMA token bridged | Avg gas per tx (typical) | USDC native? | Bridge to Polygon | Encrypted ERC20 deployments |
|---|---|---|---|---|---|---|
| **Ethereum L1** (1) | **Live mainnet ✅** | Yes (canonical) | $0.50–$3 base; **$0.13–0.40 per encrypted op** | Yes | Polygon PoS Bridge (40 min–7 day exit) | **Yes — cUSDC, cUSDT, cWETH+** |
| **Arbitrum One** (42161) | ❌ Not a host chain. Zama uses *its own* Arbitrum rollup for the Gateway internally. | Not yet | $0.02–0.10 | Yes | Bungee/Across/Stargate (~$0.20, ~10 min) | None |
| **Base** (8453) | ❌ Not a host chain. Mentioned in 2024 marketing but no deployment. | Not yet | $0.01–0.05 | Yes | Across/Stargate | None |
| **Optimism** (10) | ❌ Not a host chain. No public roadmap. | Not yet | $0.01–0.05 | Yes | Across/Stargate | None |
| **BNB Chain** (56) | ❌ Token only (LayerZero OFT). No coprocessor. | **Yes (token only)** | $0.10–0.30 | Yes (BSC-USD = USDT mostly) | Multichain/Stargate (LayerZero) | None |
| **Polygon PoS** (137) | ❌ Not a host chain. Was implied for "late 2025"; slipped. No firm date. | Not yet | $0.01–0.05 | **Yes (native, where Polymarket lives)** | n/a (this is the destination) | None |
| **Shibarium** (109) | 🟡 **Confirmed Q2 2026** via SHIB partnership announcement. No public testnet yet. | Not yet | <$0.01 | No (uses BONE) | Indirect (would need 2 hops) | None |
| **HyperEVM** (999) | ❌ Token only. | Yes (token only) | low | No | Stargate/LayerZero | None |
| **Solana** | ❌ Token only (SPL OFT). Native SVM support is **H2 2026** roadmap. | Yes (token only) | very low | Yes | Wormhole/deBridge | None |

### 3.1 The "Arbitrum is used" red herring

Zama's Gateway runs on a dedicated Arbitrum L2 (Conduit-hosted) for performance/cost reasons. **This is internal protocol infrastructure**, not a host chain you can deploy to. Don't be fooled by litepaper text like *"the Gateway sits on a dedicated Arbitrum rollup"* — the FHEVMExecutor contract that your confidential ERC20 talks to lives on the host chain (Ethereum), not on the Gateway.

### 3.2 The "H1 2026 multichain" promise has slipped

Zama's repeated public line through 2025 was: *"Other EVM chains added in H1 2026 to enable cross-chain confidential assets and applications."* As of 2026-05-06 (effective end of H1 2026), **no L2 has been added**. There is no testnet, no SDK config, no contract address page, no blog post announcing a date. The team has been busy with: token launch (Jan 2026), governance/staking, Confidential Wrapper security upgrade (May 2026), and cross-chain *token* (OFT) deployments — but the actual host-chain expansion appears deprioritized.

Sources: [Litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper), [Bankless](https://www.bankless.com/read/confidentiality-layer-zama-wraps-blockchains-in-privacy), [Messari report](https://messari.io/report/understanding-zama-a-comprehensive-overview).

### 3.3 The one thing actually coming "soon"

**Shibarium (chain 109)** — Shiba Inu's Arbitrum-Orbit-based L2 — is the **only confirmed near-term host chain** addition. SHIB and Zama announced in November 2025 that Shibarium would natively integrate fhEVM by **Q2 2026**. Tests are reportedly underway, and Q2 2026 is now (April–June 2026). However:

- No public testnet endpoint.
- Shibarium has no native USDC (uses BONE).
- Bridging Shibarium → Polygon is multi-hop (Shibarium→Ethereum→Polygon) and slow.
- For PrivateBet specifically, this **does not solve the Polymarket co-residency problem** any better than Ethereum does.

Sources: [MEXC: Zama × Shibarium 2026](https://blog.mexc.com/news/what-is-zama-fhe-the-1b-unicorn-bringing-private-smart-contracts-to-ethereum-and-shibarium-2026/), [NullTX: Q2 2026 timeline](https://nulltx.com/shibarium-sets-2026-for-native-fhe-integration-as-zama-partnership-moves-forward/).

---

## 4. Cost model for PrivateBet (concrete numbers)

Assuming a confidential bet = 1 `transferFrom(stake)` + 1 record write ≈ 2 FHE.add + 1 input proof + 1 ACL grant.

| Path | Per-bet gas | Latency | Bridge round-trip overhead |
|---|---|---|---|
| **A. Ethereum mainnet only** (skip Polygon, settle on Ethereum somehow) | $0.20–0.40 | ~12s/block | n/a |
| **B. Ethereum mainnet + Polygon for Polymarket settlement** (USDC bridged once at deposit, kept on Eth for bets, withdraw bridges back) | $0.20–0.40/bet + $5–15 one-time bridge fees + $5–15 unwind | bet ~12s; bridge 5–40 min | $10–30 round-trip per user lifecycle |
| **C. Wait for Polygon host support** | <$0.01 in theory | ~2s/block | none |
| **D. Wait for Shibarium (Q2 2026)** | <$0.01 in theory | ~2s/block | doesn't help — no Polygon co-residency |

**Today there is no $0.50/tx path.** Path A/B are the only options that work; Path C is the dream but unscheduled.

---

## 5. Recommendation for PrivateBet

### 5.1 For Phase 2 (PoC)
Build on **Ethereum Sepolia** as planned in the OPE-265 report. The SDK works, OZ ERC-7984 is shipping, cUSDC reference deployment exists. **No reason to wait.**

### 5.2 For Phase 3 (production)
Adopt a **two-track plan** until Zama actually ships an L2 host:

**Track 1 — high-stakes confidential bets on Ethereum mainnet (live now).**
- Wrap USDC → cUSDC on Ethereum mainnet (cUSDC contract `0xe978F22…` already deployed).
- Bet flow stays on Ethereum.
- Bridge to Polygon **only at settlement** when interacting with Polymarket. Use Across or Stargate (cheaper than the official Polygon bridge for non-canonical exits).
- Acceptable economics for **bets ≥ $50** where 1–2% in gas+bridge is tolerable.
- **Ship this** if there's product appetite for institutional/whale-only confidential betting.

**Track 2 — wait for L2 host support before retail launch.**
- Retail-size bets ($1–$50) cannot absorb $0.20–0.40 in privacy gas, never mind bridge fees. They need Polygon host support (or at least a low-gas L2 host).
- Re-evaluate every 90 days. Specific signals to watch:
  - `@zama-fhe/relayer-sdk` adding any non-Sepolia/Mainnet config object.
  - A new page under `docs.zama.org/protocol/protocol-apps/addresses/mainnet/` for Polygon, Arbitrum, Base, Linea, or zkSync.
  - Zama blog post titled "fhEVM on \<chain\>" with contract addresses.
  - Shibarium's testnet going live as a litmus test for *whether multichain ships at all this year*.

### 5.3 What NOT to do
- **Do not** build assuming Polygon host support is imminent. The "H1 2026" commitment has visibly slipped and there's no published replacement date.
- **Do not** assume the BSC/HyperEVM token deployments mean the coprocessor is there. Verify by checking `addresses/mainnet/<chain>` for FHEVMExecutor + ACL + KMSVerifier + relayer URL — without those four, you can't deploy a confidential token.
- **Do not** plan to deploy on the Zama Gateway's Arbitrum rollup (chain 261131). It's not a public smart-contract platform.

---

## 6. Open questions to ask Zama directly

If a partnership conversation is possible, the questions worth asking:

1. **What's the actual ETA for Polygon host-chain support?** The "H1 2026" line is stale; what's the new date and what's the dependency?
2. **Will the Polygon deployment include a relayer URL like `relayer.polygon.zama.org`, or will Polygon dApps share the existing Ethereum relayer?**
3. **Is there a private/early-access program for projects that need Polygon host support before public GA?** (Polymarket-adjacent product might qualify.)
4. **Once Polygon is live, can a confidential token deployed there directly receive USDC from Polygon's native USDC contract?** Or will it always need a wrapper bridge?
5. **Cost model on a Polygon host:** what does an encrypted transfer cost on a chain where base gas is ~$0.005 instead of ~$0.50? Is the FHE component scale-invariant or does it depend on host gas pricing?

---

## 7. Sources

### Primary (authoritative)
- [`zama-ai/relayer-sdk` repo](https://github.com/zama-ai/relayer-sdk) — only Mainnet + Sepolia configs in code.
- [`.env.mainnet`](https://github.com/zama-ai/relayer-sdk/blob/main/.env.mainnet) — confirms chain 1 + gateway 261131 + relayer `mainnet.zama.org`.
- [`.env.testnet`](https://github.com/zama-ai/relayer-sdk/blob/main/.env.testnet) — confirms chain 11155111 + gateway 10901.
- [Zama Protocol docs sitemap](https://docs.zama.org/protocol/sitemap.md) — lists exactly Ethereum/Sepolia/Gateway as fhEVM chains; BSC/HyperEVM/Solana under `addresses/mainnet/` are token-bridge-only.
- [Zama Litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper) — confirms Gateway-on-Arbitrum is internal infra.
- [`zama-ai/fhevm` releases](https://github.com/zama-ai/fhevm/releases) — latest v0.12.3 (May 4 2026); no L2 deployments in changelogs.

### Roadmap / announcement (treat as marketing timelines)
- [Bankless: Zama Confidentiality Layer](https://www.bankless.com/read/confidentiality-layer-zama-wraps-blockchains-in-privacy)
- [Messari: Understanding Zama](https://messari.io/report/understanding-zama-a-comprehensive-overview)
- [BlockEden: Zama Protocol overview](https://blockeden.xyz/blog/2026/01/05/zama-protocol/)
- [MEXC: Zama × Shibarium 2026](https://blog.mexc.com/news/what-is-zama-fhe-the-1b-unicorn-bringing-private-smart-contracts-to-ethereum-and-shibarium-2026/)
- [NullTX: Shibarium Q2 2026 FHE integration](https://nulltx.com/shibarium-sets-2026-for-native-fhe-integration-as-zama-partnership-moves-forward/)
- [Cryptolifedigital: Shibarium × Zama Feb 2026](https://cryptolifedigital.com/2026/02/13/shibarium-advances-toward-full-on-chain-privacy-with-zama-integration/)

### Bridges (Polygon ↔ Ethereum reference)
- [Polygon Portal (canonical PoS Bridge)](https://portal.polygon.technology/bridge)
- [USDC LxLy bridge (BuildOnPolygon)](https://github.com/BuildOnPolygon/usdc-lxly)

### Prior PrivateBet research
- [`docs/reports/zama-fhevm-validation.md`](./zama-fhevm-validation.md) — OPE-265 validation report.
- [`docs/reports/bridge-poc.md`](./bridge-poc.md) — OPE-266 bridge PoC.
