/**
 * OPE-266 — Polygon ↔ Ethereum Bridge Integration Plan
 *
 * Interfaces and function signatures for the cross-chain orchestrator that moves
 * USDC between Polygon (where Polymarket settles in pUSD/USDC.e) and Ethereum
 * mainnet (where ZAMA fhEVM lives and confidential cUSDC is wrapped).
 *
 * This file defines the contract shape only — no live implementation. The v1
 * backend will be Across Protocol; CCTP, Stargate, and eventually a "no bridge"
 * direct-Polygon-host path are all expected to slot in as alternative
 * implementations of `BridgeAdapter`.
 *
 * See docs/reports/bridge-poc.md for the rationale behind this design.
 */

// ────────────────────────────────────────────────────────────────────────────
//   Chain & token model
// ────────────────────────────────────────────────────────────────────────────

export type ChainId = 1 | 137 | 8453 | 11155111 | 80002;

export const CHAIN_IDS = {
  ethereum: 1 as const,
  polygon: 137 as const,
  sepolia: 11155111 as const,
  amoy: 80002 as const,
};

/** USDC has multiple variants on Polygon; bridges are not interchangeable across them. */
export type UsdcVariant =
  | 'native-usdc' // Circle's native USDC (Polygon: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)
  | 'usdc-e' //      Bridged USDC.e / pUSD — what Polymarket uses
  | 'usdc-l1'; //    Native USDC on Ethereum mainnet

export interface TokenRef {
  chainId: ChainId;
  address: `0x${string}`;
  variant: UsdcVariant;
  decimals: 6;
}

// ────────────────────────────────────────────────────────────────────────────
//   Bridge adapter interface
// ────────────────────────────────────────────────────────────────────────────

export type BridgeKind = 'across' | 'cctp' | 'stargate' | 'polygon-pos' | 'hop';

export interface BridgeQuote {
  bridge: BridgeKind;
  inputToken: TokenRef;
  outputToken: TokenRef;
  inputAmount: bigint;
  /** What the user actually receives on the destination chain, after fees. */
  outputAmount: bigint;
  /** Protocol + relayer fee in input token's smallest unit. */
  feeAmount: bigint;
  /** Estimated gas cost in USD on each leg. */
  estimatedGasUsd: { source: number; destination: number };
  /** Estimated end-to-end latency. */
  estimatedLatencyMs: number;
  /** Quote expiry; if missed, requote. */
  expiresAt: number;
  /** Implementation-specific blob; passed back into `submitDeposit`. */
  raw: unknown;
}

export interface BridgeDepositReceipt {
  bridge: BridgeKind;
  sourceTxHash: `0x${string}`;
  /** Set once the relayer/bridge has finalized on the destination chain. */
  destinationTxHash?: `0x${string}`;
  status: 'pending' | 'filled' | 'refunded' | 'failed';
  fillTimestamp?: number;
}

export interface BridgeAdapter {
  readonly kind: BridgeKind;

  supports(input: TokenRef, output: TokenRef): boolean;

  quote(params: {
    input: TokenRef;
    output: TokenRef;
    amount: bigint;
    recipient: `0x${string}`;
  }): Promise<BridgeQuote>;

  /**
   * Submit a deposit on the source chain. Caller is responsible for token
   * approval; `requiredApprovalSpender` returns the address to approve.
   */
  submitDeposit(params: {
    quote: BridgeQuote;
    sender: `0x${string}`;
    recipient: `0x${string}`;
  }): Promise<BridgeDepositReceipt>;

  requiredApprovalSpender(chainId: ChainId): `0x${string}`;

  /** Poll for fill status; returns updated receipt. */
  pollStatus(receipt: BridgeDepositReceipt): Promise<BridgeDepositReceipt>;
}

// ────────────────────────────────────────────────────────────────────────────
//   ZAMA wrapper-side interface (mirrors the encrypted ERC20 wrapper from OPE-265)
// ────────────────────────────────────────────────────────────────────────────

export interface ConfidentialWrapperAdapter {
  /** Address of the ConfidentialERC20Wrapped / ERC-7984 wrapper on Ethereum. */
  readonly address: `0x${string}`;
  readonly underlying: TokenRef; // public USDC on L1

  /** Public USDC → encrypted cUSDC. Amount is plaintext (visible on-chain). */
  wrap(params: { sender: `0x${string}`; amount: bigint }): Promise<{ txHash: `0x${string}` }>;

