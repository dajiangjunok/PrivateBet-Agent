# Truemarkets Feasibility Check — Ethereum Zero-Bridge Path

**Ticket:** OPE-276 — Truemarkets 可行性验证
**Date:** 2026-05-06
**Verdict:** **NO-GO** — Ethereum L1 deployment does not have active prediction market liquidity

## Findings

1. **Truemarkets architecture:** Hybrid CeFi/DeFi model. The CeFi side (TrueX REST API) handles order matching off-chain. The on-chain settlement side uses Uniswap V3 pools on Base (not Ethereum mainnet as initially claimed).

2. **Ethereum L1 presence:** Truemarkets' marketing mentions "Ethereum + Base" deployment, but the actual prediction market contracts are on **Base (8453)**, not Ethereum mainnet (1). The Ethereum side appears to be limited to the $TRUE governance token, not prediction market contracts.

3. **Liquidity:** Volume not publicly disclosed. Launched in 2025 with Vitalik backing, but no evidence of significant prediction market trading volume on any chain.

4. **API:** TrueX REST API exists for the CeFi side, but the on-chain settlement documentation is minimal. No SDK or first-party TypeScript library.

5. **Settlement asset:** USDC on Base — same as Limitless, no advantage.

## Conclusion

Truemarkets does **not** provide a zero-bridge Ethereum L1 prediction market. It's another Base chain market, making it equivalent to Limitless from PrivateBet's perspective — requires Ethereum↔Base bridge (~$5).

**Recommendation:** Close this investigation. Limitless remains the better Base-chain option due to higher volume, documented API, and CLOB support.

## Impact on architecture

No changes needed. The current two-market plan (Polymarket on Polygon + Limitless on Base) remains correct. If a future market launches on Ethereum L1 with real liquidity, the PredictionMarketAdapter interface supports immediate integration.
