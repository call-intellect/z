import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

import { TypedConfigService } from '../../../common/config/index';

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
 */
@Injectable()
export class DeepSeekService {
  private readonly logger = new Logger(DeepSeekService.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly retryDelaysMs = [500, 1000, 2000];

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {
    this.client = new OpenAI({
      baseURL: this.cfg.ai.deepseek.baseUrl,
      apiKey: this.cfg.ai.deepseek.apiKey,
    });
    this.defaultModel = this.cfg.ai.deepseek.defaultModel;
  }

  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const model = input.model ?? this.defaultModel;
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

  private buildParams(input: LlmCompleteInput, model: string): Record<string, unknown> {
    // T7-F3: LlmUserInput может быть string или {text, cacheControl?}. DeepSeek
    // не поддерживает Anthropic-style cache_control, поэтому распаковываем в
    // строку и полагаемся на их автоматический prompt caching (см.
    // prompt_cache_hit_tokens в mapResponse).
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
    const fmt = input.responseFormat;
    if (fmt) {
      if (fmt.type === 'json_object') {
        params['response_format'] = { type: 'json_object' };
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
    if (input.reasoningEffort && model.includes('pro')) {
      params['reasoning'] = { effort: input.reasoningEffort };
    }
    return params;
  }

  private mapResponse(
    response: unknown,
    model: string,
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
    const text = choice?.message?.content ?? '';
    const toolCalls: LlmToolCall[] = [];
    for (const tc of choice?.message?.tool_calls ?? []) {
      const name = tc.function?.name ?? '';
      const argsRaw = tc.function?.arguments ?? '';
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(argsRaw);
      } catch {
        parsed = { raw: argsRaw };
      }
      if (name) toolCalls.push({ name, input: parsed });
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
      msg.includes('schema')
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
