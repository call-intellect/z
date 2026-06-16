import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

import { TypedConfigService } from '../../../common/config/index';

import { appendJsonWordToUser } from './json-mode.util';
import type { LlmCompleteInput, LlmCompleteOutput, LlmToolCall } from './llm.types';
import { LlmError } from './llm.types';
import { toOpenAiStrictSchema } from './strict-json-schema.util';

export function ensureJsonHint(instructions: string): string {
  if (/json/i.test(instructions)) return instructions;
  return `${instructions}\n\nВажно: верни ответ строго в виде валидного JSON.`;
}

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
    const rawUserText = typeof input.user === 'string' ? input.user : input.user.text;
    const jsonMode =
      input.responseFormat?.type === 'json_object' || input.responseFormat?.type === 'json_schema';
    const userText = jsonMode ? appendJsonWordToUser(input.system.text, rawUserText) : rawUserText;
    const params: Record<string, unknown> = {
      model,
      stream: false,
      instructions: input.system.text,
      input: [{ role: 'user', content: userText }],
    };
    if (input.maxTokens !== undefined) {
      params['max_output_tokens'] = Math.max(16, input.maxTokens);
    }
    if (isReasoning) {
      const effort = input.reasoningEffort ?? 'medium';
      params['reasoning'] = { effort };
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
    const fmt = input.responseFormat;
    if (fmt) {
      if (fmt.type === 'json_object') {
        params['text'] = { format: { type: 'json_object' } };
      } else if (fmt.type === 'json_schema') {
        params['text'] = {
          format: {
            type: 'json_schema',
            name: fmt.name,
            strict: fmt.strict,
            schema: fmt.strict ? toOpenAiStrictSchema(fmt.schema) : fmt.schema,
          },
        };
      }
    }

    try {
      const response = (await (
        this.client as unknown as {
          responses: {
            create: (p: Record<string, unknown>) => Promise<{
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
          input_tokens_details?: { cached_tokens?: number };
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
        cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        model,
        provider: 'openai-via-proxy',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (err) {
      const status = extractStatus(err);
      this.logger.warn(`OpenAI-via-proxy complete (${status ?? 'no-status'}): ${errMsg(err)}`);
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
