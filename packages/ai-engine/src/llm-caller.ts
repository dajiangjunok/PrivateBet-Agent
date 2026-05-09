/**
 * LLM Caller — Anthropic / OpenAI / Zhipu via raw fetch()
 * Returns a callback suitable for AIEngine.runPipeline()
 */

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const DEFAULT_MODEL = 'glm-4-flash';
const DEFAULT_PROVIDER: LlmProvider = 'zhipu';

function getModel(): string {
  return process.env['AI_MODEL'] || DEFAULT_MODEL;
}

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry wrapper — retries on network errors and 5xx responses */
async function fetchWithRetry(
  url: string,
  init: Parameters<typeof fetch>[1],
): Promise<ReturnType<typeof fetch>> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);

      if (res.status >= 500) {
        lastError = new Error(`Server error ${res.status}`);
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        return res; // return on final attempt even if 5xx
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError ?? new Error('All retry attempts failed');
}

// ─── Anthropic ────────────────────────────────────────────────

async function callAnthropic(prompt: string): Promise<string> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  const textBlock = data.content?.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text content in Anthropic response');

  return textBlock.text;
}

// ─── OpenAI ───────────────────────────────────────────────────

async function callOpenAI(prompt: string): Promise<string> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');

  return content;
}

// ─── Zhipu GLM ────────────────────────────────────────────────

async function callZhipu(prompt: string): Promise<string> {
  const apiKey = process.env['ZHIPU_API_KEY'];
  if (!apiKey) throw new Error('ZHIPU_API_KEY is not set');

  const res = await fetchWithRetry('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zhipu API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in Zhipu response');

  return content;
}

// ─── Factory ──────────────────────────────────────────────────

export type LlmProvider = 'anthropic' | 'openai' | 'zhipu';

export function createLlmCaller(provider?: LlmProvider): (prompt: string) => Promise<string> {
  const resolved = provider ?? ((process.env['AI_PROVIDER'] as LlmProvider) || DEFAULT_PROVIDER);

  if (resolved === 'anthropic') {
    return callAnthropic;
  }
  if (resolved === 'openai') {
    return callOpenAI;
  }
  return callZhipu;
}
