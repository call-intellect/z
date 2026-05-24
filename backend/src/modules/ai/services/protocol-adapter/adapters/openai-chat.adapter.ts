import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

import type {
  LlmCompleteInput,
  LlmCompleteOutput,
} from '../../llm.types';
import { LlmError } from '../../llm.types';
import type {
  LlmProtocolAdapter,
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from '../protocol-adapter.types';

import { TypedConfigService } from '../../../../../common/config/index';

/**
 * SBA α-10 wave 3 — OpenAI Chat Completions API адаптер.
 *
 * Используется провайдерами: deepseek (deepseek-chat / deepseek-v4-flash),
 * любая internal-модель совместимая с OpenAI v1/chat/completions.
 *
 * Особенности:
 *   - Path: POST {baseUrl}/chat/completions.
 *   - Authorization: Bearer <apiKey>.
 *   - JSON Schema strict — пробрасываем через `response_format`.
 *   - Reasoning effort — не поддерживается (молчком игнорируем).
 */
@Injectable()
export class OpenAiChatProtocolAdapter implements LlmProtocolAdapter {
  readonly protocolKind: ProtocolKind = 'openai-chat';
  private readonly logger = new Logger(OpenAiChatProtocolAdapter.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput> {
    const { provider, input } = args;
    const apiKey = provider.apiKey ?? '';
    if (!apiKey) {
      throw new LlmError(
        `openai-chat: provider=${provider.name} требует apiKey`,
        500,
      );
    }
    const client = new OpenAI({
      baseURL: provider.baseUrl,
      apiKey,
      defaultHeaders: provider.defaultHeaders,
    });
    const model = input.model ?? provider.defaultModel ?? 'gpt-4o-mini';

    // T7-F3: LlmUserInput может быть string или {text, cacheControl?}.
    // OpenAI-chat compat не имеет Anthropic-style cache_control; распаковываем.
    const userText = typeof input.user === 'string' ? input.user : input.user.text;
    const body: Record<string, unknown> = {
      model,
      stream: false,
      messages: [
        { role: 'system', content: input.system.text },
        { role: 'user', content: userText },
      ],
    };
    if (input.maxTokens !== undefined) body['max_tokens'] = input.maxTokens;
    if (input.temperature !== undefined) body['temperature'] = input.temperature;
    if (input.responseFormat) {
      if (input.responseFormat.type === 'json_object') {
        body['response_format'] = { type: 'json_object' };
      } else if (input.responseFormat.type === 'json_schema') {
        body['response_format'] = {
          type: 'json_schema',
          json_schema: {
            name: input.responseFormat.name,
            strict: input.responseFormat.strict,
            schema: input.responseFormat.schema,
          },
        };
      }
    }

    try {
      const resp = (await (
        client as unknown as {
          chat: {
            completions: {
              create: (
                p: Record<string, unknown>,
              ) => Promise<{
                choices?: Array<{
                  message?: { content?: string };
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
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      const text = resp.choices?.[0]?.message?.content ?? '';
      const usage = resp.usage ?? {};
      return {
        text,
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        model,
        provider: this.normalizeProviderName(provider.name),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number } | undefined)?.status;
      throw new LlmError(`openai-chat ${provider.name}: ${message}`, status, err);
    }
  }

  /**
   * Маппинг slug провайдера на enum LlmCompleteOutput.provider — нужно для
   * AiUsageLogService.AiProvider (типизированный union). Если slug нестандартный
   * — fallback на 'deepseek' (наиболее частый openai-chat consumer).
   */
  private normalizeProviderName(
    slug: string,
  ): LlmCompleteOutput['provider'] {
    switch (slug) {
      case 'anthropic':
      case 'minimax':
      case 'openai-via-proxy':
      case 'deepseek':
      case 'ollama':
        return slug;
      default:
        return 'deepseek';
    }
  }
}
