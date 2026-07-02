import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

import { TypedConfigService } from '../../../common/config/index';

import { ensureJsonWordInUser } from './json-mode.util';
import type { LlmCompleteInput, LlmCompleteOutput, LlmToolCall } from './llm.types';
import { LlmError } from './llm.types';
import type { LlmConnectionOverride } from './protocol-adapter/protocol-adapter.types';

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly client: OpenAI;
  private readonly defaultModel = 'qwen3:30b-a3b-instruct-2507';
  private readonly retryDelaysMs = [500, 1000, 2000];

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    const apiKey = this.cfg.ai.ollama.apiKey || 'no-key';
    this.client = new OpenAI({
      baseURL: this.cfg.ai.ollama.baseUrl,
      apiKey,
    });
  }

  private buildClient(override: LlmConnectionOverride): OpenAI {
    return new OpenAI({
      baseURL: override.baseUrl,
      apiKey: override.apiKey || 'no-key',
    });
  }

  async complete(
    input: LlmCompleteInput,
    override?: LlmConnectionOverride,
  ): Promise<LlmCompleteOutput> {
    const model = input.model ?? this.defaultModel;
    const client = override ? this.buildClient(override) : this.client;

    if (input.responseFormat?.type === 'json_schema') {
      this.logger.debug(
        `Ollama: json_schema → json_object downgrade (модель=${model}, schema=${input.responseFormat.name})`,
      );
    }

    const params = this.buildParams(input, model);

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      try {
        const response = await client.chat.completions.create(
          params as unknown as Parameters<typeof client.chat.completions.create>[0],
        );
        return this.mapResponse(response, model);
      } catch (err) {
        lastErr = err;
        const status = extractStatus(err);
        const isRetriable = status === 429 || (status !== undefined && status >= 500);
        if (!isRetriable || attempt === this.retryDelaysMs.length) {
          this.logger.warn(`Ollama complete (${status ?? 'no-status'}): ${errMsg(err)}`);
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

  private buildParams(input: LlmCompleteInput, model: string): Record<string, unknown> {
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
    const fmtType = input.responseFormat?.type;
    if (fmtType === 'json_object' || fmtType === 'json_schema') {
      params['response_format'] = { type: 'json_object' };
      const messages = params['messages'] as Array<{
        role: string;
        content: string;
      }>;
      ensureJsonWordInUser(messages);
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
