/**
 * Матричный probe для prompt caching по всем продовым каналам LLM в Z.
 *
 * Запуск (из backend):
 *   bun run scripts/eval/probe-llm-cache-matrix.ts             # все targets
 *   bun run scripts/eval/probe-llm-cache-matrix.ts --targets=deepseek-v4-flash,gpt-5.4-mini
 *
 * Цели — из verified-карты `second-brain/01_projects/llm-providers-verified.md`:
 *   - deepseek-v4-flash         (api.deepseek.com, прямой, OpenAI-compat chat)
 *   - gpt-5.4-mini              (proxy.agent-lia.ru/v1, OpenAI Responses)
 *   - minimax-m2.5              (api.minimax.io/anthropic, Anthropic Messages)
 *   - grsai-gemini-3-pro        (grsaiapi.com или proxy.agent-lia.ru/grsai, SSE)
 *   - kie-claude-opus-4-7       (api.kie.ai/claude, Anthropic-style, дорого)
 *   - kie-gpt-5-4               (api.kie.ai/codex, OpenAI Responses)
 *   - kie-gemini-3-flash        (api.kie.ai/${model}, OpenAI chat-compat)
 *
 * 3 сценария на каждом target (см. описание в probe-deepseek-cache.ts).
 * Дорогие модели — урезанный набор размеров.
 *
 * Бюджет: ≈ $0.30-0.50 (доминирует KIE Claude opus).
 */
import { promises as fs } from 'fs';
import path from 'path';
import 'dotenv/config';

const SCRIPT_DIR = path
  .dirname(new URL(import.meta.url).pathname)
  .replace(/^\/([A-Za-z]):/, '$1:');
const REPORTS_DIR = path.resolve(
  SCRIPT_DIR,
  '../../test/eval/cache-experiment/reports',
);

// ─── общий filler ───────────────────────────────────────────────────────────
const FILLER_PARAGRAPH = `
Встреча Z — это рабочая сессия команды, где обсуждаются текущие задачи и принимаются решения.
Каждая встреча имеет тип: продажная, внутренняя планёрка, ретроспектива, интервью, демо, обучение.
Тип встречи определяет шаблон AI-отчёта и набор сущностей, которые извлекает knowledge-инженер.
Запись ведётся через LiveKit — каждый участник получает отдельную аудиодорожку, что критично для последующего разделения по спикерам.
Транскрибация выполняется ASR-провайдером, разметка спикеров — отдельным этапом, формирование IdeaBlock-ов — серией LLM-вызовов.
IdeaBlock — это атомарная смысловая единица: имеет name, criticalQuestion, trustedAnswer и signalType.
Возможные signalType: decision, rationale, idea, feature_request, pain, risk, blocker, hypothesis, result, lesson, regulation, process_step, expertise, mentoring, fact, help_provided, proactive_hint, emotional_support, reasoning, methodology_step.
Каждый блок ссылается на исходные таймкоды и speakerId, что позволяет восстановить контекст и проверить факт.
Граф знаний компании строится поверх IdeaBlock-ов через EntityLink — связи между блоками и каноническими сущностями: персонами, проектами, продуктами, технологиями, метриками.
Темы кластеризуются автоматически через embedding-модель text-embedding-3-small, индекс хранится в pgvector с HNSW.
Поиск в графе — гибридный: семантическое сходство плюс точное совпадение по entity-связям плюс recency.
Это позволяет AI-чату компании отвечать на вопросы вида «что мы решили по тарификатору на последней планёрке» с привязкой к конкретным блокам.
`;

function buildText(targetChars: number): string {
  const parts: string[] = [];
  let total = 0;
  let i = 0;
  while (total < targetChars) {
    const p = `[Параграф ${i + 1}]${FILLER_PARAGRAPH}`;
    parts.push(p);
    total += p.length;
    i += 1;
  }
  return parts.join('\n').slice(0, targetChars);
}

const SYSTEM_PROMPT =
  'Ты — ассистент. Отвечай ровно одним словом «ок» и ничего больше.';

// ─── типы ───────────────────────────────────────────────────────────────────
type Protocol =
  | 'deepseek-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'kie-claude'
  | 'kie-gpt-responses'
  | 'kie-gemini-direct'
  | 'grsai-sse';

