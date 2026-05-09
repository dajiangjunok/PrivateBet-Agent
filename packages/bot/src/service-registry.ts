/**
 * @privatebet/bot — Service Registry
 *
 * Singleton instances of all backend services, initialized once and shared
 * across all bot handlers. Mock mode is the default; swap internals for live
 * wiring when ready.
 */

import { AIEngine, createLlmCaller, createNewsFetcher } from '@privatebet/ai-engine';
import type { RawMarket } from '@privatebet/ai-engine';
import {
  PrivacyService,
  CrossChainBetOrchestrator,
  AcrossAdapter,
  DEFAULT_PRIVACY_CONFIG,
} from '@privatebet/privacy-layer';
import type { OrchestratorOptions, BridgeAdapter } from '@privatebet/privacy-layer';
import { WalletService } from '@privatebet/wallet-service';
import { PolymarketAdapter, LimitlessAdapter } from '@privatebet/polymarket-client';
import type { PredictionMarketAdapter } from '@privatebet/polymarket-client';

// ── Singleton instances ─────────────────────────────────────────────────

let aiEngine: AIEngine | null = null;
let llmCaller: ((prompt: string) => Promise<string>) | null = null;
let newsFetcher: ((market: RawMarket) => Promise<string>) | null = null;
let privacyService: PrivacyService | null = null;
let bridgeAdapter: BridgeAdapter | null = null;
let orchestrator: CrossChainBetOrchestrator | null = null;
let walletService: WalletService | null = null;
let polymarketAdapter: PolymarketAdapter | null = null;
let limitlessAdapter: LimitlessAdapter | null = null;

// ── Accessors (lazy-init, singletons) ───────────────────────────────────

export function getAIEngine(): AIEngine {
  if (!aiEngine) {
    aiEngine = new AIEngine();
  }
  return aiEngine;
}

export function getLlmCaller(): (prompt: string) => Promise<string> {
  if (!llmCaller) {
    llmCaller = createLlmCaller();
  }
  return llmCaller;
}

export function getNewsFetcher(): (market: RawMarket) => Promise<string> {
  if (!newsFetcher) {
    newsFetcher = createNewsFetcher();
  }
  return newsFetcher;
}

export function getPrivacyService(): PrivacyService {
  if (!privacyService) {
    const hasPrivateKey = !!process.env['PRIVATE_KEY'];
    const hasContract = !!process.env['CONFIDENTIAL_ERC20_ADDR'];
    const liveMode = hasPrivateKey && hasContract;

    privacyService = new PrivacyService({
      ...DEFAULT_PRIVACY_CONFIG,
      mockMode: !liveMode,
      rpcUrl: process.env['SEPOLIA_RPC_URL'] || 'https://ethereum-sepolia-rpc.publicnode.com',
      relayerUrl: process.env['ZAMA_RELAYER_URL'] || 'https://relayer.testnet.zama.org/',
      confidentialWrapper: (process.env['CONFIDENTIAL_ERC20_ADDR'] ||
        DEFAULT_PRIVACY_CONFIG.confidentialWrapper) as `0x${string}`,
    });

    console.log(
      `🔐 Privacy mode: ${liveMode ? 'LIVE (ZAMA Sepolia)' : 'MOCK (set PRIVATE_KEY + CONFIDENTIAL_ERC20_ADDR for live)'}`,
    );
  }
  return privacyService;
}

export function getBridgeAdapter(): BridgeAdapter {
  if (!bridgeAdapter) {
    bridgeAdapter = new AcrossAdapter();
  }
  return bridgeAdapter;
}

export function getOrchestrator(): CrossChainBetOrchestrator {
  if (!orchestrator) {
    const opts: OrchestratorOptions = {
      privacy: getPrivacyService(),
      bridge: getBridgeAdapter(),
      defaultMixHops: 2,
    };
    orchestrator = new CrossChainBetOrchestrator(opts);
  }
  return orchestrator;
}

export function getWalletService(): WalletService {
  if (!walletService) {
    walletService = new WalletService();
  }
  return walletService;
}

export function getPolymarketAdapter(): PolymarketAdapter {
  if (!polymarketAdapter) {
    polymarketAdapter = new PolymarketAdapter();
  }
  return polymarketAdapter;
}

export function getLimitlessAdapter(): LimitlessAdapter {
  if (!limitlessAdapter) {
    limitlessAdapter = new LimitlessAdapter();
  }
  return limitlessAdapter;
}

/**
 * Resolve the correct adapter for a given market source name.
 */
export function getMarketAdapter(source: string): PredictionMarketAdapter {
  switch (source) {
    case 'polymarket':
      return getPolymarketAdapter();
    case 'limitless':
      return getLimitlessAdapter();
    default:
      return getPolymarketAdapter();
  }
}

/**
 * Reset all singletons (useful for tests).
 */
export function resetRegistry(): void {
  aiEngine = null;
  llmCaller = null;
  newsFetcher = null;
  privacyService = null;
  bridgeAdapter = null;
  orchestrator = null;
  walletService = null;
  polymarketAdapter = null;
  limitlessAdapter = null;
}
