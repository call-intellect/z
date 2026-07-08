import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import OpenAI from 'openai';

import { TypedConfigService } from '../../../../../common/config/index';
import { BusinessMetricsService } from '../../../../../common/metrics/business-metrics.service';
import { ensureJsonWordInUser } from '../../json-mode.util';
import { isThinkingModel } from '../../llm-thinking-models';
import type { LlmCompleteInput, LlmCompleteOutput, LlmToolCall } from '../../llm.types';
import { LlmError } from '../../llm.types';
import { toOpenAiStrictSchema } from '../../strict-json-schema.util';
import { stripThinkTags } from '../../think-tags.util';
import type {
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

@Injectable()
export class OpenAiChatProtocolAdapter implements LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind = 'openai-chat';
  private readonly logger = new Logger(OpenAiChatProtocolAdapter.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput> {
    const { provider, input } = args;
    const apiKey = provider.apiKey ?? '';
    if (!apiKey) {
      throw new LlmError(`openai-chat: provider=${provider.name} требует apiKey`, 500);
    }
    const client = new OpenAI({
      baseURL: provider.baseUrl,
      apiKey,
      defaultHeaders: provider.defaultHeaders,
      timeout: provider.timeoutMs ?? undefined,
    });
    const model = input.model ?? provider.defaultModelKey ?? provider.defaultModel ?? 'gpt-4o-mini';

    const userText = typeof input.user === 'string' ? input.user : input.user.text;
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: input.system.text },
      { role: 'user', content: userText },
    ];
    const body: Record<string, unknown> = {
      model,
      stream: false,
      messages,
    };
    if (input.maxTokens !== undefined) body['max_tokens'] = input.maxTokens;
    if (input.temperature !== undefined) body['temperature'] = input.temperature;

    const isThinking = isThinkingModel(model);
    const needsToolMode = isThinking || model.toLowerCase().includes('deepseek-v4-flash');
    const callerHasTools = !!(input.tools && input.tools.length > 0);
    const fmt = input.responseFormat;
    const autoConvert = needsToolMode && fmt?.type === 'json_schema' && !callerHasTools;

    let autoConvertedToolName: string | undefined;

    if (autoConvert && fmt?.type === 'json_schema') {
      autoConvertedToolName = `submit_${fmt.name}`;
      body['tools'] = [
        {
          type: 'function',
          function: {
            name: autoConvertedToolName,
            description: `Отдать структурированный результат по схеме ${fmt.name}.`,
            parameters: fmt.schema,
          },
        },
      ];
      body['tool_choice'] = 'auto';
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content += `\n\nВажно: верни результат через вызов инструмента ${autoConvertedToolName}.`;
      }
      this.metrics?.incLlmThinkingModelGuard({ kind: 'schema-to-tool', model });
      this.logger.debug(
        `openai-chat thinking: автоконвертация json_schema → tool model=${model} schemaName=${fmt.name}`,
      );
    } else if (fmt) {
      const skipStrictOnThinking = needsToolMode && fmt.type === 'json_schema' && callerHasTools;
      if (skipStrictOnThinking) {
        this.metrics?.incLlmThinkingModelGuard({
          kind: 'strict-stripped',
          model,
        });
        this.logger.warn(
          `openai-chat thinking: strict json_schema снят на ${model}; caller передал tools + json_schema(${fmt.name}). Оставляем только tools + tool_choice='auto'.`,
        );
      } else if (fmt.type === 'json_object') {
        body['response_format'] = { type: 'json_object' };
        ensureJsonWordInUser(messages);
      } else if (fmt.type === 'json_schema') {
        body['response_format'] = {
          type: 'json_schema',
          json_schema: {
            name: fmt.name,
            strict: fmt.strict,
            schema: fmt.strict ? toOpenAiStrictSchema(fmt.schema) : fmt.schema,
          },
        };
      }
    }

    if (callerHasTools) {
      body['tools'] = input.tools!.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
      body['tool_choice'] = 'auto';
    }

    try {
      const resp = (await (
        client as unknown as {
          chat: {
            completions: {
              create: (p: Record<string, unknown>) => Promise<{
                choices?: Array<{
                  message?: {
                    content?: string | null;
                    reasoning_content?: string | null;
                    tool_calls?: Array<{
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                }>;
                usage?: {
                  prompt_tokens?: number;
                  completion_tokens?: number;
                  prompt_tokens_details?: { cached_tokens?: number };
                };
              }>;
            };
          };
        }
      ).chat.completions.create(body)) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      const choice = resp.choices?.[0];
      const rawContent = choice?.message?.content ?? '';
      const reasoning = choice?.message?.reasoning_content ?? '';
      const combined = rawContent.trim().length > 0 ? rawContent : reasoning;
      let text = stripThinkTags(combined);
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
      if (autoConvertedToolName && !text) {
        const autoTc = toolCalls.find((tc) => tc.name === autoConvertedToolName);
        if (autoTc) {
          text = JSON.stringify(autoTc.input);
        }
      }
      const usage = resp.usage ?? {};
      return {
        text,
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        model,
        provider: this.normalizeProviderName(provider.name),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number } | undefined)?.status;
      throw new LlmError(`openai-chat ${provider.name}: ${message}`, status, err);
    }
  }

  private normalizeProviderName(slug: string): LlmCompleteOutput['provider'] {
    return slug;
  }
}
