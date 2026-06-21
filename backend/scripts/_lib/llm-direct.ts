import OpenAI from 'openai';

export type ProviderName = 'deepseek' | 'openai-proxy';

interface Price {
  in: number;
  cachedIn: number;
  out: number;
}

const PRICES: Record<string, Price> = {
  'deepseek-v4-pro': {
    in: 0.435 / 1_000_000,
    cachedIn: 0.003625 / 1_000_000,
    out: 0.87 / 1_000_000,
  },
  'deepseek-v4-flash': {
    in: 0.0945 / 1_000_000,
    cachedIn: 0.000787 / 1_000_000,
    out: 0.189 / 1_000_000,
  },
  'gpt-5.4': { in: 2 / 1_000_000, cachedIn: 0.2 / 1_000_000, out: 10 / 1_000_000 },
  'gpt-5.4-mini': { in: 0.4 / 1_000_000, cachedIn: 0.04 / 1_000_000, out: 1.6 / 1_000_000 },
};

export interface DirectCallOpts {
  provider: ProviderName;
  model: string;
  system: string;
  user: string;
  schema?: Record<string, unknown> | null;
  schemaName?: string;
  toolName?: string;
  maxTokens?: number;
  reasoningEffort?: string;
}

export interface DirectCallResult {
  provider: ProviderName;
  model: string;
  text: string;
  toolCallArgs: string | null;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  ms: number;
  error: string | null;
}

export function buildClient(provider: ProviderName): OpenAI {
  if (provider === 'openai-proxy') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY не задан (нужен для provider=openai-proxy).');
    const prefix = process.env.PROXY_PREFIX ?? 'myFeedproxy3128';
    const baseURL = process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1';
    return new OpenAI({ apiKey: `${prefix}:${apiKey}`, baseURL });
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY не задан (нужен для provider=deepseek).');
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  });
}

export function computeDirectCost(model: string, r: DirectCallResult): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const uncached = Math.max(0, r.tokensIn - r.cachedTokens);
  return uncached * price.in + r.cachedTokens * price.cachedIn + r.tokensOut * price.out;
}

async function callDeepseek(client: OpenAI, opts: DirectCallOpts): Promise<DirectCallResult> {
  const start = Date.now();
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 4000,
  };
  if (opts.schema) {
    body.tools = [
      {
        type: 'function',
        function: {
          name: opts.toolName ?? opts.schemaName ?? 'submit_result',
          description: 'Вернуть результат агента.',
          parameters: opts.schema,
        },
      },
    ];
    body.tool_choice = 'auto';
  }
  try {
    const resp = (await client.chat.completions.create(
      body as unknown as Parameters<typeof client.chat.completions.create>[0],
    )) as unknown as {
      choices: Array<{
        message?: { content?: string | null; tool_calls?: Array<{ function: { arguments: string } }> };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const msg = resp.choices[0]?.message;
    return {
      provider: 'deepseek',
      model: opts.model,
      text: msg?.content ?? '',
      toolCallArgs: msg?.tool_calls?.[0]?.function.arguments ?? null,
      tokensIn: resp.usage?.prompt_tokens ?? 0,
      tokensOut: resp.usage?.completion_tokens ?? 0,
      cachedTokens:
        resp.usage?.prompt_cache_hit_tokens ?? resp.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      ms: Date.now() - start,
      error: null,
    };
  } catch (e) {
    return {
      provider: 'deepseek',
      model: opts.model,
      text: '',
      toolCallArgs: null,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function callOpenaiProxy(client: OpenAI, opts: DirectCallOpts): Promise<DirectCallResult> {
  const start = Date.now();
  const payload: Record<string, unknown> = {
    model: opts.model,
    stream: false,
    instructions: opts.system,
    input: [{ role: 'user', content: opts.user }],
    max_output_tokens: opts.maxTokens ?? 4000,
    reasoning: { effort: opts.reasoningEffort ?? 'medium' },
  };
  if (opts.schema) {
    payload.text = {
      format: {
        type: 'json_schema',
        name: opts.schemaName ?? 'result',
        strict: true,
        schema: opts.schema,
      },
    };
  }
  try {
    const resp = (await (
      client as unknown as {
        responses: {
          create: (p: Record<string, unknown>) => Promise<{
            output_text?: string;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              input_tokens_details?: { cached_tokens?: number };
            };
          }>;
        };
      }
    ).responses.create(payload)) as {
      output_text?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
      };
    };
    const text = resp.output_text ?? '';
    return {
      provider: 'openai-proxy',
      model: opts.model,
      text,
      toolCallArgs: opts.schema ? text : null,
      tokensIn: resp.usage?.input_tokens ?? 0,
      tokensOut: resp.usage?.output_tokens ?? 0,
      cachedTokens: resp.usage?.input_tokens_details?.cached_tokens ?? 0,
      ms: Date.now() - start,
      error: null,
    };
  } catch (e) {
    return {
      provider: 'openai-proxy',
      model: opts.model,
      text: '',
      toolCallArgs: null,
      tokensIn: 0,
      tokensOut: 0,
      cachedTokens: 0,
      ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function directLlmCall(opts: DirectCallOpts): Promise<DirectCallResult> {
  const client = buildClient(opts.provider);
  return opts.provider === 'openai-proxy'
    ? callOpenaiProxy(client, opts)
    : callDeepseek(client, opts);
}
