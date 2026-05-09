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
 * OpenAI Responses API через `proxy.agent-lia.ru`.
 * Используется как последний fallback, если Anthropic и MiniMax недоступны.
 *
 * Особенности (см. `c:\work\z\llm-models-playbook.md` §5):
 *   - baseURL: `cfg.ai.proxy.baseUrl`
 *   - Authorization: `Bearer <prefix>:<OPENAI_API_KEY>`
 *   - reasoning-модели (`gpt-5*`) — без `temperature`, c `reasoning.effort`.
 *   - Tools идут как `tools: [{ type: 'function', name, parameters, strict }]`.
 *
 * Tool_use вызовы возвращаются как `output[].type === 'function_call'`.
 */
@Injectable()
export class OpenAiProxyService {
  private readonly logger = new Logger(OpenAiProxyService.name);
  private readonly client: OpenAI;
  private readonly defaultModel = 'gpt-5-mini';

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.client = new OpenAI({
      baseURL: this.cfg.ai.proxy.baseUrl,
      apiKey: `${this.cfg.ai.proxy.prefix}:${this.cfg.ai.openai.apiKey}`,
    });
  }

  async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
    const model = input.model ?? this.defaultModel;
    const isReasoning = model.startsWith('gpt-5');

    type ResponseTool = {
      type: 'function';
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      strict?: boolean;
    };
    const params: Record<string, unknown> = {
      model,
      stream: false,
      instructions: input.system.text,
      input: [{ role: 'user', content: input.user }],
    };
    if (input.maxTokens !== undefined) {
      params['max_output_tokens'] = input.maxTokens;
    }
    if (isReasoning) {
      params['reasoning'] = { effort: 'medium' };
    } else if (input.temperature !== undefined) {
      params['temperature'] = input.temperature;
    }
    if (input.tools && input.tools.length > 0) {
      const tools: ResponseTool[] = input.tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.input_schema as unknown as Record<string, unknown>,
        strict: false,
      }));
      params['tools'] = tools;
    }

    try {
      // SDK напрямую с params типизирован narrowly; используем generic responses.create.
      const response = (await (
        this.client as unknown as {
          responses: {
            create: (
              p: Record<string, unknown>,
            ) => Promise<{
              output_text?: string;
              output?: Array<Record<string, unknown>>;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
              };
            }>;
          };
        }
      ).responses.create(params)) as {
        output_text?: string;
        output?: Array<Record<string, unknown>>;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };

      const toolCalls: LlmToolCall[] = [];
      const outputArr = Array.isArray(response.output) ? response.output : [];
      for (const item of outputArr) {
        if (item['type'] === 'function_call') {
          const name = typeof item['name'] === 'string' ? item['name'] : '';
          const argsRaw = item['arguments'];
          let parsed: unknown = {};
          if (typeof argsRaw === 'string') {
            try {
              parsed = JSON.parse(argsRaw);
            } catch {
              parsed = { raw: argsRaw };
            }
          } else {
            parsed = argsRaw ?? {};
          }
          if (name) toolCalls.push({ name, input: parsed });
        }
      }

      return {
        text: response.output_text ?? '',
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        model,
        provider: 'openai-via-proxy',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (err) {
      const status = extractStatus(err);
      this.logger.warn(
        `OpenAI-via-proxy complete (${status ?? 'no-status'}): ${errMsg(err)}`,
      );
      throw new LlmError(`OpenAI-via-proxy: ${errMsg(err)}`, status, err);
    }
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
