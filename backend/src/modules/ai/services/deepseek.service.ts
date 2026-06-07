import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import OpenAI from 'openai';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { isThinkingModel } from './llm-thinking-models';
import type {
  LlmCompleteInput,
  LlmCompleteOutput,
  LlmToolCall,
} from './llm.types';
import { LlmError, LlmFormatNotSupportedError } from './llm.types';

/**
 * DeepSeek через OpenAI-compat /v1/chat/completions.
 *
 * - baseURL: `cfg.ai.deepseek.baseUrl` (default `https://api.deepseek.com/v1`).
 * - Дефолт-модель: `cfg.ai.deepseek.defaultModel` (`deepseek-v4-flash`).
 * - JSON Schema strict — `response_format: {type:'json_schema', json_schema:{name,strict,schema}}`.
 * - Tools — стандартный OpenAI-style.
 * - Reasoning — поле `reasoning: {effort}` для V4-pro; для flash thinking-off дефолт.
 * - Prompt caching: автоматический; `usage.prompt_cache_hit_tokens` (или
 *   `cached_tokens` у новых API) → `cachedTokens`.
 * - Retry [500, 1000, 2000]ms на 429 / 5xx.
 *
 * ТЗ 2026-05-25 — автоконвертация json_schema → tool для Pro:
 *   DeepSeek-V4-Pro в thinking-режиме НЕ поддерживает strict json_schema
 *   (`400 «This response_format type is unavailable now»`) и forced
 *   tool_choice. Работает только `tools + tool_choice='auto'`. Чтобы не
 *   переписывать 100+ caller-ов, использующих json_schema, конвертируем
 *   автоматически в `buildParams`: создаём виртуальный tool из json_schema,
 *   подмешиваем hint в user-сообщение, а в `mapResponse` достаём ответ из
 *   `tool_calls[0].input` и стрингифицируем обратно в `text`.
 */
@Injectable()
export class DeepSeekService {
  private readonly logger = new Logger(DeepSeekService.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly retryDelaysMs = [500, 1000, 2000];
  /**
   * ТЗ-3 Фаза 3 — модели, на которых прокси НЕ принял forced tool_choice
   * (format-400). Память per-process: однажды откатив модель на 'auto', больше
   * не форсим её до перезапуска. Заполняется guard'ом в `complete()`.
   */
  private readonly forceUnsupportedModels = new Set<string>();

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {
    this.client = new OpenAI({
      baseURL: this.cfg.ai.deepseek.baseUrl,
      apiKey: this.cfg.ai.deepseek.apiKey,
    });
    this.defaultModel = this.cfg.ai.deepseek.defaultModel;
  }

  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const model = input.model ?? this.defaultModel;
    const { params, autoConvertedToolName, usedForce } = this.buildParams(
      input,
      model,
    );

    if (autoConvertedToolName) {
      this.metrics?.incDeepseekSchemaToToolConversion({ model });
      // ТЗ 2026-05-25 Фаза 1 — также инкрементируем универсальный guard-counter
      // (используется и адаптером openai-chat для одного и того же события).
      this.metrics?.incLlmThinkingModelGuard({
        kind: 'schema-to-tool',
        model,
      });
      this.logger.debug(
        `DeepSeek: автоконвертация json_schema → tool model=${model} schemaName=${autoConvertedToolName}`,
      );
    }

    try {
      return await this.sendWithRetry(params, model, autoConvertedToolName);
    } catch (err) {
      // ТЗ-3 Фаза 3 — guard-откат: forced tool_choice не принят прокси
      // (format-400 / LlmFormatNotSupportedError) И мы его форсили → помечаем
      // модель как unsupported, метрика + warn, пересобираем tool_choice='auto'
      // и повторяем ОДИН раз. Не-format ошибки (network/500/таймаут уже
      // отретраены внутри) сюда тоже долетают, но повтор делаем ТОЛЬКО на
      // format-ошибку при usedForce.
      if (usedForce && err instanceof LlmFormatNotSupportedError) {
        this.forceUnsupportedModels.add(model);
        this.metrics?.incLlmThinkingModelGuard?.({
          kind: 'tool-choice-relaxed',
          model,
        });
        this.logger.warn(
          `DeepSeek: forced tool_choice не принят прокси — откат на 'auto', model=${model}: ${errMsg(err)}`,
        );
        // Новый объект params (не мутируем исходный — он уже отправлен первым
        // вызовом): меняем только tool_choice на 'auto', tools остаются.
        const relaxedParams = { ...params, tool_choice: 'auto' };
        return this.sendWithRetry(relaxedParams, model, autoConvertedToolName);
      }
      throw err;
    }
  }

