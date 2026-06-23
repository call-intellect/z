import OpenAI from 'openai';

export type Provider = 'deepseek' | 'gpt5mini';

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: Provider;
  model: string;
  ms: number;
}

const DEEPSEEK_BASE = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1').trim();
const DEEPSEEK_KEY = (process.env.DEEPSEEK_API_KEY ?? '').trim();
const DEEPSEEK_MODEL = (process.env.DEEPSEEK_DEFAULT_MODEL ?? 'deepseek-chat').trim();
const DEEPSEEK_PRO_MODEL = (process.env.PROTO_DEEPSEEK_PRO_MODEL ?? 'deepseek-reasoner').trim();

const PROXY_BASE = (process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1').trim();
const PROXY_PREFIX = (process.env.PROXY_PREFIX ?? 'myFeedproxy3128').trim();
const OPENAI_KEY = (process.env.OPENAI_API_KEY ?? '').trim();

const deepseek = new OpenAI({ baseURL: DEEPSEEK_BASE, apiKey: DEEPSEEK_KEY });
const proxy = new OpenAI({ baseURL: PROXY_BASE, apiKey: `${PROXY_PREFIX}:${OPENAI_KEY}` });

export interface CallOpts {
  json?: boolean;
  maxTokens?: number;
  pro?: boolean;
  effort?: 'low' | 'medium' | 'high';
}

async function callDeepseek(system: string, user: string, opts: CallOpts): Promise<LlmResult> {
  const t0 = Date.now();
  const model = opts.pro ? DEEPSEEK_PRO_MODEL : DEEPSEEK_MODEL;
  const params: Record<string, unknown> = {
    model,
    stream: false,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: opts.maxTokens ?? 1200,
  };
  if (opts.json) params['response_format'] = { type: 'json_object' };
  const r = (await deepseek.chat.completions.create(
    params as unknown as Parameters<typeof deepseek.chat.completions.create>[0],
  )) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: r.choices?.[0]?.message?.content ?? '',
    inputTokens: r.usage?.prompt_tokens ?? 0,
    outputTokens: r.usage?.completion_tokens ?? 0,
    provider: 'deepseek',
    model,
    ms: Date.now() - t0,
  };
}

async function callGpt5Mini(system: string, user: string, opts: CallOpts): Promise<LlmResult> {
  const t0 = Date.now();
  const model = 'gpt-5-mini';
  const userText = opts.json ? `${user}\n\nВажно: верни ответ строго валидным JSON.` : user;
  const params: Record<string, unknown> = {
    model,
    stream: false,
    instructions: system,
    input: [{ role: 'user', content: userText }],
    max_output_tokens: Math.max(16, opts.maxTokens ?? 1200),
    reasoning: { effort: opts.effort ?? 'low' },
  };
  if (opts.json) params['text'] = { format: { type: 'json_object' } };
  const r = (await (
    proxy as unknown as {
      responses: { create: (p: Record<string, unknown>) => Promise<Record<string, unknown>> };
    }
  ).responses.create(params)) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  let text = r.output_text ?? '';
  if (!text && Array.isArray(r.output)) {
    for (const o of r.output) for (const c of o.content ?? []) if (c.text) text += c.text;
  }
  return {
    text,
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    provider: 'gpt5mini',
    model,
    ms: Date.now() - t0,
  };
}

export async function llm(
  provider: Provider,
  system: string,
  user: string,
  opts: CallOpts = {},
): Promise<LlmResult> {
  return provider === 'gpt5mini'
    ? callGpt5Mini(system, user, opts)
    : callDeepseek(system, user, opts);
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCallResult {
  tool: string | null;
  args: Record<string, unknown>;
  text: string;
  provider: Provider;
  ms: number;
  error?: string;
}

export async function llmTools(
  provider: Provider,
  system: string,
  user: string,
  tools: ToolDef[],
  maxTokens = 700,
): Promise<ToolCallResult> {
  const t0 = Date.now();
  try {
    if (provider === 'deepseek') {
      const r = (await deepseek.chat.completions.create({
        model: DEEPSEEK_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: 'auto',
      } as unknown as Parameters<typeof deepseek.chat.completions.create>[0])) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
      };
      const msg = r.choices?.[0]?.message;
      const tc = msg?.tool_calls?.[0];
      let args: Record<string, unknown> = {};
      if (tc?.function?.arguments) {
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          args = { raw: tc.function.arguments };
        }
      }
      return { tool: tc?.function?.name ?? null, args, text: msg?.content ?? '', provider, ms: Date.now() - t0 };
    }
    const r = (await (
      proxy as unknown as { responses: { create: (p: Record<string, unknown>) => Promise<Record<string, unknown>> } }
    ).responses.create({
      model: 'gpt-5-mini',
      stream: false,
      instructions: system,
      input: [{ role: 'user', content: user }],
      max_output_tokens: Math.max(16, maxTokens),
      reasoning: { effort: 'low' },
      tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })),
    })) as { output_text?: string; output?: Array<Record<string, unknown>> };
    let tool: string | null = null;
    let args: Record<string, unknown> = {};
    for (const item of Array.isArray(r.output) ? r.output : []) {
      if (item['type'] === 'function_call') {
        tool = typeof item['name'] === 'string' ? (item['name'] as string) : null;
        const raw = item['arguments'];
        if (typeof raw === 'string') {
          try {
            args = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            args = { raw };
          }
        }
        break;
      }
    }
    return { tool, args, text: r.output_text ?? '', provider, ms: Date.now() - t0 };
  } catch (e) {
    return { tool: null, args: {}, text: '', provider, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(cleaned.slice(s, e + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
