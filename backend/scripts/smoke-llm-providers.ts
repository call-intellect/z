import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

loadEnv({ path: resolve(__dirname, '..', '..', '.env'), override: true });
loadEnv({ path: resolve(__dirname, '..', '.env'), override: false });

if (!process.env.OLLAMA_API_KEY) {
  process.env.OLLAMA_API_KEY = 'sk-local-test-20260319';
}
if (!process.env.OLLAMA_BASE_URL) {
  process.env.OLLAMA_BASE_URL = 'https://ollama.agent-lia.ru/v1';
}

const SYSTEM_PROMPT = 'Ты лаконичный ассистент. Отвечай строго одним словом без знаков препинания.';
const USER_PROMPT = 'Является ли Москва столицей России? Ответь: да или нет.';
const EXPECTED_KEYWORDS = ['да', 'yes'];
const MAX_TOKENS = 256;
const TIMEOUT_MS = 60_000;

const PROXY_BASE = process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1';
const PROXY_PREFIX = process.env.PROXY_PREFIX ?? 'myFeedproxy3128';

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='))?.slice(7);
const skipArg = args.find((a) => a.startsWith('--skip='))?.slice(7);
const onlyChannels = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null;
const skipChannels = new Set(
  (skipArg ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

interface Result {
  channel: string;
  model: string;
  status: 'ok' | 'fail' | 'skip';
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reply?: string;
  expectedHit?: boolean;
  error?: string;
}

const results: Result[] = [];

function logResult(r: Result): void {
  results.push(r);
  const status = r.status === 'ok' ? '✓' : r.status === 'fail' ? '✗' : '-';
  const lat = `${r.latencyMs}ms`.padStart(8);
  const tokens =
    r.inputTokens !== undefined
      ? ` ${r.inputTokens ?? 0}/${r.outputTokens ?? 0}t`.padStart(11)
      : '            ';
  const head = `${status} ${r.channel.padEnd(18)} ${r.model.padEnd(36)} ${lat}${tokens}`;
  if (r.status === 'ok') {
    const hit = r.expectedHit ? '✓' : '?';
    // eslint-disable-next-line no-console
    console.log(`${head}  ${hit} «${(r.reply ?? '').replace(/\s+/g, ' ').slice(0, 80)}»`);
  } else if (r.status === 'fail') {
    // eslint-disable-next-line no-console
    console.log(`${head}  ${(r.error ?? '').slice(0, 140)}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`${head}  skipped: ${r.error}`);
  }
}

function checkExpected(reply: string): boolean {
  const lower = reply.toLowerCase();
  return EXPECTED_KEYWORDS.some((k) => lower.includes(k));
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const out = await fn();
  return [out, Date.now() - t0];
}

function shouldRun(channel: string): boolean {
  if (onlyChannels && !onlyChannels.has(channel)) return false;
  if (skipChannels.has(channel)) return false;
  return true;
}

function skip(channel: string, model: string, reason: string): void {
  if (!shouldRun(channel)) return;
  logResult({ channel, model, status: 'skip', latencyMs: 0, error: reason });
}

async function testAnthropic(model: string): Promise<void> {
  const channel = 'anthropic';
  if (!shouldRun(channel)) return;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    skip(channel, model, 'ANTHROPIC_API_KEY не задан');
    return;
  }
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const useProxy = (process.env.ANTHROPIC_USE_PROXY ?? '').toLowerCase() === 'true';
    const client = new Anthropic({
      apiKey: key,
      ...(useProxy && process.env.ANTHROPIC_PROXY_URL
        ? { baseURL: process.env.ANTHROPIC_PROXY_URL }
        : {}),
    });
    const [msg, latencyMs] = await timed(() =>
      client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: USER_PROMPT }],
      }),
    );
    const reply = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens: msg.usage.input_tokens ?? 0,
      outputTokens: msg.usage.output_tokens ?? 0,
      reply,
      expectedHit: checkExpected(reply),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testMinimax(model: string): Promise<void> {
  const channel = 'minimax';
  if (!shouldRun(channel)) return;
  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    skip(channel, model, 'MINIMAX_API_KEY не задан');
    return;
  }
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({
      apiKey: key,
      baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic',
    });
    const [msg, latencyMs] = await timed(() =>
      client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: USER_PROMPT }],
      }),
    );
    const reply = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('');
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens: msg.usage.input_tokens ?? 0,
      outputTokens: msg.usage.output_tokens ?? 0,
      reply,
      expectedHit: checkExpected(reply),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testOpenAiProxy(model: string): Promise<void> {
  const channel = 'openai-via-proxy';
  if (!shouldRun(channel)) return;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    skip(channel, model, 'OPENAI_API_KEY не задан');
    return;
  }
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      baseURL: PROXY_BASE,
      apiKey: `${PROXY_PREFIX}:${key}`,
    });
    const isReasoning = model.startsWith('gpt-5');
    const params: Record<string, unknown> = {
      model,
      stream: false,
      instructions: SYSTEM_PROMPT,
      input: [{ role: 'user', content: USER_PROMPT }],
      max_output_tokens: 1024,
    };
    if (isReasoning) {
      const isOldGpt5 = /^gpt-5(?!\.)/.test(model);
      params['reasoning'] = { effort: isOldGpt5 ? 'minimal' : 'low' };
    }
    const [response, latencyMs] = await timed(() =>
      (
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
      ).responses.create(params),
    );
    const reply = response.output_text ?? '';
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      reply,
      expectedHit: checkExpected(reply),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testDeepSeek(model: string): Promise<void> {
  const channel = 'deepseek';
  if (!shouldRun(channel)) return;
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    skip(channel, model, 'DEEPSEEK_API_KEY не задан');
    return;
  }
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ baseURL: baseUrl, apiKey: key });
    const [response, latencyMs] = await timed(() =>
      client.chat.completions.create({
        model,
        stream: false,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT },
        ],
      }),
    );
    const reply = response.choices?.[0]?.message?.content ?? '';
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      reply,
      expectedHit: checkExpected(reply),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testOllama(model: string): Promise<void> {
  const channel = 'ollama';
  if (!shouldRun(channel)) return;
  let baseUrl = process.env.OLLAMA_BASE_URL ?? 'https://ollama.agent-lia.ru/v1';
  baseUrl = baseUrl.replace(/\/+$/, '');
  if (!baseUrl.endsWith('/v1')) baseUrl = `${baseUrl}/v1`;
  const apiKey = process.env.OLLAMA_API_KEY || 'no-key';
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ baseURL: baseUrl, apiKey });
    const [response, latencyMs] = await timed(() =>
      client.chat.completions.create({
        model,
        stream: false,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT },
        ],
      }),
    );
    const reply = response.choices?.[0]?.message?.content ?? '';
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      reply,
      expectedHit: checkExpected(reply),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testGrsai(model: string): Promise<void> {
  const channel = 'grsai-gemini';
  if (!shouldRun(channel)) return;
  const key = process.env.GRSAI_API_KEY;
  if (!key) {
    skip(channel, model, 'GRSAI_API_KEY не задан');
    return;
  }
  const baseRoot = PROXY_BASE.replace(/\/v1$/, '');
  const url = `${baseRoot}/grsai/v1/chat/completions`;
  try {
    const body = {
      model,
      stream: true,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT },
      ],
    };
    const [{ text, inputTokens, outputTokens }, latencyMs] = await timed(async () => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${PROXY_PREFIX}:${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }
      return collectSse(resp);
    });
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens,
      outputTokens,
      reply: text,
      expectedHit: checkExpected(text),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function collectSse(resp: Response): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const chunks: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload);
          const content = data.choices?.[0]?.delta?.content;
          if (content) chunks.push(content);
          if (data.usage) {
            inputTokens = data.usage.prompt_tokens ?? inputTokens;
            outputTokens = data.usage.completion_tokens ?? outputTokens;
          }
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
    resp.body?.cancel().catch(() => {});
  }
  return { text: chunks.join(''), inputTokens, outputTokens };
}

async function testKieClaude(model: string): Promise<void> {
  const channel = 'kie-claude';
  if (!shouldRun(channel)) return;
  const key = process.env.KIE_API_KEY;
  if (!key) {
    skip(channel, model, 'KIE_API_KEY не задан');
    return;
  }
  const base = (process.env.KIE_BASE_URL ?? 'https://api.kie.ai').replace(/\/$/, '');
  const url = `${base}/claude/v1/messages`;
  try {
    const body = {
      model,
      max_tokens: MAX_TOKENS,
      stream: false,
      messages: [{ role: 'user', content: `${SYSTEM_PROMPT}\n\n${USER_PROMPT}` }],
    };
    const [{ text, inputTokens, outputTokens }, latencyMs] = await timed(async () => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }
      const data = (await resp.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const reply = (data.content ?? [])
        .filter((b) => b?.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      return {
        text: reply,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    });
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens,
      outputTokens,
      reply: text,
      expectedHit: checkExpected(text),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testKieGpt(model: string): Promise<void> {
  const channel = 'kie-gpt';
  if (!shouldRun(channel)) return;
  const key = process.env.KIE_API_KEY;
  if (!key) {
    skip(channel, model, 'KIE_API_KEY не задан');
    return;
  }
  const base = (process.env.KIE_BASE_URL ?? 'https://api.kie.ai').replace(/\/$/, '');
  const url = `${base}/codex/v1/responses`;
  try {
    const body = {
      model,
      stream: false,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: `${SYSTEM_PROMPT}\n\n${USER_PROMPT}` }],
        },
      ],
      reasoning: { effort: 'low' },
    };
    const [{ text, inputTokens, outputTokens }, latencyMs] = await timed(async () => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }
      const data = (await resp.json()) as {
        output?: Array<{
          type?: string;
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const msg = (data.output ?? []).find((o) => o?.type === 'message');
      const reply = (msg?.content ?? [])
        .filter((c) => c?.type === 'output_text')
        .map((c) => c.text ?? '')
        .join('');
      return {
        text: reply,
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    });
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens,
      outputTokens,
      reply: text,
      expectedHit: checkExpected(text),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testKieGemini(modelSlug: string): Promise<void> {
  const channel = 'kie-gemini-direct';
  if (!shouldRun(channel)) return;
  const key = process.env.KIE_API_KEY;
  if (!key) {
    skip(channel, modelSlug, 'KIE_API_KEY не задан');
    return;
  }
  const base = (process.env.KIE_BASE_URL ?? 'https://api.kie.ai').replace(/\/$/, '');
  const url = `${base}/${modelSlug}/v1/chat/completions`;
  try {
    const body = {
      stream: false,
      include_thoughts: false,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `${SYSTEM_PROMPT}\n\n${USER_PROMPT}` }],
        },
      ],
    };
    const [{ text, inputTokens, outputTokens }, latencyMs] = await timed(async () => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const raw = data.choices?.[0]?.message?.content ?? '';
      const reply =
        typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? raw.map((p: { text?: string }) => p?.text ?? '').join('')
            : String(raw);
      return {
        text: reply,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    });
    logResult({
      channel,
      model: modelSlug,
      status: 'ok',
      latencyMs,
      inputTokens,
      outputTokens,
      reply: text,
      expectedHit: checkExpected(text),
    });
  } catch (err) {
    logResult({
      channel,
      model: modelSlug,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testKie(model: string): Promise<void> {
  const channel = 'kie-gemini';
  if (!shouldRun(channel)) return;
  const key = process.env.KIE_API_KEY;
  if (!key) {
    skip(channel, model, 'KIE_API_KEY не задан');
    return;
  }
  const baseRoot = PROXY_BASE.replace(/\/v1$/, '');
  const url = `${baseRoot}/kie/${model}/v1/chat/completions`;
  try {
    const body = {
      stream: false,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'developer', content: [{ type: 'text', text: SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'text', text: USER_PROMPT }] },
      ],
      include_thoughts: false,
      reasoning_effort: 'low',
    };
    const [{ text, inputTokens, outputTokens }, latencyMs] = await timed(async () => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${PROXY_PREFIX}:${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }
      const data = (await resp.json()) as {
        choices?: Array<{
          message?: { content?: unknown; reasoning_content?: unknown };
          text?: unknown;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const raw =
        choice?.message?.content ?? choice?.message?.reasoning_content ?? choice?.text ?? '';
      const t =
        typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? raw.map((p: { text?: string }) => p?.text ?? '').join('')
            : String(raw);
      return {
        text: t,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    });
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens,
      outputTokens,
      reply: text,
      expectedHit: checkExpected(text),
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testOpenAiEmbeddings(): Promise<void> {
  const channel = 'embeddings-openai';
  const model = 'text-embedding-3-small';
  if (!shouldRun(channel)) return;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    skip(channel, model, 'OPENAI_API_KEY не задан');
    return;
  }
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      baseURL: PROXY_BASE,
      apiKey: `${PROXY_PREFIX}:${key}`,
    });
    const [response, latencyMs] = await timed(() =>
      client.embeddings.create({
        model,
        input: ['Москва — столица России.', 'AI-видеовстречи на LiveKit.'],
      }),
    );
    const dim = response.data?.[0]?.embedding.length ?? 0;
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: 0,
      reply: `dim=${dim}, vectors=${response.data?.length ?? 0}`,
      expectedHit: dim > 0,
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

async function testOllamaEmbeddings(): Promise<void> {
  const channel = 'embeddings-ollama';
  const model = 'bge-m3';
  if (!shouldRun(channel)) return;
  let baseUrl = process.env.OLLAMA_BASE_URL ?? 'https://ollama.agent-lia.ru/v1';
  baseUrl = baseUrl.replace(/\/+$/, '');
  if (!baseUrl.endsWith('/v1')) baseUrl = `${baseUrl}/v1`;
  const apiKey = process.env.OLLAMA_API_KEY || 'no-key';
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ baseURL: baseUrl, apiKey });
    const [response, latencyMs] = await timed(() =>
      client.embeddings.create({
        model,
        input: ['Москва — столица России.', 'AI-видеовстречи на LiveKit.'],
      }),
    );
    const dim = response.data?.[0]?.embedding.length ?? 0;
    logResult({
      channel,
      model,
      status: 'ok',
      latencyMs,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: 0,
      reply: `dim=${dim}, vectors=${response.data?.length ?? 0}`,
      expectedHit: dim > 0,
    });
  } catch (err) {
    logResult({
      channel,
      model,
      status: 'fail',
      latencyMs: 0,
      error: errMsg(err),
    });
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: number }).status;
    return status ? `[${status}] ${err.message}` : err.message;
  }
  return String(err);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== Z LLM smoke-test ===');
  // eslint-disable-next-line no-console
  console.log(`prompt: «${USER_PROMPT}»`);
  // eslint-disable-next-line no-console
  console.log(`proxy:  ${PROXY_BASE} (prefix=${PROXY_PREFIX})`);
  // eslint-disable-next-line no-console
  console.log(
    `keys:   ${[
      ['ANTHROPIC', !!process.env.ANTHROPIC_API_KEY],
      ['MINIMAX', !!process.env.MINIMAX_API_KEY],
      ['OPENAI', !!process.env.OPENAI_API_KEY],
      ['DEEPSEEK', !!process.env.DEEPSEEK_API_KEY],
      ['OLLAMA_URL', !!process.env.OLLAMA_BASE_URL],
      ['GRSAI', !!process.env.GRSAI_API_KEY],
      ['KIE', !!process.env.KIE_API_KEY],
    ]
      .map(([n, v]) => `${n as string}=${v ? '✓' : '✗'}`)
      .join(' ')}`,
  );
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(
    'sts channel             model                                latency    in/out  reply',
  );
  // eslint-disable-next-line no-console
  console.log('─'.repeat(140));

  await testAnthropic('claude-sonnet-4-6');
  await testAnthropic('claude-haiku-4-5-20251001');
  await testAnthropic('claude-opus-4-7');

  await testMinimax('MiniMax-M2.5');
  await testMinimax('MiniMax-M2.7');

  await testOpenAiProxy('gpt-5.5');
  await testOpenAiProxy('gpt-5.4');
  await testOpenAiProxy('gpt-5.4-mini');
  await testOpenAiProxy('gpt-5.4-nano');
  await testOpenAiProxy('gpt-5-mini');
  await testOpenAiProxy('gpt-4.1-mini');
  await testOpenAiProxy('gpt-4o-mini');

  await testDeepSeek('deepseek-v4-flash');
  await testDeepSeek('deepseek-v4-pro');
  await testDeepSeek('deepseek-chat');

  await testOllama('qwen3.5:9b');
  await testOllama('kwangsuklee/Nanbeige4.1-3B.Q4_K_M:latest');

  await testGrsai('gemini-3-pro');
  await testGrsai('gemini-3.1-pro');

  await testKieClaude('claude-opus-4-7');

  await testKieGpt('gpt-5-4');

  await testKieGemini('gemini-3-flash');

  await testKie('gemini-3-pro');

  await testOpenAiEmbeddings();
  await testOllamaEmbeddings();

  // eslint-disable-next-line no-console
  console.log('');
  const ok = results.filter((r) => r.status === 'ok').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const sk = results.filter((r) => r.status === 'skip').length;
  // eslint-disable-next-line no-console
  console.log(`Итого: ok=${ok}, fail=${fail}, skip=${sk}, всего=${results.length}`);

  const tmpDir = resolve(__dirname, '..', 'tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = resolve(tmpDir, `llm-smoke-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        prompt: { system: SYSTEM_PROMPT, user: USER_PROMPT },
        proxy: { base: PROXY_BASE, prefix: PROXY_PREFIX },
        results,
      },
      null,
      2,
    ),
    'utf-8',
  );
  // eslint-disable-next-line no-console
  console.log(`Отчёт: ${file}`);

  if (fail > 0) process.exitCode = 0;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('smoke-llm-providers FAILED:', err);
  process.exit(1);
});
