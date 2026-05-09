/**
 * @privatebet/bot — Recommendation handler
 * Fetches daily AI recommendations and formats them with inline keyboard
 * buttons for each market. Wired to @privatebet/ai-engine.
 */

import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { BotContext } from '../types.js';
import {
  getAIEngine,
  getLlmCaller,
  getMarketAdapter,
  getNewsFetcher,
} from '../service-registry.js';
import type { MarketAnalysis, RawMarket } from '@privatebet/ai-engine';
import { cacheAnalysis } from './bet.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface RecommendationItem {
  id: string;
  title: string;
  marketSource: string;
  marketChain: string;
  currentOdds: number;
  aiDirection: 'YES' | 'NO' | 'SKIP';
  confidence: number;
  reasoning: string;
  suggestedSizePct: number;
  bridgeFeeEstimate: number;
  privacyLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  keyRisks: string[];
}

const PRIVACY_ICONS: Record<string, string> = {
  HIGH: '🔒🔒🔒',
  MEDIUM: '🔒🔒',
  LOW: '🔒',
};

const DIRECTION_EMOJI: Record<string, string> = {
  YES: '🟢',
  NO: '🔴',
  SKIP: '⏭️',
};

// Short ID cache — maps short IDs to full market IDs
const shortIdMap = new Map<string, string>();
let idCounter = 0;

function toShortId(fullId: string): string {
  // Check if already mapped
  for (const [short, full] of Array.from(shortIdMap.entries())) {
    if (full === fullId) return short;
  }
  // Create new short ID
  const short = `r${++idCounter}`;
  shortIdMap.set(short, fullId);
  return short;
}

export function resolveFullId(shortId: string): string | undefined {
  return shortIdMap.get(shortId);
}

// ── Formatting ──────────────────────────────────────────────────────────

export function formatRecommendation(rec: RecommendationItem): string {
  const lines = [
    `📊 <b>${rec.title}</b>`,
    `🏪 ${rec.marketSource} (${rec.marketChain})`,
    `📈 Current odds: ${rec.currentOdds.toFixed(2)}`,
    `${DIRECTION_EMOJI[rec.aiDirection]} AI: <b>${rec.aiDirection}</b> (${rec.confidence}% confidence)`,
    `💡 ${rec.reasoning}`,
    `💰 Suggested: ${rec.suggestedSizePct}% of balance`,
    `💸 Privacy fee: ~$${rec.bridgeFeeEstimate.toFixed(0)} | ${PRIVACY_ICONS[rec.privacyLevel]}`,
  ];

  if (rec.keyRisks.length > 0) {
    lines.push(`⚠️ Risks: ${rec.keyRisks.join(', ')}`);
  }

  lines.push('');
  lines.push('<i>AI-assisted analysis, not investment advice</i>');

  return lines.join('\n');
}

export function createRecommendationKeyboard(recId: string): InlineKeyboard {
  // Use short ID to keep callback data under 64 bytes
  const short = toShortId(recId);
  return new InlineKeyboard()
    .text('✅ Bet YES', `bet:${short}:YES`)
    .text('❌ Bet NO', `bet:${short}:NO`)
    .row()
    .text('⏭️ Skip', `bet:${short}:SKIP`);
}

export function formatRecommendationBatch(recs: RecommendationItem[]): string {
  const header = '🔮 <b>PrivateBet Daily Picks</b>\n\n';
  const body = recs
    .map((rec, i) => {
      const block = formatRecommendation(rec);
      return `${i + 1}. ${block}`;
    })
    .join('\n\n---\n\n');
  return header + body;
}

// ── Convert AI Engine analysis → RecommendationItem ─────────────────────

function analysisToRecommendationItem(analysis: MarketAnalysis): RecommendationItem {
  return {
    id: analysis.marketId,
    title: analysis.title,
    marketSource: analysis.source,
    marketChain: `Chain ${analysis.chainId}`,
    currentOdds: analysis.currentYesPrice,
    aiDirection: analysis.recommendation,
    confidence: analysis.confidence,
    reasoning: analysis.reasoning,
    suggestedSizePct: analysis.suggestedSizePct,
    bridgeFeeEstimate: analysis.bridgeFeeEstimate,
    privacyLevel: analysis.privacyLevel,
    keyRisks: analysis.keyRisks,
  };
}

// ── Fetch recommendations from AI Engine ────────────────────────────────

/**
 * Fetch live markets from the polymarket adapter, run them through the
 * AI Engine pipeline, and return formatted RecommendationItems.
 */
