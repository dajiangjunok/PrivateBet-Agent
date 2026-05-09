/**
 * @privatebet/privacy-layer — public API surface
 *
 * Re-exports every class, interface, and type that external consumers need.
 * Internal helpers (mock helpers, stage base class) are intentionally not
 * re-exported.
 */

// ── Legacy PrivacyLayer (defined here for backward compat) ──────────────
import type { BetRecommendation } from '@privatebet/shared';

export interface PrivacyLayerOptions {
  gatewayUrl: string;
  relayerUrl: string;
  publicKeyPath?: string;
}

export interface EncryptedBet {
  ciphertext: string;
  proof: string;
}

export class PrivacyLayer {
  private readonly options: PrivacyLayerOptions;

  constructor(options: PrivacyLayerOptions) {
    this.options = options;
  }

  async encryptBet(_bet: BetRecommendation): Promise<EncryptedBet> {
    return { ciphertext: '', proof: '' };
  }

  getGatewayUrl(): string {
    return this.options.gatewayUrl;
  }
}

// ── Bridge plan — interfaces, types, and config ──────────────────────────
export type {
  ChainId,
  UsdcVariant,
  TokenRef,
  BridgeKind,
  BridgeQuote,
  BridgeDepositReceipt,
  BridgeAdapter,
  ConfidentialWrapperAdapter,
  DepositStage,
  WithdrawStage,
  DepositRequest,
  DepositState,
  WithdrawRequest,
  WithdrawState,
  CostBreakdown,
  CrossChainOrchestrator as CrossChainOrchestratorInterface,
  OrchestratorConfig,
} from './bridge-plan.js';

export { CHAIN_IDS } from './bridge-plan.js';

// ── Privacy service — operation façade (ZAMA mock) ──────────────────────
export type {
  Hex,
  PrivacyOperationKind,
  PrivacyOperationStatus,
  PrivacyOperation,
  PrivacyServiceConfig,
  NetworkStatus,
  PrivacyHealthStatus,
} from './privacy-service.js';

export {
  PrivacyService,
  DEFAULT_PRIVACY_CONFIG,
  ZAMA_DEFAULT_RELAYER_URL,
} from './privacy-service.js';

// ── Cross-chain bet orchestrator — stage runners + orchestrator ──────────
export type {
  StageStatus,
  StageState,
  Stage,
  BetFlowStage,
  DepositStageInput,
  DepositStageOutput,
  PrivacyStageInput,
  PrivacyStageOutput,
  BridgeStageInput,
  BridgeStageOutput,
  BetStageInput,
  BetStageOutput,
  FlowStatus,
  FlowRequest,
  FlowState,
  OrchestratorOptions,
} from './cross-chain-orchestrator.js';

export {
  DepositStageRunner,
  PrivacyStageRunner,
  BridgeStageRunner,
  BetStageRunner,
  CrossChainBetOrchestrator,
} from './cross-chain-orchestrator.js';

// ── Bridge adapters ─────────────────────────────────────────────────────
export { AcrossAdapter } from './bridge-adapters/across-adapter.js';
export { BaseBridgeAdapter } from './bridge-adapters/base-bridge-adapter.js';