interface Target {
  name: string;
  protocol: Protocol;
  baseURL: string;
  authHeader: string;
  model: string;
  /** full = до 50k; medium = до 20k; small = до 10k (для дорогих/медленных). */
  sizeBudget: 'full' | 'medium' | 'small';
  notes?: string;
}

interface CallResult {
  ok: boolean;
  ms: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  cacheHitRatio: number;
  error?: string;
  /** Сырое usage от провайдера — для диагностики. */
  usageRaw?: Record<string, unknown>;
}

// ─── протоколы ──────────────────────────────────────────────────────────────

const MAX_TOKENS = 80;

async function postJson(
  url: string,
  authHeader: string,
  body: unknown,
  timeoutMs = 90_000,
  extraHeaders: Record<string, string> = {},
): Promise<{ data: Record<string, unknown>; status: number }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const status = resp.status;
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`HTTP ${status}: ${errText.slice(0, 300)}`);
  }
  const data = (await resp.json()) as Record<string, unknown>;
  return { data, status };
}

async function callDeepseekChat(target: Target, userText: string): Promise<CallResult> {
  const start = Date.now();
  try {
    const { data } = await postJson(
      `${target.baseURL}/chat/completions`,
      target.authHeader,
      {
        model: target.model,
        stream: false,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      },
    );
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const pt = num(u['prompt_tokens']);
    const ct = num(u['completion_tokens']);
    const cached =
      num(u['prompt_cache_hit_tokens']) ||
      num(u['cached_tokens']) ||
      num((u['prompt_tokens_details'] as Record<string, unknown> | undefined)?.['cached_tokens']);
    return mkOk(pt, ct, cached, Date.now() - start, u);
  } catch (e) {
    return mkErr(e, Date.now() - start);
  }
}

async function callOpenAIResponses(target: Target, userText: string): Promise<CallResult> {
  const start = Date.now();
  try {
    // gpt-5* (1-я волна) принимают reasoning.effort='minimal'; gpt-5.4*+ — нет.
    const body: Record<string, unknown> = {
      model: target.model,
      stream: false,
      instructions: SYSTEM_PROMPT,
      input: [{ role: 'user', content: userText }],
      max_output_tokens: MAX_TOKENS,
    };
    if (target.model.startsWith('gpt-5')) {
      const isFirstWave = /^gpt-5(-mini|-nano)?$/.test(target.model);
      body['reasoning'] = { effort: isFirstWave ? 'minimal' : 'low' };
    }
    const { data } = await postJson(
      `${target.baseURL}/responses`,
      target.authHeader,
      body,
    );
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const pt = num(u['input_tokens']);
    const ct = num(u['output_tokens']);
    const det = u['input_tokens_details'] as Record<string, unknown> | undefined;
    const cached = num(det?.['cached_tokens']);
    return mkOk(pt, ct, cached, Date.now() - start, u);
  } catch (e) {
    return mkErr(e, Date.now() - start);
  }
}

async function callAnthropicMessages(target: Target, userText: string): Promise<CallResult> {
  const start = Date.now();
  try {
    // Anthropic-style: system как массив с cache_control:ephemeral, user — отдельно.
    // MiniMax поддерживает тот же формат.
    const body = {
      model: target.model,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userText,
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
      stream: false,
    };
    const { data } = await postJson(
      `${target.baseURL}/v1/messages`,
      target.authHeader,
      body,
      90_000,
      { 'anthropic-version': '2023-06-01' },
    );
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const pt = num(u['input_tokens']);
    const ct = num(u['output_tokens']);
    const cacheRead = num(u['cache_read_input_tokens']);
    const cacheCreate = num(u['cache_creation_input_tokens']);
    // Для Anthropic: реальный input включает cache_read + cache_create + input_tokens (uncached).
    // Hit ratio считаем относительно полного входа.
    const totalInput = pt + cacheRead + cacheCreate;
    return mkOk(totalInput, ct, cacheRead, Date.now() - start, u);
  } catch (e) {
    return mkErr(e, Date.now() - start);
  }
}

