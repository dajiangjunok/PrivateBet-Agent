import type { Context, SessionFlavor } from 'grammy';
import type { BetSide, MarketName } from '@privatebet/shared';

export type RiskPreference = 'low' | 'medium' | 'high';
export type PreferredMarket = MarketName | 'auto';

export interface UserSettings {
  pushTime: string;
  riskPreference: RiskPreference;
  preferredMarket: PreferredMarket;
  costLimitUsd?: number;
}

export interface BetFlowState {
  recommendationId: string;
  side: BetSide;
  selectedAmountUsd?: number;
  awaitingCustomAmount?: boolean;
}

export interface WithdrawFlowState {
  stage: 'address' | 'amount';
  address?: string;
}

export interface SessionData {
  privacyAgreed: boolean;
  walletAddress?: string;
  settings: UserSettings;
  pendingBet?: BetFlowState;
  awaitingWithdraw?: WithdrawFlowState;
}

export type BotContext = Context & SessionFlavor<SessionData>;

export const initialSession = (): SessionData => ({
  privacyAgreed: false,
  settings: {
    pushTime: '09:00',
    riskPreference: 'medium',
    preferredMarket: 'auto',
  },
});
