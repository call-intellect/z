import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

import { TypedConfigService } from '../../../common/config/index';

import type {
  LlmCompleteInput,
  LlmCompleteOutput,
  LlmToolCall,
} from './llm.types';
import { LlmError } from './llm.types';

/**
 * Ollama через OpenAI-совместимый endpoint `/v1/chat/completions`.
 *
 * - baseURL: `cfg.ai.ollama.baseUrl` (default `https://ollama.agent-lia.ru/v1`).
 * - apiKey: `cfg.ai.ollama.apiKey` (опционально; default = пустая строка → `'no-key'`).
 * - Дефолт-модель: `qwen3:30b-a3b-instruct-2507`.
 * - JSON-mode: `response_format: {type:'json_object'}` поддерживается нативно.
 * - JSON Schema strict: НЕ поддерживается → тихий downgrade в json_object
 *   (+ слово «json» в промпте). Структуру гарантирует zod-валидация в сервисах.
 * - Embeddings (`bge-m3`) — TODO Фаза 11.
 */
@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly client: OpenAI;
  private readonly defaultModel = 'qwen3:30b-a3b-instruct-2507';
  private readonly retryDelaysMs = [500, 1000, 2000];

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {
    const apiKey = this.cfg.ai.ollama.apiKey || 'no-key';
    this.client = new OpenAI({
      baseURL: this.cfg.ai.ollama.baseUrl,
      apiKey,
    });
  }

  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const model = input.model ?? this.defaultModel;

    // Фикс 2026-06-03 — Ollama не поддерживает strict json_schema, но это
    // tertiary-провайдер: вместо throw (= гарантированное падение всей задачи)
    // тихо деградируем json_schema → json_object. Структуру гарантирует
    // zod-валидация на стороне сервисов (см. buildParams).
    if (input.responseFormat?.type === 'json_schema') {
      this.logger.debug(
        `Ollama: json_schema → json_object downgrade (модель=${model}, schema=${input.responseFormat.name})`,
      );
    }

    const params = this.buildParams(input, model);

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        const response = await this.client.chat.completions.create(
          params as unknown as Parameters<typeof this.client.chat.completions.create>[0],
        );
        return this.mapResponse(response, model);
      } catch (err) {
        lastErr = err;
        const status = extractStatus(err);
        const isRetriable = status === 429 || (status !== undefined && status >= 500);
        if (!isRetriable || attempt === this.retryDelaysMs.length) {
          this.logger.warn(
            `Ollama complete (${status ?? 'no-status'}): ${errMsg(err)}`,
          );
          throw new LlmError(`Ollama: ${errMsg(err)}`, status, err);
        }
        const delayMs = this.retryDelaysMs[attempt] ?? 0;
        this.logger.warn(
          `Ollama retry attempt=${attempt + 1} status=${status} delayMs=${delayMs}: ${errMsg(err)}`,
        );
        await sleep(delayMs);
      }
    }
    throw new LlmError(`Ollama: исчерпали retry: ${errMsg(lastErr)}`, undefined, lastErr);
  }

  // ─────────────────────────── private ─────────────────────────────────────

  private buildParams(input: LlmCompleteInput, model: string): Record<string, unknown> {
    // T7-F3: LlmUserInput может быть string или {text, cacheControl?}.
    // Ollama (локальный) не имеет prompt caching API; распаковываем в строку.
    const userText = typeof input.user === 'string' ? input.user : input.user.text;
    const params: Record<string, unknown> = {
      model,
      stream: false,
      messages: [
        { role: 'system', content: input.system.text },
        { role: 'user', content: userText },
      ],
    };
    if (input.maxTokens !== undefined) {
      params['max_tokens'] = input.maxTokens;
    }
    if (input.temperature !== undefined) {
      params['temperature'] = input.temperature;
    }
    // json_object — нативно; json_schema деградируем в json_object (strict
    // не поддерживается Ollama). В обоих случаях гарантируем слово «json» в
    // промпте — иначе OpenAI-compat сервер отвергает json_object режим.
    const fmtType = input.responseFormat?.type;
    if (fmtType === 'json_object' || fmtType === 'json_schema') {
      params['response_format'] = { type: 'json_object' };
      const messages = params['messages'] as Array<{
        role: string;
        content: string;
      }>;
      const hasJsonWord = messages.some((m) => /json/i.test(m.content));
      if (!hasJsonWord && messages[0]) {
        messages[0].content += '\n\nФормат ответа: верни валидный JSON.';
      }
    }
    if (input.tools && input.tools.length > 0) {
      params['tools'] = input.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
      params['tool_choice'] = 'auto';
    }
    return params;
  }

  private mapResponse(response: unknown, model: string): LlmCompleteOutput {
    const r = response as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = r.choices?.[0];
    const text = choice?.message?.content ?? '';
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
    return {
      text,
      inputTokens: r.usage?.prompt_tokens ?? 0,
      outputTokens: r.usage?.completion_tokens ?? 0,
      cachedTokens: 0,
      model,
      provider: 'ollama',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
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