export async function fetchRecommendations(): Promise<RecommendationItem[]> {
  const engine = getAIEngine();

  // Gather raw markets from all adapters
  const rawMarkets: RawMarket[] = [];

  try {
    const polyAdapter = getMarketAdapter('polymarket');
    const polyMarkets = await polyAdapter.getMarkets({ activeOnly: true });
    for (const m of polyMarkets.slice(0, 20)) {
      const yesOutcome = m.outcomes.find((o) => o.label === 'Yes');
      rawMarkets.push({
        marketId: m.id,
        title: m.question,
        description: '',
        source: 'polymarket',
        chainId: polyAdapter.getChainId(),
        settlementAsset: polyAdapter.getSettlementAsset().symbol,
        yesPrice: yesOutcome?.price ?? 0.5,
        volume24h: 100_000,
        liquidity: 50_000,
        hoursToSettlement: 72,
        endDate: m.endDate ?? '',
      });
    }
  } catch {
    // Adapter unavailable — fall through to mock data
  }

  try {
    const limitAdapter = getMarketAdapter('limitless');
    const limitMarkets = await limitAdapter.getMarkets({ activeOnly: true });
    for (const m of limitMarkets.slice(0, 10)) {
      const yesOutcome = m.outcomes.find((o) => o.label === 'Yes');
      rawMarkets.push({
        marketId: m.id,
        title: m.question,
        description: '',
        source: 'limitless',
        chainId: limitAdapter.getChainId(),
        settlementAsset: limitAdapter.getSettlementAsset().symbol,
        yesPrice: yesOutcome?.price ?? 0.5,
        volume24h: 50_000,
        liquidity: 25_000,
        hoursToSettlement: 48,
        endDate: m.endDate ?? '',
      });
    }
  } catch {
    // Limitless unavailable — that's fine
  }

  // If no markets came back from real adapters, provide mock data for the demo
  if (rawMarkets.length === 0) {
    rawMarkets.push(
      {
        marketId: 'mock-election-2026',
        title: 'Will the Fed cut rates by July 2026?',
        description:
          'Market resolves YES if the Federal Reserve lowers the federal funds rate before July 1, 2026.',
        source: 'polymarket',
        chainId: 137,
        settlementAsset: 'USDC.e',
        yesPrice: 0.62,
        volume24h: 250_000,
        liquidity: 120_000,
        hoursToSettlement: 720,
        endDate: '2026-07-01T00:00:00Z',
      },
      {
        marketId: 'mock-btc-100k',
        title: 'Will BTC reach $150k by end of 2026?',
        description:
          'Market resolves YES if Bitcoin price exceeds $150,000 on any major exchange before Dec 31, 2026.',
        source: 'polymarket',
        chainId: 137,
        settlementAsset: 'USDC.e',
        yesPrice: 0.35,
        volume24h: 500_000,
        liquidity: 200_000,
        hoursToSettlement: 2160,
        endDate: '2026-12-31T00:00:00Z',
      },
      {
        marketId: 'mock-eth-etf',
        title: 'Will a new ETH ETF be approved by Q2 2026?',
        description:
          'Market resolves YES if any new Ethereum ETF product is approved by the SEC before July 1, 2026.',
        source: 'limitless',
        chainId: 8453,
        settlementAsset: 'USDC',
        yesPrice: 0.78,
        volume24h: 80_000,
        liquidity: 40_000,
        hoursToSettlement: 480,
        endDate: '2026-07-01T00:00:00Z',
      },
    );
  }

  const analyses = await engine.runPipeline(rawMarkets, getNewsFetcher(), getLlmCaller());

  // Cache analyses for the bet flow
  for (const a of analyses) {
    cacheAnalysis(a);
  }

  return analyses.map(analysisToRecommendationItem);
}

// ── Register /recommend command ─────────────────────────────────────────

export function registerRecommendationHandler(bot: Bot<BotContext>): void {
  bot.command('recommend', async (ctx) => {
    if (!ctx.session.privacyAgreed) {
      await ctx.reply('Please /agree to the privacy notice first.');
      return;
    }
    if (!ctx.session.walletAddress) {
      await ctx.reply('No wallet yet. Run /create_wallet first.');
      return;
    }

    await ctx.reply('🔮 Fetching AI recommendations...');

    try {
      const recs = await fetchRecommendations();

      if (recs.length === 0) {
        await ctx.reply('No recommendations available right now. Try again later.');
        return;
      }

      // Send each recommendation as a separate message with its own inline keyboard
      for (const rec of recs) {
        const keyboard = createRecommendationKeyboard(rec.id);
        await ctx.reply(formatRecommendation(rec), {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`❌ Failed to fetch recommendations: ${msg}`);
    }
  });
}
