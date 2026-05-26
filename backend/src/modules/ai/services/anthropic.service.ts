import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

import type {
  LlmCompleteInput,
  LlmCompleteOutput,
  LlmTool,
  LlmToolCall,
} from './llm.types';
import { LlmError } from './llm.types';

/**
 * Anthropic Messages API клиент.
 *
 * - По умолчанию ходит в `api.anthropic.com` напрямую. Если `ANTHROPIC_USE_PROXY=true`
 *   — через `cfg.ai.anthropic.proxyUrl` (анти-блокировка из РФ).
 * - Сначала пытается streaming, на устойчивую ошибку — non-streaming.
 *   Это важно для длинных генераций (минуты): без streaming клиент может
 *   получить timeout от nginx/прокси раньше, чем модель закончит.
 * - На сетевую ошибку или 5xx — `LlmError` (caller решает fallback).
 * - На 403 (РФ-блок) — `LlmError(httpStatus=403)` → caller дёрнет MiniMax.
 *
 * Поддерживает tool_use и prompt-caching через `cacheControl`.
 */
@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.client = new Anthropic({
      apiKey: this.cfg.ai.anthropic.apiKey,
      ...(this.cfg.ai.anthropic.useProxy
        ? { baseURL: this.cfg.ai.anthropic.proxyUrl }
        : {}),
    });
  }

  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const model = input.model ?? this.cfg.ai.anthropic.model;
    try {
      return await this.completeStreaming(input, model);
    } catch (err) {
      // На устойчивые сетевые ошибки/таймаут — пробуем non-streaming.
      const status = extractStatus(err);
      // 403 уходим сразу наверх (caller сделает fallback на MiniMax).
      if (status === 403) {
        throw new LlmError(
          `Anthropic 403 (вероятно блок IP): ${errMsg(err)}`,
          403,
          err,
        );
      }
      this.logger.warn(
        `Anthropic streaming не удался (${status ?? 'no-status'}): ${errMsg(err)}; fallback на non-streaming`,
      );
      try {
        return await this.completeNonStreaming(input, model);
      } catch (err2) {
        const status2 = extractStatus(err2);
        throw new LlmError(
          `Anthropic non-streaming также упал: ${errMsg(err2)}`,
          status2,
          err2,
        );
      }
    }
  }

  // ─────────────────────────── private ─────────────────────────────────────

  private async completeStreaming(
    input: LlmCompleteInput,
    model: string,
  ): Promise<LlmCompleteOutput> {
    const { tools, toolChoice } = buildAnthropicToolBindings(input);
    const stream = await this.client.messages.stream({
      model,
      max_tokens: input.maxTokens ?? 4096,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      system: buildSystemBlocks(input.system),
      messages: [{ role: 'user', content: buildUserContent(input.user) }],
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    });

    const final = await stream.finalMessage();
    return mapAnthropicResponseToOutput(
      final,
      model,
      'anthropic',
      input.responseFormat,
    );
  }

  private async completeNonStreaming(
    input: LlmCompleteInput,
    model: string,
  ): Promise<LlmCompleteOutput> {
    const { tools, toolChoice } = buildAnthropicToolBindings(input);
    const message = await this.client.messages.create({
      model,
      max_tokens: input.maxTokens ?? 4096,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      system: buildSystemBlocks(input.system),
      messages: [{ role: 'user', content: buildUserContent(input.user) }],
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      stream: false,
    });
    return mapAnthropicResponseToOutput(
      message,
      model,
      'anthropic',
      input.responseFormat,
    );
  }
}

// ─────────────────────────── helpers ───────────────────────────────────────

/**
 * Собирает system-блок Anthropic'а с поддержкой prompt caching.
 * Если `cacheControl: 'ephemeral'` — отдаёт массив с `cache_control`.
 */