  /**
   * Один логический вызов прокси с retry [500,1000,2000]ms на 429/5xx.
   * Format-400 (response_format / json_schema / tool_choice / function) →
   * `LlmFormatNotSupportedError` (router трактует как retriable-переключение
   * провайдера; `complete()` использует его для guard-отката forced tool_choice).
   * Прочие ошибки после исчерпания retry → `LlmError`.
   */
  private async sendWithRetry(
    params: Record<string, unknown>,
    model: string,
    autoConvertedToolName: string | undefined,
  ): Promise<LlmCompleteOutput> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        const response = await this.client.chat.completions.create(
          params as unknown as Parameters<typeof this.client.chat.completions.create>[0],
        );
        return this.mapResponse(response, model, autoConvertedToolName);
      } catch (err) {
        lastErr = err;
        const status = extractStatus(err);
        if (status === 400 && this.isFormatError(err)) {
          throw new LlmFormatNotSupportedError(
            `DeepSeek: response_format не поддерживается моделью ${model}: ${errMsg(err)}`,
          );
        }
        const isRetriable = status === 429 || (status !== undefined && status >= 500);
        if (!isRetriable || attempt === this.retryDelaysMs.length) {
          this.logger.warn(
            `DeepSeek complete (${status ?? 'no-status'}): ${errMsg(err)}`,
          );
          throw new LlmError(`DeepSeek: ${errMsg(err)}`, status, err);
        }
        const delayMs = this.retryDelaysMs[attempt] ?? 0;
        this.logger.warn(
          `DeepSeek retry attempt=${attempt + 1} status=${status} delayMs=${delayMs}: ${errMsg(err)}`,
        );
        await sleep(delayMs);
      }
    }
    throw new LlmError(`DeepSeek: исчерпали retry: ${errMsg(lastErr)}`, undefined, lastErr);
  }

  // ─────────────────────────── private ─────────────────────────────────────

  private buildParams(
    input: LlmCompleteInput,
    model: string,
  ): {
    params: Record<string, unknown>;
    autoConvertedToolName?: string;
    usedForce: boolean;
  } {
    // T7-F3: LlmUserInput может быть string или {text, cacheControl?}. DeepSeek
    // не поддерживает Anthropic-style cache_control, поэтому распаковываем в
    // строку и полагаемся на их автоматический prompt caching (см.
    // prompt_cache_hit_tokens в mapResponse).
    const userText = typeof input.user === 'string' ? input.user : input.user.text;
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: input.system.text },
      { role: 'user', content: userText },
    ];
    const params: Record<string, unknown> = {
      model,
      stream: false,
      messages,
    };
    if (input.maxTokens !== undefined) {
      params['max_tokens'] = input.maxTokens;
    }
    if (input.temperature !== undefined) {
      params['temperature'] = input.temperature;
    }

    const fmt = input.responseFormat;
    const callerHasTools = !!(input.tools && input.tools.length > 0);

    // ТЗ 2026-05-25 §4 + Фаза 1 — детектор thinking-моделей через единый helper
    // (`llm-thinking-models.ts`). Pro / *-pro / *-thinking падают 400 на strict
    // json_schema и forced tool_choice. Нужен ниже для reasoning-effort.
    const isThinking = isThinkingModel(model);
    // Фикс 2026-06-03 (mtg_01KT6HQ…): прокси отдаёт «This response_format type
    // is unavailable now» для json_schema на ВСЕХ deepseek-моделях (flash/chat
    // тоже, не только thinking-pro). Поэтому конвертируем json_schema →
    // synthetic tool для любой модели, а не только thinking. Tools +
    // tool_choice='auto' поддерживаются всеми, ответ достаём из tool_calls.
    const autoConvert = fmt?.type === 'json_schema' && !callerHasTools;

    let autoConvertedToolName: string | undefined;
    let usedForce = false;

    if (autoConvert && fmt?.type === 'json_schema') {
      autoConvertedToolName = `submit_${fmt.name}`;
      params['tools'] = [
        {
          type: 'function',
          function: {
            name: autoConvertedToolName,
            description: `Отдать структурированный результат по схеме ${fmt.name}.`,
            parameters: fmt.schema,
          },
        },
      ];
      // ТЗ-3 Фаза 3 — за флагом форсим вызов synthetic-tool вместо 'auto', чтобы
      // не-thinking flash возвращал структуру, а не прозу. Thinking-модели НЕ
      // форсим (они 400'ят на forced tool_choice). Если модель уже 400'нула на
      // форс ранее — не форсим её до перезапуска (forceUnsupportedModels).
      // Флаг OFF (дефолт) → 'auto' = текущее поведение без изменений.
      const canForce =
        this.cfg.ai.deepseek.forceToolChoiceEnabled &&
        !isThinking &&
        !this.forceUnsupportedModels.has(model);
      usedForce = canForce;
      params['tool_choice'] = canForce
        ? { type: 'function', function: { name: autoConvertedToolName } }
        : 'auto';
      // Подмешиваем hint, иначе модель может ответить свободным текстом.
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content += `\n\nВажно: верни результат через вызов инструмента ${autoConvertedToolName}.`;
      }
      // response_format НЕ выставляем — модель ответит через tool_calls.
    } else if (fmt) {
      // Фикс 2026-06-03 — strict json_schema не поддерживается ни одной
      // deepseek-моделью текущего прокси. Если caller уже передал tools —
      // forced-конверт не нужен, просто снимаем json_schema (оставляем
      // tools + tool_choice='auto'), не выставляя response_format.
      const skipStrict = fmt.type === 'json_schema' && callerHasTools;
      if (skipStrict) {
        // Метрика + лог для observability — caller передал лишний параметр.
        this.metrics?.incLlmThinkingModelGuard({
          kind: 'strict-stripped',
          model,
        });
        this.logger.warn(
          `DeepSeek: strict json_schema снят на ${model}; caller передал tools=${input.tools!.length} + json_schema(${fmt.name}). Оставляем только tools + tool_choice='auto'.`,
        );
      } else if (fmt.type === 'json_object') {
        params['response_format'] = { type: 'json_object' };
        // DeepSeek/OpenAI json_object mode требует слово "json" в сообщениях,
        // иначе 400 «Prompt must contain the word 'json'... to use
        // 'response_format' of type 'json_object'». Гарантируем его наличие
        // (иначе meeting-report-fast и др. промпты без слова JSON падают).
        const hasJsonWord = messages.some((m) => /json/i.test(m.content));
        if (!hasJsonWord && messages[0]) {
          messages[0].content += '\n\nФормат ответа: верни валидный JSON.';
        }
      } else if (fmt.type === 'json_schema') {
        params['response_format'] = {
          type: 'json_schema',
          json_schema: {
            name: fmt.name,
            strict: fmt.strict,
            schema: fmt.schema,
          },
        };
      }
      // json_schema без caller-tools сюда не доходит — обработан autoConvert.
    }

    if (callerHasTools) {
      params['tools'] = input.tools!.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
      // tool_choice всегда 'auto' — forced/required не поддерживается thinking.
      params['tool_choice'] = 'auto';
    }
    if (input.reasoningEffort && isThinking) {
      params['reasoning'] = { effort: input.reasoningEffort };
    }
    return { params, autoConvertedToolName, usedForce };
  }

  /**
   * DeepSeek JSON mode (`response_format: json_object`) требует, чтобы слово
   * «json» присутствовало в system или user (офиц. дока + probe 2026-06-03),
   * иначе 400 «Prompt must contain the word 'json'». Если его нет — дописываем
   * короткую инструкцию в ХВОСТ последнего user-сообщения. SYSTEM не трогаем:
   * стабильный SYSTEM нужен для prompt caching (правка SYSTEM ломает кеш).
   */
  private ensureJsonWord(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
  ): void {
    const hasJson = messages.some((m) =>
      m.content.toLowerCase().includes('json'),
    );
    if (hasJson) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content += '\n\nОтвет верни строго в формате JSON.';
    }
  }

  private mapResponse(
    response: unknown,
    model: string,
    autoConvertedToolName?: string,
  ): LlmCompleteOutput {
    const r = response as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
        cached_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const choice = r.choices?.[0];
    let text = choice?.message?.content ?? '';
    const toolCalls: LlmToolCall[] = [];
    for (const tc of choice?.message?.tool_calls ?? []) {
      const name = tc.function?.name ?? '';
      const argsRaw = tc.function?.arguments ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(argsRaw);
      } catch {
        parsed = { raw: argsRaw };
      }
      if (name) toolCalls.push({ name, input: parsed });
    }

    // ТЗ 2026-05-25 — если был автоконверт json_schema → tool, caller ждал
    // JSON-строку в `text`. Стрингифицируем args автоконвертированного
    // tool-call обратно в text, чтобы интерфейс остался прежним.
    if (autoConvertedToolName && !text) {
      const autoTc = toolCalls.find((tc) => tc.name === autoConvertedToolName);
      if (autoTc) {
        text = JSON.stringify(autoTc.input);
      }
    }

    const cachedTokens =
      r.usage?.prompt_cache_hit_tokens ??
      r.usage?.cached_tokens ??
      r.usage?.prompt_tokens_details?.cached_tokens ??
      0;
    return {
      text,
      inputTokens: r.usage?.prompt_tokens ?? 0,
      outputTokens: r.usage?.completion_tokens ?? 0,
      cachedTokens,
      model,
      provider: 'deepseek',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  private isFormatError(err: unknown): boolean {
    const msg = errMsg(err).toLowerCase();
    return (
      msg.includes('response_format') ||
      msg.includes('json_schema') ||
      msg.includes('schema') ||
      // ТЗ-3 Фаза 3 — forced tool_choice ({type:'function'}) тоже формат-ошибка
      // прокси: классифицируем как LlmFormatNotSupportedError, чтобы guard в
      // complete() мог откатить на 'auto' (и router — переключить провайдера).
      msg.includes('tool_choice') ||
      msg.includes('function')
    );
  }
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const s = (err as { status?: unknown }).status;
  return typeof s === 'number' ? s : undefined;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
