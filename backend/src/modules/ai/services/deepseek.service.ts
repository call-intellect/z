import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import OpenAI from 'openai';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { ensureJsonWordInUser } from './json-mode.util';
import { isThinkingModel } from './llm-thinking-models';
import type { LlmCompleteInput, LlmCompleteOutput, LlmToolCall } from './llm.types';
import { LlmError, LlmFormatNotSupportedError } from './llm.types';
import { stripThinkTags } from './think-tags.util';

@Injectable()
export class DeepSeekService {
  private readonly logger = new Logger(DeepSeekService.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly retryDelaysMs = [500, 1000, 2000];
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
    const { params, autoConvertedToolName, usedForce } = this.buildParams(input, model);

    if (autoConvertedToolName) {
      this.metrics?.incDeepseekSchemaToToolConversion({ model });
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
      if (usedForce && err instanceof LlmFormatNotSupportedError) {
        this.forceUnsupportedModels.add(model);
        this.metrics?.incLlmThinkingModelGuard?.({
          kind: 'tool-choice-relaxed',
          model,
        });
        this.logger.warn(
          `DeepSeek: forced tool_choice не принят прокси — откат на 'auto', model=${model}: ${errMsg(err)}`,
        );
        const relaxedParams = { ...params, tool_choice: 'auto' };
        return this.sendWithRetry(relaxedParams, model, autoConvertedToolName);
      }
      throw err;
    }
  }

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
          this.logger.warn(`DeepSeek complete (${status ?? 'no-status'}): ${errMsg(err)}`);
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

  private buildParams(
    input: LlmCompleteInput,
    model: string,
  ): {
    params: Record<string, unknown>;
    autoConvertedToolName?: string;
    usedForce: boolean;
  } {
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

    const isThinking = isThinkingModel(model);
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
      const canForce =
        this.cfg.ai.deepseek.forceToolChoiceEnabled &&
        !isThinking &&
        !this.forceUnsupportedModels.has(model);
      usedForce = canForce;
      params['tool_choice'] = canForce
        ? { type: 'function', function: { name: autoConvertedToolName } }
        : 'auto';
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content += `\n\nВажно: верни результат через вызов инструмента ${autoConvertedToolName}.`;
      }
    } else if (fmt) {
      const skipStrict = fmt.type === 'json_schema' && callerHasTools;
      if (skipStrict) {
        this.metrics?.incLlmThinkingModelGuard({
          kind: 'strict-stripped',
          model,
        });
        this.logger.warn(
          `DeepSeek: strict json_schema снят на ${model}; caller передал tools=${input.tools!.length} + json_schema(${fmt.name}). Оставляем только tools + tool_choice='auto'.`,
        );
      } else if (fmt.type === 'json_object') {
        params['response_format'] = { type: 'json_object' };
        ensureJsonWordInUser(messages);
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

    if (callerHasTools) {
      params['tools'] = input.tools!.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
      params['tool_choice'] = 'auto';
    }
    if (input.reasoningEffort && isThinking) {
      params['reasoning'] = { effort: input.reasoningEffort };
    }
    return { params, autoConvertedToolName, usedForce };
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
    let text = stripThinkTags(choice?.message?.content ?? '');
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