export function buildSystemBlocks(
  system: LlmCompleteInput['system'],
): string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  if (system.cacheControl === 'ephemeral') {
    return [
      {
        type: 'text',
        text: system.text,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }
  return system.text;
}

/**
 * Собирает user-content для Anthropic Messages API.
 *
 * - Если `user` — строка → отдаём как есть (legacy).
 * - Если `user` — объект с `cacheControl: 'ephemeral'` → оборачиваем в
 *   один text-блок с `cache_control: { type: 'ephemeral' }`. Это второй
 *   breakpoint (после system), который позволяет кешировать большие
 *   user-блоки (транскрипт, retrieval pool, knowledge-блоки).
 *
 * Минимум для попадания в кеш — ~1024 токенов (~500 символов) для Sonnet 4.5
 * и старше, ~4096 токенов для Opus 4+. Короткие блоки силно не кешируются —
 * см. shared/prompt-caching.md из claude-api skill.
 *
 * T7-F3 (prompt caching distribution).
 */
export function buildUserContent(
  user: LlmCompleteInput['user'],
):
  | string
  | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  if (typeof user === 'string') return user;
  if (user.cacheControl === 'ephemeral') {
    return [
      {
        type: 'text',
        text: user.text,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }
  return user.text;
}

/**
 * T7-F6 — синтетическое имя tool'а, который Anthropic Messages API использует
 * для эмуляции `responseFormat: json_schema`. JSON Schema из caller'а
 * становится `input_schema` этого tool'а, `tool_choice` принуждает модель его
 * вызвать. В ответе `block.type === 'tool_use'` → сериализуем `block.input`
 * как text-ответ (caller всё равно делает JSON.parse). См. T7-F6.
 */
export const ANTHROPIC_JSON_SCHEMA_TOOL_NAME = 'json_response';

/**
 * T7-F6 — собирает `tools` и `tool_choice` для Anthropic Messages API:
 *  - Если caller передал `responseFormat: json_schema` — превращаем в
 *    synthetic tool с принудительным `tool_choice: { type: 'tool', name }`.
 *    Это надёжнее «JSON only» в system: Anthropic гарантирует, что
 *    `block.input` соответствует `input_schema`.
 *  - Если caller передал свои `tools` (без json_schema) — отдаём как есть.
 *  - Иначе — без tools.
 *
 * `responseFormat: json_object` не имеет нативного эквивалента в Anthropic —
 * полагаемся на текст из system-промта («верни JSON»). Caller всё равно
 * парсит result.text через JSON.parse.
 */
export function buildAnthropicToolBindings(input: LlmCompleteInput): {
  tools?: LlmTool[];
  toolChoice?: { type: 'tool'; name: string } | { type: 'auto' };
} {
  const fmt = input.responseFormat;
  if (fmt && fmt.type === 'json_schema') {
    const syntheticTool: LlmTool = {
      name: ANTHROPIC_JSON_SCHEMA_TOOL_NAME,
      description: `Возвращает структурированный JSON-ответ согласно схеме (${fmt.name}). Используй ТОЛЬКО этот инструмент для ответа.`,
      input_schema: normalizeAnthropicInputSchema(fmt.schema),
    };
    const extraTools = input.tools ?? [];
    return {
      tools: [syntheticTool, ...extraTools],
      toolChoice: { type: 'tool', name: ANTHROPIC_JSON_SCHEMA_TOOL_NAME },
    };
  }
  if (input.tools && input.tools.length > 0) {
    return { tools: input.tools };
  }
  return {};
}

/**
 * Anthropic Messages API требует, чтобы `input_schema` был object с
 * `properties`. Если caller передал примитивную схему (например для голого
 * массива), оборачиваем её в `{ type: 'object', properties: { result: ... } }`.
 * Caller увидит это в `block.input.result` через обёртку в
 * `mapAnthropicResponseToOutput`.
 *
 * NB: для подавляющего большинства наших промтов (chapters / tasks / dialog)
 * Zod-схема — массив или объект, и здесь нужна только нормализация
 * `additionalProperties: false` + удаление `$schema`.
 */
function normalizeAnthropicInputSchema(
  schema: Record<string, unknown>,
): {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
} {
  // Удаляем JSON Schema мета-поля, которые Anthropic не понимает.
  const cleaned: Record<string, unknown> = { ...schema };
  delete cleaned['$schema'];
  delete cleaned['$id'];

  if (cleaned['type'] === 'object') {
    return {
      type: 'object',
      properties: (cleaned['properties'] as Record<string, unknown>) ?? {},
      ...(Array.isArray(cleaned['required'])
        ? { required: cleaned['required'] as string[] }
        : {}),
      additionalProperties:
        typeof cleaned['additionalProperties'] === 'boolean'
          ? (cleaned['additionalProperties'] as boolean)
          : false,
    };
  }
  // Не-object root (массив / примитив) → оборачиваем в { result }.
  return {
    type: 'object',
    properties: { result: cleaned },
    required: ['result'],
    additionalProperties: false,
  };
}

/**
 * Маппит ответ Anthropic SDK в `LlmCompleteOutput`.
 * Используется и AnthropicService, и MinimaxService (тот же SDK).
 *
 * Извлекает prompt-caching токены из `usage`:
 *  - `cache_read_input_tokens`     → `cachedTokens` (cache hit, ~0.1× input price).
 *  - `cache_creation_input_tokens` → `cacheCreationTokens` (cache write,
 *                                    ~1.25× input price для 5-минутного TTL).
 *  - `input_tokens` от Anthropic'а — это «нетto»: uncached + uncached prefix.
 *    Чтобы AiUsageLog видел общий объём, прибавляем cached/creation к
 *    `inputTokens` — иначе billing/quota по `input_tokens_total` занижен.
 *    Cost-расчёт в LlmRouterService.computeCostUsd корректно вычитает
 *    `cachedTokens` (cached_per_1M < input_per_1M), так что overcount-а нет.
 *
 * T7-F6: если был передан `responseFormat: json_schema` — synthetic tool_use
 * сериализуется в `text` (JSON-stringify), чтобы caller мог продолжать
 * парсить через `JSON.parse(result.text)`. Если root схемы был не-object
 * (массив/примитив) — извлекаем `.result`.
 */
export function mapAnthropicResponseToOutput(
  message: Anthropic.Message,
  model: string,
  provider: LlmCompleteOutput['provider'],
  responseFormat?: LlmCompleteInput['responseFormat'],
): LlmCompleteOutput {
  let text = '';
  const toolCalls: LlmToolCall[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({ name: block.name, input: block.input });
    }
  }

  // T7-F6: если caller просил json_schema — конвертируем synthetic tool_use
  // обратно в text для совместимости с парсерами вида JSON.parse(result.text).
  if (
    responseFormat?.type === 'json_schema' &&
    text.length === 0 &&
    toolCalls.length > 0
  ) {
    const jsonCall = toolCalls.find(
      (tc) => tc.name === ANTHROPIC_JSON_SCHEMA_TOOL_NAME,
    );
    if (jsonCall) {
      const rootIsObject =
        typeof responseFormat.schema['type'] === 'string' &&
        responseFormat.schema['type'] === 'object';
      const payload =
        rootIsObject
          ? jsonCall.input
          : (jsonCall.input as { result?: unknown })?.result ?? jsonCall.input;
      text = JSON.stringify(payload);
    }
  }
  // SDK типизация: cache_*_input_tokens могут быть null/undefined у не-кешируемых
  // моделей. Анализ Usage из @anthropic-ai/sdk показывает поля как `number | null`.
  const usage = message.usage as unknown as {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  const baseInput = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  return {
    text,
    // Anthropic усreport'ит input_tokens как «нетto»: фактически новые токены.
    // Чтобы общий учёт был полным — суммируем все 3 ведра.
    inputTokens: baseInput + cacheRead + cacheCreation,
    outputTokens: usage.output_tokens ?? 0,
    ...(cacheRead > 0 ? { cachedTokens: cacheRead } : {}),
    ...(cacheCreation > 0 ? { cacheCreationTokens: cacheCreation } : {}),
    model,
    provider,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const s = (err as { status?: unknown }).status;
  return typeof s === 'number' ? s : undefined;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
