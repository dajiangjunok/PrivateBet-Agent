/**
 * Base canonical bridge adapter — Ethereum ⇄ Base (USDC).
 *
 * The OP Stack canonical bridge is trust-minimised but slow on the L2→L1 leg
 * (~7 days proof window). For Ethereum→Base it's near-instant once the L1
 * tx finalizes; for Base→Ethereum the orchestrator should normally prefer
 * Across (faster, marginal fee) and reserve this adapter for the
 * trust-minimised fallback path.
 *
 * Mock implementation only — interface fidelity to BridgeAdapter so the
 * orchestrator can be unit-tested without network.
 */

import type {
  BridgeAdapter,
  BridgeDepositReceipt,
  BridgeQuote,
  ChainId,
  TokenRef,
} from '../bridge-plan.js';

const ETHEREUM_BASE_BRIDGE: `0x${string}` = '0x3154Cf16ccdb4C6d922629664174b904d80F2C35';
const BASE_L2_BRIDGE: `0x${string}` = '0x4200000000000000000000000000000000000010';
const BASE_CHAIN_ID = 8453 as const;
const BASE_DEPOSIT_LATENCY_MS = 3 * 60 * 1000;
const BASE_WITHDRAWAL_LATENCY_MS = 7 * 24 * 60 * 60 * 1000;
const QUOTE_TTL_MS = 5 * 60 * 1000;

type BaseChainId = ChainId | typeof BASE_CHAIN_ID;

export class BaseBridgeAdapter implements BridgeAdapter {
  readonly kind = 'polygon-pos' as const;
  // ^ The bridge-plan.ts BridgeKind union does not yet include 'optimism-canonical';
  //   we reuse 'polygon-pos' (the trust-minimised fallback slot) and the orchestrator
  //   selects this adapter when the route is Ethereum↔Base. Adding a dedicated
  //   'op-canonical' BridgeKind is tracked for a follow-up.

  supports(input: TokenRef, output: TokenRef): boolean {
    const a = input.chainId as BaseChainId;
    const b = output.chainId as BaseChainId;
    const isRoute = (a === 1 && b === BASE_CHAIN_ID) || (a === BASE_CHAIN_ID && b === 1);
    if (!isRoute) return false;
    return (
      (input.variant === 'native-usdc' || input.variant === 'usdc-l1') &&
      (output.variant === 'native-usdc' || output.variant === 'usdc-l1')
    );
  }

  async quote(params: {
    input: TokenRef;
    output: TokenRef;
    amount: bigint;
    recipient: `0x${string}`;
  }): Promise<BridgeQuote> {
    if (!this.supports(params.input, params.output)) {
      throw new Error(
        `BaseBridgeAdapter: unsupported route ${params.input.chainId}→${params.output.chainId}`,
      );
    }
    const isWithdrawal = params.input.chainId === BASE_CHAIN_ID;
    const latency = isWithdrawal ? BASE_WITHDRAWAL_LATENCY_MS : BASE_DEPOSIT_LATENCY_MS;
    return {
      bridge: this.kind,
      inputToken: params.input,
      outputToken: params.output,
      inputAmount: params.amount,
      // Canonical bridge is fee-free; user only pays L1+L2 gas.
      outputAmount: params.amount,
      feeAmount: 0n,
      estimatedGasUsd: isWithdrawal
        ? { source: 0.05, destination: 4.0 }
        : { source: 3.0, destination: 0.02 },
      estimatedLatencyMs: latency,
      expiresAt: Date.now() + QUOTE_TTL_MS,
      raw: {
        provider: 'base-canonical',
        recipient: params.recipient,
        l1Bridge: ETHEREUM_BASE_BRIDGE,
        l2Bridge: BASE_L2_BRIDGE,
      },
    };
  }

  async submitDeposit(params: {
    quote: BridgeQuote;
    sender: `0x${string}`;
    recipient: `0x${string}`;
  }): Promise<BridgeDepositReceipt> {
    void params;
    return {
      bridge: this.kind,
      sourceTxHash: `0x${'dd'.repeat(32)}` as `0x${string}`,
      status: 'pending',
    };
  }

  requiredApprovalSpender(chainId: ChainId): `0x${string}` {
    if (chainId === 1) return ETHEREUM_BASE_BRIDGE;
    if ((chainId as BaseChainId) === BASE_CHAIN_ID) return BASE_L2_BRIDGE;
    throw new Error(`BaseBridgeAdapter: no bridge address for chain ${chainId}`);
  }

  async pollStatus(receipt: BridgeDepositReceipt): Promise<BridgeDepositReceipt> {
    if (receipt.status !== 'pending') return receipt;
    // Mock: deposit leg finalizes; withdrawal leg would still be pending in reality.
    return {
      ...receipt,
      status: 'filled',
      destinationTxHash: `0x${'ee'.repeat(32)}` as `0x${string}`,
      fillTimestamp: Date.now(),
    };
  }
}