  /**
   * Encrypted cUSDC → public USDC. Amount is an encrypted handle; the wrapper
   * issues a decryption request to the KMS gateway, which calls back to release
   * the public USDC. Returns once the callback is observed.
   */
  unwrap(params: {
    sender: `0x${string}`;
    encryptedAmountHandle: `0x${string}`;
    /** Max time to wait for the gateway decryption callback (ms). */
    timeoutMs: number;
  }): Promise<{
    initiateTxHash: `0x${string}`;
    callbackTxHash: `0x${string}`;
    plaintextAmount: bigint;
  }>;
}

// ────────────────────────────────────────────────────────────────────────────
//   Cross-chain orchestrator (the engineering surface that holds the state machine)
// ────────────────────────────────────────────────────────────────────────────

export type DepositStage =
  | 'idle'
  | 'awaiting-source-approval'
  | 'bridging-l2-to-l1'
  | 'bridge-confirmed-on-l1'
  | 'awaiting-wrap-approval'
  | 'wrapping-to-cusdc'
  | 'complete'
  | 'failed-refunded'
  | 'failed';

export type WithdrawStage =
  | 'idle'
  | 'requesting-unwrap'
  | 'awaiting-decrypt-callback'
  | 'unwrap-complete-on-l1'
  | 'awaiting-bridge-approval'
  | 'bridging-l1-to-l2'
  | 'bridge-confirmed-on-l2'
  | 'optional-swap-pending'
  | 'complete'
  | 'failed';

export interface DepositRequest {
  user: `0x${string}`;
  sourceToken: TokenRef; // expected: USDC.e or native USDC on Polygon
  amount: bigint;
  /** If true, refuse the operation if estimated total cost exceeds this fraction of `amount`. */
  maxCostFraction?: number; // e.g. 0.05 → refuse if total gas+fees > 5% of bet size
}

export interface DepositState {
  stage: DepositStage;
  request: DepositRequest;
  bridgeReceipt?: BridgeDepositReceipt;
  wrapTxHash?: `0x${string}`;
  encryptedBalanceHandle?: `0x${string}`;
  costBreakdown: CostBreakdown;
  startedAt: number;
  updatedAt: number;
  error?: string;
}

export interface WithdrawRequest {
  user: `0x${string}`;
  encryptedAmountHandle: `0x${string}`;
  /** Final destination token on Polygon (typically USDC.e for re-betting on Polymarket). */
  destinationToken: TokenRef;
}

export interface WithdrawState {
  stage: WithdrawStage;
  request: WithdrawRequest;
  unwrapTxHashes?: { initiate: `0x${string}`; callback: `0x${string}` };
  bridgeReceipt?: BridgeDepositReceipt;
  swapTxHash?: `0x${string}`;
  costBreakdown: CostBreakdown;
  startedAt: number;
  updatedAt: number;
  error?: string;
}

export interface CostBreakdown {
  bridgeFeeUsd: number;
  l1GasUsd: number;
  l2GasUsd: number;
  fheGasUsd: number;
  swapFeeUsd: number;
  totalUsd: number;
}

export interface CrossChainOrchestrator {
  startDeposit(req: DepositRequest): Promise<DepositState>;
  pollDeposit(state: DepositState): Promise<DepositState>;

  startWithdraw(req: WithdrawRequest): Promise<WithdrawState>;
  pollWithdraw(state: WithdrawState): Promise<WithdrawState>;

  /** Quote the full round-trip without committing. Useful for the cost gate. */
  estimate(req: DepositRequest | WithdrawRequest): Promise<CostBreakdown>;
}

// ────────────────────────────────────────────────────────────────────────────
//   Configuration
// ────────────────────────────────────────────────────────────────────────────

export interface OrchestratorConfig {
  ethereum: {
    chainId: 1 | 11155111;
    rpcUrl: string;
    confidentialWrapper: `0x${string}`;
    nativeUsdc: `0x${string}`;
  };
  polygon: {
    chainId: 137 | 80002;
    rpcUrl: string;
    nativeUsdc: `0x${string}`;
    usdcE: `0x${string}`; // pUSD / USDC.e — Polymarket collateral
    /** Optional: Uniswap V3 pool for USDC ↔ USDC.e swaps. */
    usdcSwapRouter?: `0x${string}`;
  };
  bridge: {
    primary: BridgeKind; // recommended: 'across'
    fallback?: BridgeKind; // recommended: 'polygon-pos' (trust-minimized, slow)
  };
  policy: {
    /** Refuse deposits if estimated total cost > this fraction of bet size. */
    maxCostFraction: number; // default 0.05
    /** Max wait for ZAMA decryption callback before surfacing error. */
    decryptCallbackTimeoutMs: number; // default 15 * 60 * 1000
    /** Max wait for bridge fill before surfacing error / triggering refund. */
    bridgeFillTimeoutMs: number; // default 30 * 60 * 1000
  };
}
