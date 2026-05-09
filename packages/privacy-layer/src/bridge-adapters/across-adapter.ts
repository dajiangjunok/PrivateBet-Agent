/**
 * Across Protocol bridge adapter — Ethereum ⇄ Polygon (USDC / USDC.e).
 *
 * Across is an optimistic, intent-based bridge: the user deposits to a
 * SpokePool on the source chain, relayers fill on the destination chain,
 * UMA OO settles disputes asynchronously. Typical fill latency is ~30s on
 * mainnet routes, fees are ~0.05%–0.15% on USDC.
 *
 * v1 backend per docs/reports/bridge-poc.md. Live wiring will hit the
 * Across API at https://app.across.to/api for quotes; here we ship an
 * interface-faithful mock that returns deterministic values so callers
 * (CrossChainOrchestrator) can be exercised end-to-end without network.
 */

import type {
  BridgeAdapter,
  BridgeDepositReceipt,
  BridgeQuote,
  ChainId,
  TokenRef,
} from '../bridge-plan.js';

const SPOKE_POOL_BY_CHAIN: Partial<Record<ChainId, `0x${string}`>> = {
  1: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  137: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096',
  11155111: '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662',
  80002: '0x4e8E101924eDE233C13e2D8622DC8aED2872d505',
};

const ACROSS_FEE_BPS = 8n; // 0.08%
const ACROSS_LATENCY_MS = 45_000;
const ACROSS_QUOTE_TTL_MS = 60_000;

export class AcrossAdapter implements BridgeAdapter {
  readonly kind = 'across' as const;

  supports(input: TokenRef, output: TokenRef): boolean {
    const validRoute =
      (input.chainId === 1 && output.chainId === 137) ||
      (input.chainId === 137 && output.chainId === 1) ||
      (input.chainId === 11155111 && output.chainId === 80002) ||
      (input.chainId === 80002 && output.chainId === 11155111);
    if (!validRoute) return false;
    // Across handles native USDC and USDC.e on the supported routes.
    const isUsdcLike = (t: TokenRef): boolean =>
      t.variant === 'native-usdc' || t.variant === 'usdc-e' || t.variant === 'usdc-l1';
    return isUsdcLike(input) && isUsdcLike(output);
  }

  async quote(params: {
    input: TokenRef;
    output: TokenRef;
    amount: bigint;
    recipient: `0x${string}`;
  }): Promise<BridgeQuote> {
    if (!this.supports(params.input, params.output)) {
      throw new Error(
        `AcrossAdapter: unsupported route ${params.input.chainId}→${params.output.chainId}`,
      );
    }
    const feeAmount = (params.amount * ACROSS_FEE_BPS) / 10_000n;
    const outputAmount = params.amount - feeAmount;
    return {
      bridge: 'across',
      inputToken: params.input,
      outputToken: params.output,
      inputAmount: params.amount,
      outputAmount,
      feeAmount,
      estimatedGasUsd: { source: 1.5, destination: 0.02 },
      estimatedLatencyMs: ACROSS_LATENCY_MS,
      expiresAt: Date.now() + ACROSS_QUOTE_TTL_MS,
      raw: { provider: 'across', recipient: params.recipient, version: 'v3' },
    };
  }

  async submitDeposit(params: {
    quote: BridgeQuote;
    sender: `0x${string}`;
    recipient: `0x${string}`;
  }): Promise<BridgeDepositReceipt> {
    // Mock: the live path calls SpokePool.depositV3(...) on the source chain.
    void params;
    return {
      bridge: 'across',
      sourceTxHash: `0x${'aa'.repeat(32)}` as `0x${string}`,
      status: 'pending',
    };
  }

  requiredApprovalSpender(chainId: ChainId): `0x${string}` {
    const spender = SPOKE_POOL_BY_CHAIN[chainId];
    if (!spender) {
      throw new Error(`AcrossAdapter: no SpokePool address known for chain ${chainId}`);
    }
    return spender;
  }

  async pollStatus(receipt: BridgeDepositReceipt): Promise<BridgeDepositReceipt> {
    if (receipt.status !== 'pending') return receipt;
    // Mock: assume the relayer has filled by the time the caller polls.
    return {
      ...receipt,
      status: 'filled',
      destinationTxHash: `0x${'bb'.repeat(32)}` as `0x${string}`,
      fillTimestamp: Date.now(),
    };
  }
}
