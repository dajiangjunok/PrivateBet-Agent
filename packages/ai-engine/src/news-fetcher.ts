/**
 * News Fetcher — Tavily search API
 * Returns a callback suitable for AIEngine.runPipeline()
 */

import type { RawMarket } from './index.js';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

/**
 * Create a news-fetcher callback that uses the Tavily API.
 * If TAVILY_API_KEY is not set, returns an empty string (no news context).
 */
export function createNewsFetcher(): (market: RawMarket) => Promise<string> {
  return async (market: RawMarket): Promise<string> => {
    const apiKey = process.env['TAVILY_API_KEY'];
    if (!apiKey) return '';

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: market.title,
          search_depth: 'basic',
          max_results: 3,
          include_answer: false,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`Tavily API error ${res.status}: ${body}`);
        return '';
      }

      const data = (await res.json()) as TavilyResponse;

      if (!data.results || data.results.length === 0) return '';

      return data.results
        .slice(0, 3)
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.content}`)
        .join('\n\n');
    } catch (err) {
      console.error('News fetch failed:', err instanceof Error ? err.message : err);
      return '';
    }
  };
}
