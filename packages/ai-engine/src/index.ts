/**
 * @privatebet/ai-engine — Cross-market AI recommendation engine
 * Analyzes prediction markets across multiple venues and generates recommendations
 */

// --- Types ---

export interface MarketFilter {
  minVolume24h: number;
  minLiquidity: number;
  minTimeToSettlementHours: number;
  maxResults?: number;
  sources?: string[];
}

export interface RawMarket {
  marketId: string;
  title: string;
  description: string;
  source: string;
  chainId: number;
  settlementAsset: string;
  yesPrice: number;
  volume24h: number;
  liquidity: number;
  hoursToSettlement: number;
  endDate: string;
}

export interface MarketAnalysis {
  marketId: string;
  title: string;
  source: string;
  chainId: number;
  currentYesPrice: number;
  recommendation: 'YES' | 'NO' | 'SKIP';
  confidence: number;
  reasoning: string;
  suggestedSizePct: number;
  keyRisks: string[];
  bridgeFeeEstimate: number;
  privacyLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface CrossMarketComparison {
  eventTitle: string;
  markets: Array<{
    source: string;
    chainId: number;
    yesPrice: number;
    bridgeFeeEstimate: number;
    privacyLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  bestOddsSource: string;
  cheapestSource: string;
}

const DEFAULT_FILTER: MarketFilter = {
  minVolume24h: 50000,
  minLiquidity: 10000,
  minTimeToSettlementHours: 24,
  maxResults: 5,
};

// --- Bridge cost estimates by chain ---

const BRIDGE_COST_ESTIMATE: Record<number, number> = {
  1: 0, // Ethereum — no bridge needed
  137: 15, // Polygon — ~$15 bridge fee
  8453: 5, // Base — ~$5 bridge fee
};

const PRIVACY_BY_CHAIN: Record<number, 'HIGH' | 'MEDIUM' | 'LOW'> = {
  1: 'HIGH', // Same chain as ZAMA
  8453: 'MEDIUM', // Cheap bridge to ETH
  137: 'LOW', // Expensive bridge to ETH
};

// --- Filtering ---

export function filterMarkets(
  markets: RawMarket[],
  filter: MarketFilter = DEFAULT_FILTER,
): RawMarket[] {
  return markets
    .filter((m) => {
      return (
        m.volume24h >= filter.minVolume24h &&
        m.liquidity >= filter.minLiquidity &&
        m.hoursToSettlement >= filter.minTimeToSettlementHours
      );
    })
    .sort((a, b) => b.volume24h - a.volume24h);
}

// --- Cross-market deduplication ---

export function deduplicateMarkets(markets: RawMarket[]): CrossMarketComparison[] {
  // Group by normalized title (simple version)
  const groups = new Map<string, RawMarket[]>();

  for (const m of markets) {
    // Normalize: lowercase, remove punctuation
    const key = m.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
    const existing = groups.get(key) || [];
    existing.push(m);
    groups.set(key, existing);
  }

  const comparisons: CrossMarketComparison[] = [];

  for (const [_key, group] of groups) {
    if (group.length === 0) continue;

    const marketsWithMeta = group.map((m) => ({
      source: m.source,
      chainId: m.chainId,
      yesPrice: m.yesPrice,
      bridgeFeeEstimate: BRIDGE_COST_ESTIMATE[m.chainId] ?? 10,
      privacyLevel: PRIVACY_BY_CHAIN[m.chainId] ?? ('LOW' as const),
    }));

    // Best odds = highest YES price if you want YES, lowest if NO
    // Simplified: just pick the one with most extreme price
    const sortedByOdds = [...marketsWithMeta].sort(
      (a, b) => Math.abs(b.yesPrice - 0.5) - Math.abs(a.yesPrice - 0.5),
    );
    const sortedByCost = [...marketsWithMeta].sort(
      (a, b) => a.bridgeFeeEstimate - b.bridgeFeeEstimate,
    );

    comparisons.push({
      eventTitle: group[0]?.title ?? 'Unknown',
      markets: marketsWithMeta,
      bestOddsSource: sortedByOdds[0]?.source ?? '',
      cheapestSource: sortedByCost[0]?.source ?? '',
    });
  }

  return comparisons;
}

// --- LLM Prompt Template ---

export function buildAnalysisPrompt(market: RawMarket, newsContext: string): string {
  return `You are a prediction market analyst. Analyze this market:

【Market Title】${market.title}
【Market Description】${market.description}
【Source】${market.source} (Chain ${market.chainId})
【Settlement Time】${market.endDate}
【Current YES Price】${market.yesPrice}
【24h Volume】$${market.volume24h.toLocaleString()}

【Recent News】
${newsContext}

Output JSON only:
{
  "recommendation": "YES" | "NO" | "SKIP",
  "confidence": 0-100,
  "reasoning": "Under 100 chars",
  "suggested_size_pct": 0-5,
  "key_risks": ["risk1", "risk2"]
}

Only give YES/NO when confidence >= 65. Otherwise SKIP.`;
}

// --- Pipeline Orchestrator ---

export class AIEngine {
  private filter: MarketFilter;

  constructor(filter?: MarketFilter) {
    this.filter = filter || DEFAULT_FILTER;
  }

  /**
   * Run the full analysis pipeline
   * Step 1: Fetch markets from all sources
   * Step 2: Filter by volume/liquidity/time
   * Step 3: Deduplicate across sources
   * Step 4: Fetch news for top markets
   * Step 5: Run LLM analysis
   * Step 6: Rank and return top recommendations
   */
  async runPipeline(
    allMarkets: RawMarket[],
    newsFetcher?: (market: RawMarket) => Promise<string>,
    llmCaller?: (prompt: string) => Promise<string>,
  ): Promise<MarketAnalysis[]> {
    // Step 1-2: Filter
    const filtered = filterMarkets(allMarkets, this.filter);
    console.log(`Filtered: ${filtered.length} markets from ${allMarkets.length} total`);

    // Step 3: Deduplicate
    const comparisons = deduplicateMarkets(filtered);

    // Step 4-5: Analyze top markets
    const analyses: MarketAnalysis[] = [];

    for (const comp of comparisons.slice(0, 30)) {
      // Pick the best market from each group (cheapest first)
      const bestMarket =
        filtered.find((m) => m.source === comp.cheapestSource && m.title === comp.eventTitle) ||
        filtered.find((m) => m.title === comp.eventTitle);

      if (!bestMarket) continue;

      let analysis: Partial<MarketAnalysis> = {
        marketId: bestMarket.marketId,
        title: bestMarket.title,
        source: bestMarket.source,
        chainId: bestMarket.chainId,
        currentYesPrice: bestMarket.yesPrice,
        bridgeFeeEstimate: BRIDGE_COST_ESTIMATE[bestMarket.chainId] ?? 10,
        privacyLevel: PRIVACY_BY_CHAIN[bestMarket.chainId] ?? 'LOW',
      };

      if (newsFetcher && llmCaller) {
        try {
          const news = await newsFetcher(bestMarket);
          const prompt = buildAnalysisPrompt(bestMarket, news);
          const llmOutput = await llmCaller(prompt);

          const parsed = JSON.parse(llmOutput);
          analysis = {
            ...analysis,
            recommendation: parsed.recommendation || 'SKIP',
            confidence: parsed.confidence || 0,
            reasoning: parsed.reasoning || '',
            suggestedSizePct: parsed.suggested_size_pct || 0,
            keyRisks: parsed.key_risks || [],
          };
        } catch {
          analysis.recommendation = 'SKIP';
          analysis.confidence = 0;
          analysis.reasoning = 'Analysis failed';
          analysis.suggestedSizePct = 0;
          analysis.keyRisks = ['LLM analysis unavailable'];
        }
      } else {
        // No LLM available, just provide market info without recommendation
        analysis.recommendation = 'SKIP';
        analysis.confidence = 0;
        analysis.reasoning = 'LLM not configured';
        analysis.suggestedSizePct = 0;
        analysis.keyRisks = [];
      }

      analyses.push(analysis as MarketAnalysis);
    }

    // Step 6: Sort by confidence * expected value, take top N
    const ranked = analyses
      .filter((a) => a.recommendation !== 'SKIP')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.filter.maxResults || 5);

    return ranked.length > 0 ? ranked : analyses.slice(0, this.filter.maxResults || 5);
  }
}

export { DEFAULT_FILTER, BRIDGE_COST_ESTIMATE, PRIVACY_BY_CHAIN };
export { createLlmCaller } from './llm-caller.js';
export type { LlmProvider } from './llm-caller.js';
export { createNewsFetcher } from './news-fetcher.js';
export { fetchPolymarketMarkets } from './polymarket-fetcher.js';