async function callKieClaude(target: Target, userText: string): Promise<CallResult> {
  const start = Date.now();
  try {
    // KIE-Claude — Anthropic-формат через api.kie.ai.
    // Попробуем по-настоящему: system как блок, user как блок с cache_control.
    const body = {
      model: target.model,
      max_tokens: MAX_TOKENS,
      stream: false,
      system: [{ type: 'text', text: SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userText,
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    };
    const { data } = await postJson(
      `${target.baseURL}/claude/v1/messages`,
      target.authHeader,
      body,
    );
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const pt = num(u['input_tokens']);
    const ct = num(u['output_tokens']);
    const cacheRead = num(u['cache_read_input_tokens']);
    const cacheCreate = num(u['cache_creation_input_tokens']);
    const totalInput = pt + cacheRead + cacheCreate;
    return mkOk(totalInput, ct, cacheRead, Date.now() - start, u);
  } catch (e) {
    return mkErr(e, Date.now() - start);
  }
}

async function callKieGptResponses(target: Target, userText: string): Promise<CallResult> {
  const start = Date.now();
  try {
    const body: Record<string, unknown> = {
      model: target.model,
      stream: false,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `${SYSTEM_PROMPT}\n\n${userText}`,
            },
          ],
        },
      ],
    };
    const { data } = await postJson(
      `${target.baseURL}/codex/v1/responses`,
      target.authHeader,
      body,
    );
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    // KIE Responses может возвращать usage в OpenAI Responses формате
    // (input_tokens) ИЛИ в chat-completions формате (prompt_tokens) — пробуем оба.
    const pt = num(u['input_tokens']) || num(u['prompt_tokens']);
    const ct = num(u['output_tokens']) || num(u['completion_tokens']);
    const det = u['input_tokens_details'] as Record<string, unknown> | undefined;
    const detLegacy = u['prompt_tokens_details'] as Record<string, unknown> | undefined;
    const cached =
      num(det?.['cached_tokens']) ||
      num(detLegacy?.['cached_tokens']) ||
      num(u['cached_tokens']) ||
      num(u['prompt_cache_hit_tokens']);
    return mkOk(pt, ct, cached, Date.now() - start, u);
  } catch (e) {
    return mkErr(e, Date.now() - start);
  }
}

