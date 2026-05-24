import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import { TypedConfigService } from '../../../common/config/index';

import type {
  LlmCompleteInput,
  LlmCompleteOutput,
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
    const stream = await this.client.messages.stream({
      model,
      max_tokens: input.maxTokens ?? 4096,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      system: buildSystemBlocks(input.system),
      messages: [{ role: 'user', content: buildUserContent(input.user) }],
      ...(input.tools ? { tools: input.tools } : {}),
    });

    const final = await stream.finalMessage();
    return mapAnthropicResponseToOutput(final, model, 'anthropic');
  }

  private async completeNonStreaming(
    input: LlmCompleteInput,
    model: string,
  ): Promise<LlmCompleteOutput> {
    const message = await this.client.messages.create({
      model,
      max_tokens: input.maxTokens ?? 4096,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      system: buildSystemBlocks(input.system),
      messages: [{ role: 'user', content: buildUserContent(input.user) }],
      ...(input.tools ? { tools: input.tools } : {}),
      stream: false,
    });
    return mapAnthropicResponseToOutput(message, model, 'anthropic');
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
 */
export function mapAnthropicResponseToOutput(
  message: Anthropic.Message,
  model: string,
  provider: LlmCompleteOutput['provider'],
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
