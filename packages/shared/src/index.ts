export const PACKAGE_NAME = '@privatebet/shared';

// ─── Market identification ────────────────────────────────────
export type MarketName = 'polymarket' | 'limitless';
export type ChainName = 'polygon' | 'base' | 'ethereum' | 'sepolia';

export interface MarketInfo {
  name: MarketName;
  displayName: string;
  chain: ChainName;
  chainDisplayName: string;
  chainId: number;
}

// ─── Privacy ──────────────────────────────────────────────────
export type PrivacyLevel = 1 | 2 | 3;

// ─── Cost estimate (USD) ──────────────────────────────────────
export interface CostEstimate {
  gasFeeUsd: number;
  bridgeFeeUsd: number;
  fheFeeUsd: number;
  totalFeeUsd: number;
}

// ─── Recommendations ──────────────────────────────────────────
export type BetSide = 'YES' | 'NO';

export interface MarketSummary {
  id: string;
  question: string;
  endDate: string;
  outcomes: string[];
}

export interface Recommendation {
  id: string;
  market: MarketInfo;
  title: string;
  question: string;
  currentOdds: { yes: number; no: number };
  aiDirection: BetSide;
  confidence: number;
  costEstimate: CostEstimate;
  privacyLevel: PrivacyLevel;
  rationale: string;
  endDate: string;
}

// Legacy alias for older callers — prefer Recommendation.
export interface BetRecommendation {
  marketId: string;
  outcome: string;
  confidence: number;
  rationale: string;
}

// ─── Bet flow ─────────────────────────────────────────────────
export interface BetRequest {
  id: string;
  userId: number;
  recommendationId: string;
  side: BetSide;
  amountUsd: number;
}

export type BetStage =
  | 'pending'
  | 'mixing'
  | 'bridging'
  | 'placing'
  | 'placed'
  | 'filled'
  | 'failed';

export interface BetStatus {
  requestId: string;
  stage: BetStage;
  message?: string;
  txHash?: string;
  filledAmountUsd?: number;
  updatedAt: string;
}

// ─── User context ─────────────────────────────────────────────
export interface UserContext {
  telegramUserId: number;
  walletAddress?: string;
}

// ─── Helpers ──────────────────────────────────────────────────
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