async function callKieGeminiDirect(target: Target, userText: string): Promise<CallResult> {
  const start = Date.now();
  try {
    const body: Record<string, unknown> = {
      stream: false,
      include_thoughts: false,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${SYSTEM_PROMPT}\n\n${userText}`,
            },
          ],
        },
      ],
    };
    const { data } = await postJson(
      `${target.baseURL}/${target.model}/v1/chat/completions`,
      target.authHeader,
      body,
    );
    const u = (data['usage'] ?? {}) as Record<string, unknown>;
    const pt = num(u['prompt_tokens']);
    const ct = num(u['completion_tokens']);
    // Gemini-style cache token поля могут отличаться, пробуем несколько вариантов:
    const cached =
      num(u['cached_tokens']) ||
      num(u['prompt_cache_hit_tokens']) ||
      num((u['prompt_tokens_details'] as Record<string, unknown> | undefined)?.['cached_tokens']);
    return mkOk(pt, ct, cached, Date.now() - start, u);
  } catch (e) {
    return mkErr(e, Date.now() - start);
  }
}

async function callGrsaiSse(target: Target, userText: string): Promise<CallResult> {
  const start = Date.now();
  try {
    const resp = await fetch(target.baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: target.authHeader,
      },
      body: JSON.stringify({
        model: target.model,
        stream: true,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }
    // SSE parser — собирает usage из последнего event'а, включая возможные cache-поля.
    const result = await collectSseUsage(resp);
    return mkOk(
      result.promptTokens,
      result.completionTokens,
      result.cachedTokens,
      Date.now() - start,
      result.usageRaw,
    );
  } catch (e) {
    return mkErr(e, Date.now() - start);
  }
}

async function collectSseUsage(resp: Response): Promise<{
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  usageRaw: Record<string, unknown>;
}> {
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let usageRaw: Record<string, unknown> = {};
  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error('пустое тело SSE-ответа');
  }
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
          const data = JSON.parse(payload) as { usage?: Record<string, unknown> };
          if (data.usage) {
            usageRaw = data.usage;
            promptTokens = num(data.usage['prompt_tokens']) || promptTokens;
            completionTokens = num(data.usage['completion_tokens']) || completionTokens;
            cachedTokens =
              num(data.usage['cached_tokens']) ||
              num(data.usage['prompt_cache_hit_tokens']) ||
              num(
                (data.usage['prompt_tokens_details'] as Record<string, unknown> | undefined)?.[
                  'cached_tokens'
                ],
              ) ||
              cachedTokens;
          }
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
    resp.body?.cancel().catch(() => {});
  }
  return { promptTokens, completionTokens, cachedTokens, usageRaw };
}

// ─── диспатчер ──────────────────────────────────────────────────────────────
async function callOnce(target: Target, userText: string): Promise<CallResult> {
  switch (target.protocol) {
    case 'deepseek-chat':
      return callDeepseekChat(target, userText);
    case 'openai-responses':
      return callOpenAIResponses(target, userText);
    case 'anthropic-messages':
      return callAnthropicMessages(target, userText);
    case 'kie-claude':
      return callKieClaude(target, userText);
    case 'kie-gpt-responses':
      return callKieGptResponses(target, userText);
    case 'kie-gemini-direct':
      return callKieGeminiDirect(target, userText);
    case 'grsai-sse':
      return callGrsaiSse(target, userText);
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────
function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}
function mkOk(
  pt: number,
  ct: number,
  cached: number,
  ms: number,
  usageRaw: Record<string, unknown>,
): CallResult {
  return {
    ok: true,
    ms,
    promptTokens: pt,
    cachedTokens: cached,
    completionTokens: ct,
    cacheHitRatio: pt > 0 ? cached / pt : 0,
    usageRaw,
  };
}
function mkErr(e: unknown, ms: number): CallResult {
  return {
    ok: false,
    ms,
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    cacheHitRatio: 0,
    error: e instanceof Error ? e.message : String(e),
  };
}
function fmt(n: number, w: number = 7): string {
  return String(n).padStart(w);
}
function pct(x: number): string {
  return (x * 100).toFixed(1).padStart(5) + '%';
}

// ─── размеры по target ──────────────────────────────────────────────────────
function getSizes(budget: 'full' | 'medium' | 'small'): number[] {
  switch (budget) {
    case 'full':
      return [1024, 2048, 2700, 5000, 10000, 20000, 50000];
    case 'medium':
      return [1024, 5000, 20000];
    case 'small':
      return [1024, 5000];
  }
}
function getParallelSize(budget: 'full' | 'medium' | 'small'): number {
  return budget === 'full' ? 10000 : 5000;
}
function getS3Sizes(budget: 'full' | 'medium' | 'small'): number[] {
  return budget === 'full' ? [5000, 20000] : [5000];
}

// ─── сценарии ───────────────────────────────────────────────────────────────
interface Row {
  target: string;
  scenario: 'S1' | 'S2' | 'S3';
  targetTokens: number;
  attemptOrIdx: number;
  tailLen: number;
  promptTokens: number;
  cachedTokens: number;
  cacheHitRatio: number;
  completionTokens: number;
  ms: number;
  error?: string;
  usageRaw?: Record<string, unknown>;
}

interface TargetSummary {
  target: string;
  status: 'ok' | 'partial' | 'fail';
  maxHitS1: number;
  maxCachedS1: number;
  avgHitS2: number;
  hitS3Variable: number;
  totalRequests: number;
  totalMs: number;
  notes: string;
}

let CHARS_PER_TOKEN = 2.8;

async function runTarget(target: Target): Promise<{ rows: Row[]; summary: TargetSummary }> {
  console.log(`\n████ ${target.name.padEnd(28)} (${target.protocol})`);
  const rows: Row[] = [];
  let calibrated = false;
  const tStart = Date.now();

  // S1: sequential identical
  const sizes = getSizes(target.sizeBudget);
  console.log(
    `  S1: sequential identical | размеры: ${sizes.join(', ')}`,
  );
  console.log(
    '  target_tok | actual_tok | cached_1 | cached_2 | hit_2 % | ms_1  | ms_2',
  );
  for (const tt of sizes) {
    const text = buildText(Math.round(tt * CHARS_PER_TOKEN));
    const r1 = await callOnce(target, text);
    if (!r1.ok) {
      console.log(`    ${tt.toString().padStart(5)} ✗ ${r1.error?.slice(0, 80)}`);
      rows.push({
        target: target.name,
        scenario: 'S1',
        targetTokens: tt,
        attemptOrIdx: 1,
        tailLen: 0,
        ...r1,
      } as Row);
      continue;
    }
    // калибровка на первом успешном
    if (!calibrated && r1.promptTokens > 0) {
      CHARS_PER_TOKEN = (text.length / r1.promptTokens) * 1.02;
      calibrated = true;
    }
    const r2 = await callOnce(target, text);
    rows.push({
      target: target.name,
      scenario: 'S1',
      targetTokens: tt,
      attemptOrIdx: 1,
      tailLen: 0,
      ...r1,
    } as Row);
    rows.push({
      target: target.name,
      scenario: 'S1',
      targetTokens: tt,
      attemptOrIdx: 2,
      tailLen: 0,
      ...r2,
    } as Row);
    if (r2.ok) {
      console.log(
        `   ${fmt(tt)}    | ${fmt(r1.promptTokens)}    | ${fmt(r1.cachedTokens)}  | ${fmt(r2.cachedTokens)}  | ${pct(r2.cacheHitRatio)} | ${fmt(r1.ms, 5)} | ${fmt(r2.ms, 5)}`,
      );
    } else {
      console.log(
        `   ${fmt(tt)}    | ${fmt(r1.promptTokens)}    | ✗ 2nd: ${r2.error?.slice(0, 60)}`,
      );
    }
  }

  // S2: 8 parallel identical
  const s2Size = getParallelSize(target.sizeBudget);
  console.log(`  S2: 8 parallel identical (~${s2Size} токенов)`);
  const s2Text = buildText(Math.round(s2Size * CHARS_PER_TOKEN));
  const s2Results = await Promise.all(
    Array.from({ length: 8 }, () => callOnce(target, s2Text)),
  );
  s2Results.forEach((r, i) => {
    rows.push({
      target: target.name,
      scenario: 'S2',
      targetTokens: s2Size,
      attemptOrIdx: i,
      tailLen: 0,
      ...r,
    } as Row);
  });
  const s2Ok = s2Results.filter((r) => r.ok);
  const avgS2Hit =
    s2Ok.length > 0
      ? s2Ok.reduce((s, r) => s + r.cacheHitRatio, 0) / s2Ok.length
      : 0;
  console.log(
    `    средний hit ratio: ${pct(avgS2Hit)}  (успешных: ${s2Ok.length}/8)`,
  );

  // S3: общий префикс + переменный хвост
  const s3Sizes = getS3Sizes(target.sizeBudget);
  console.log(`  S3: общий префикс + 41-симв хвост | размеры: ${s3Sizes.join(', ')}`);
  let s3LastHit = 0;
  for (const tt of s3Sizes) {
    const baseText = buildText(Math.round(tt * CHARS_PER_TOKEN));
    const tail1 = `\n\n=== id=${Math.random().toString(36).slice(2)} ts=${Date.now()} ===`;
    const tail2 = `\n\n=== id=${Math.random().toString(36).slice(2)} ts=${Date.now()} ===`;
    const r1 = await callOnce(target, baseText + tail1);
    const r2 = await callOnce(target, baseText + tail2);
    rows.push({
      target: target.name,
      scenario: 'S3',
      targetTokens: tt,
      attemptOrIdx: 1,
      tailLen: tail1.length,
      ...r1,
    } as Row);
    rows.push({
      target: target.name,
      scenario: 'S3',
      targetTokens: tt,
      attemptOrIdx: 2,
      tailLen: tail2.length,
      ...r2,
    } as Row);
    if (r1.ok && r2.ok) {
      console.log(
        `   ${fmt(tt)}    | ${fmt(r2.promptTokens)}    | ${fmt(r1.cachedTokens)}  | ${fmt(r2.cachedTokens)}  | ${pct(r2.cacheHitRatio)}`,
      );
      s3LastHit = r2.cacheHitRatio;
    } else {
      console.log(`    ${tt}: ✗ ${r1.error ?? r2.error ?? ''}`);
    }
  }

  // ── сводка ────────────────────────────────────────────────────────────────
  const s1Ok2 = rows.filter(
    (r) => r.scenario === 'S1' && r.attemptOrIdx === 2 && !r.error,
  );
  const maxHitS1 = Math.max(0, ...s1Ok2.map((r) => r.cacheHitRatio));
  const maxCachedS1 = Math.max(0, ...s1Ok2.map((r) => r.cachedTokens));
  const totalErrors = rows.filter((r) => r.error).length;
  const status: TargetSummary['status'] =
    totalErrors === 0 ? 'ok' : totalErrors < rows.length ? 'partial' : 'fail';

  let notes = '';
  if (maxCachedS1 === 0 && status !== 'fail') {
    notes = 'cache_tokens=0 во всех S1 → канал не возвращает cached_tokens или кэш не работает';
  } else if (maxHitS1 > 0.9) {
    notes = `кэш работает (max hit ${pct(maxHitS1)})`;
  } else if (maxHitS1 > 0.3) {
    notes = `кэш частичный (max hit ${pct(maxHitS1)})`;
  } else if (maxHitS1 > 0) {
    notes = `кэш слабый (max hit ${pct(maxHitS1)})`;
  }

  const summary: TargetSummary = {
    target: target.name,
    status,
    maxHitS1,
    maxCachedS1,
    avgHitS2: avgS2Hit,
    hitS3Variable: s3LastHit,
    totalRequests: rows.length,
    totalMs: Date.now() - tStart,
    notes,
  };
  console.log(
    `  ▶ Итог: status=${status} | maxCachedS1=${maxCachedS1} | maxHitS1=${pct(maxHitS1)} | S2=${pct(avgS2Hit)} | S3=${pct(s3LastHit)}`,
  );
  return { rows, summary };
}

// ─── targets ────────────────────────────────────────────────────────────────
function buildTargets(): Target[] {
  const all: Target[] = [];

  // 1. DeepSeek v4-flash (прямой канал)
  if (process.env.DEEPSEEK_API_KEY) {
    all.push({
      name: 'deepseek-v4-flash',
      protocol: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      authHeader: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      model: 'deepseek-v4-flash',
      sizeBudget: 'full',
    });
  }

  // 2. gpt-5.4-mini через прокси
  if (process.env.OPENAI_API_KEY) {
    const proxyPrefix = process.env.PROXY_PREFIX ?? 'myFeedproxy3128';
    all.push({
      name: 'gpt-5.4-mini',
      protocol: 'openai-responses',
      baseURL: process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1',
      authHeader: `Bearer ${proxyPrefix}:${process.env.OPENAI_API_KEY}`,
      model: 'gpt-5.4-mini',
      sizeBudget: 'full',
    });
  }

  // 3. MiniMax-M2.5 (Anthropic-формат)
  if (process.env.MINIMAX_API_KEY) {
    all.push({
      name: 'minimax-m2.5',
      protocol: 'anthropic-messages',
      baseURL: (process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic').replace(/\/+$/, ''),
      authHeader: `Bearer ${process.env.MINIMAX_API_KEY}`,
      model: 'MiniMax-M2.5',
      sizeBudget: 'medium',
    });
  }

  // 4. GRSAI Gemini-3-pro (SSE; direct grsai по нашему ENV)
  if (process.env.GRSAI_API_KEY) {
    const grsaiBase = (process.env.GRSAI_BASE_URL ?? 'https://grsaiapi.com').replace(/\/+$/, '');
    const proxyBase = (process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1').replace(/\/+$/, '');
    const proxyRoot = proxyBase.replace(/\/v1$/, '');
    const usesProxy =
      grsaiBase === proxyBase || grsaiBase === proxyRoot || grsaiBase.startsWith(proxyRoot);
    let url: string;
    let auth: string;
    if (usesProxy) {
      url = `${proxyRoot}/grsai/v1/chat/completions`;
      auth = `Bearer ${process.env.PROXY_PREFIX ?? 'myFeedproxy3128'}:${process.env.GRSAI_API_KEY}`;
    } else {
      const directBase = grsaiBase.endsWith('/v1') ? grsaiBase : `${grsaiBase}/v1`;
      url = `${directBase}/chat/completions`;
      auth = `Bearer ${process.env.GRSAI_API_KEY}`;
    }
    all.push({
      name: 'grsai-gemini-3-pro',
      protocol: 'grsai-sse',
      baseURL: url,
      authHeader: auth,
      model: 'gemini-3-pro',
      sizeBudget: 'medium',
    });
  }

  // 5. KIE Claude opus-4-7 (Anthropic-формат, ДОРОГО)
  if (process.env.KIE_API_KEY) {
    const kieBase = (process.env.KIE_BASE_URL ?? 'https://api.kie.ai').replace(/\/+$/, '');
    all.push({
      name: 'kie-claude-opus-4-7',
      protocol: 'kie-claude',
      baseURL: kieBase,
      authHeader: `Bearer ${process.env.KIE_API_KEY}`,
      model: 'claude-opus-4-7',
      sizeBudget: 'small',
      notes: 'дорогая модель — sizeBudget=small',
    });
    // 6. KIE GPT-5-4 (через дефис, OpenAI Responses)
    all.push({
      name: 'kie-gpt-5-4',
      protocol: 'kie-gpt-responses',
      baseURL: kieBase,
      authHeader: `Bearer ${process.env.KIE_API_KEY}`,
      model: 'gpt-5-4',
      sizeBudget: 'medium',
    });
    // 7. KIE Gemini-3-flash (модель в URL, chat-compat)
    all.push({
      name: 'kie-gemini-3-flash',
      protocol: 'kie-gemini-direct',
      baseURL: kieBase,
      authHeader: `Bearer ${process.env.KIE_API_KEY}`,
      model: 'gemini-3-flash',
      sizeBudget: 'medium',
    });
  }

  return all;
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const argTargets = process.argv
    .find((a) => a.startsWith('--targets='))
    ?.slice('--targets='.length)
    .split(',')
    .map((s) => s.trim());

  const allTargets = buildTargets();
  const targets = argTargets
    ? allTargets.filter((t) => argTargets.includes(t.name))
    : allTargets;

  console.log('=== LLM cache matrix probe ===');
  console.log(`  targets: ${targets.map((t) => t.name).join(', ')}`);

  const allRows: Row[] = [];
  const summaries: TargetSummary[] = [];
  const startedAt = Date.now();

  for (const t of targets) {
    try {
      const { rows, summary } = await runTarget(t);
      allRows.push(...rows);
      summaries.push(summary);
    } catch (e) {
      console.log(`  ✗ ${t.name} FATAL: ${e instanceof Error ? e.message : String(e)}`);
      summaries.push({
        target: t.name,
        status: 'fail',
        maxHitS1: 0,
        maxCachedS1: 0,
        avgHitS2: 0,
        hitS3Variable: 0,
        totalRequests: 0,
        totalMs: 0,
        notes: `FATAL: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const totalMs = Date.now() - startedAt;

  // ── итоговая таблица ─────────────────────────────────────────────────────
  console.log('\n═══════════════ ИТОГ ═══════════════');
  console.log(
    'target                        | status  | maxCachedS1 | maxHitS1 | avgHitS2 | hitS3 | notes',
  );
  console.log('-'.repeat(140));
  for (const s of summaries) {
    console.log(
      `${s.target.padEnd(29)} | ${s.status.padEnd(7)} | ${fmt(s.maxCachedS1, 11)} | ${pct(s.maxHitS1)}  | ${pct(s.avgHitS2)}  | ${pct(s.hitS3Variable)} | ${s.notes}`,
    );
  }

  // ── сохранить ────────────────────────────────────────────────────────────
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outJson = path.join(REPORTS_DIR, `matrix-${ts}.json`);
  const outCsv = path.join(REPORTS_DIR, `matrix-${ts}.csv`);
  await fs.writeFile(
    outJson,
    JSON.stringify({ totalMs, summaries, rows: allRows }, null, 2),
    'utf-8',
  );
  const csv: string[] = [
    'target,scenario,target_tokens,attempt_or_idx,tail_len,prompt_tokens,cached_tokens,cache_hit_ratio,completion_tokens,ms,error',
  ];
  for (const r of allRows) {
    csv.push(
      [
        r.target,
        r.scenario,
        r.targetTokens,
        r.attemptOrIdx,
        r.tailLen,
        r.promptTokens,
        r.cachedTokens,
        r.cacheHitRatio.toFixed(4),
        r.completionTokens,
        r.ms,
        r.error ? `"${r.error.replace(/"/g, "'").slice(0, 200)}"` : '',
      ].join(','),
    );
  }
  await fs.writeFile(outCsv, csv.join('\n'), 'utf-8');
  console.log(`\n✓ JSON: ${outJson}`);
  console.log(`✓ CSV:  ${outCsv}`);
  console.log(`Время прогона: ${(totalMs / 1000).toFixed(1)} сек`);
}

main().catch((e) => {
  console.error('\n✗ FATAL:', e);
  process.exit(1);
});
