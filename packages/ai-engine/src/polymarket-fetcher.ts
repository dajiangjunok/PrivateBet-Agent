/**
 * Polymarket Market Fetcher — Gamma API
 * Fetches active markets from Polymarket and maps them to RawMarket[]
 */

import type { RawMarket } from './index.js';

const POLYMARKET_GAMMA_URL =
  'https://gamma-api.polymarket.com/markets?closed=false&order=volume24hr&ascending=false&limit=50';

interface GammaToken {
  price: string;
}

interface GammaMarket {
  condition_id: string;
  question: string;
  description: string;
  volume24hr: string;
  liquidity: string;
  end_date_iso: string;
  tokens: GammaToken[];
}

/**
 * Calculate hours from now until the given ISO date string.
 * Returns 0 if the date is in the past or cannot be parsed.
 */
function hoursUntilSettlement(endDateIso: string): number {
  const end = new Date(endDateIso).getTime();
  if (isNaN(end)) return 0;
  const now = Date.now();
  const diffMs = end - now;
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60)));
}

/**
 * Fetch active Polymarket markets via the Gamma API and map to RawMarket[].
 */
export async function fetchPolymarketMarkets(): Promise<RawMarket[]> {
  const res = await fetch(POLYMARKET_GAMMA_URL);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polymarket Gamma API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as GammaMarket[];

  return data.map((m): RawMarket => {
    const yesPrice = m.tokens?.[0]?.price ? parseFloat(m.tokens[0].price) : 0;
    const volume24h = m.volume24hr ? parseFloat(m.volume24hr) : 0;
    const liquidity = m.liquidity ? parseFloat(m.liquidity) : 0;
    const endDate = m.end_date_iso ?? '';
    const hoursToSettlement = hoursUntilSettlement(endDate);

    return {
      marketId: m.condition_id ?? '',
      title: m.question ?? '',
      description: m.description ?? '',
      source: 'polymarket',
      chainId: 137,
      settlementAsset: 'USDC.e',
      yesPrice: isNaN(yesPrice) ? 0 : yesPrice,
      volume24h: isNaN(volume24h) ? 0 : volume24h,
      liquidity: isNaN(liquidity) ? 0 : liquidity,
      hoursToSettlement,
      endDate,
    };
  });
}
