import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

import type { LlmCompleteInput, LlmCompleteOutput, LlmTool, LlmToolCall } from './llm.types';
import { LlmError } from './llm.types';
import type { LlmConnectionOverride } from './protocol-adapter/protocol-adapter.types';
import { stripThinkTags } from './think-tags.util';

@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.client = new Anthropic({
      apiKey: this.cfg.ai.anthropic.apiKey,
      ...(this.cfg.ai.anthropic.useProxy ? { baseURL: this.cfg.ai.anthropic.proxyUrl } : {}),
    });
  }

  private buildClient(override: LlmConnectionOverride): Anthropic {
    if (!override.apiKey) {
      throw new LlmError(
        'Anthropic: нет API-ключа в llm_providers — задай его в админке (ENV-фолбэк удалён)',
        500,
      );
    }
    return new Anthropic({
      apiKey: override.apiKey,
      baseURL: override.baseUrl,
    });
  }

  async complete(
    input: LlmCompleteInput,
    override?: LlmConnectionOverride,
  ): Promise<LlmCompleteOutput> {
    const model = input.model ?? this.cfg.ai.anthropic.model;
    const client = override ? this.buildClient(override) : this.client;
    try {
      return await this.completeStreaming(input, model, client);
    } catch (err) {
      const status = extractStatus(err);
      if (status === 403) {
        throw new LlmError(`Anthropic 403 (вероятно блок IP): ${errMsg(err)}`, 403, err);
      }
      this.logger.warn(
        `Anthropic streaming не удался (${status ?? 'no-status'}): ${errMsg(err)}; fallback на non-streaming`,
      );
      try {
        return await this.completeNonStreaming(input, model, client);
      } catch (err2) {
        const status2 = extractStatus(err2);
        throw new LlmError(`Anthropic non-streaming также упал: ${errMsg(err2)}`, status2, err2);
      }
    }
  }

  private async completeStreaming(
    input: LlmCompleteInput,
    model: string,
    client: Anthropic,
  ): Promise<LlmCompleteOutput> {
    const { tools, toolChoice } = buildAnthropicToolBindings(input);
    const stream = await client.messages.stream({
      model,
      max_tokens: input.maxTokens ?? 4096,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      system: buildSystemBlocks(input.system),
      messages: [{ role: 'user', content: buildUserContent(input.user) }],
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    });

    const final = await stream.finalMessage();
    return mapAnthropicResponseToOutput(final, model, 'anthropic', input.responseFormat);
  }

  private async completeNonStreaming(
    input: LlmCompleteInput,
    model: string,
    client: Anthropic,
  ): Promise<LlmCompleteOutput> {
    const { tools, toolChoice } = buildAnthropicToolBindings(input);
    const message = await client.messages.create({
      model,
      max_tokens: input.maxTokens ?? 4096,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      system: buildSystemBlocks(input.system),
      messages: [{ role: 'user', content: buildUserContent(input.user) }],
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      stream: false,
    });
    return mapAnthropicResponseToOutput(message, model, 'anthropic', input.responseFormat);
  }
}

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

export function buildUserContent(
  user: LlmCompleteInput['user'],
): string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
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

export const ANTHROPIC_JSON_SCHEMA_TOOL_NAME = 'json_response';

export function buildAnthropicToolBindings(input: LlmCompleteInput): {
  tools?: LlmTool[];
  toolChoice?: { type: 'tool'; name: string } | { type: 'auto' };
} {
  const fmt = input.responseFormat;
  if (fmt && fmt.type === 'json_schema') {
    const syntheticTool: LlmTool = {
      name: ANTHROPIC_JSON_SCHEMA_TOOL_NAME,
      description: `Возвращает структурированный JSON-ответ согласно схеме (${fmt.name}). Используй ТОЛЬКО этот инструмент для ответа.`,
      input_schema: normalizeAnthropicInputSchema(fmt.schema),
    };
    const extraTools = input.tools ?? [];
    return {
      tools: [syntheticTool, ...extraTools],
      toolChoice: { type: 'tool', name: ANTHROPIC_JSON_SCHEMA_TOOL_NAME },
    };
  }
  if (input.tools && input.tools.length > 0) {
    return { tools: input.tools };
  }
  return {};
}

function normalizeAnthropicInputSchema(schema: Record<string, unknown>): {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
} {
  const cleaned: Record<string, unknown> = { ...schema };
  delete cleaned['$schema'];
  delete cleaned['$id'];

  if (cleaned['type'] === 'object') {
    return {
      type: 'object',
      properties: (cleaned['properties'] as Record<string, unknown>) ?? {},
      ...(Array.isArray(cleaned['required']) ? { required: cleaned['required'] as string[] } : {}),
      additionalProperties:
        typeof cleaned['additionalProperties'] === 'boolean'
          ? (cleaned['additionalProperties'] as boolean)
          : false,
    };
  }
  return {
    type: 'object',
    properties: { result: cleaned },
    required: ['result'],
    additionalProperties: false,
  };
}

export function mapAnthropicResponseToOutput(
  message: Anthropic.Message,
  model: string,
  provider: LlmCompleteOutput['provider'],
  responseFormat?: LlmCompleteInput['responseFormat'],
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

  if (responseFormat?.type === 'json_schema' && text.length === 0 && toolCalls.length > 0) {
    const jsonCall = toolCalls.find((tc) => tc.name === ANTHROPIC_JSON_SCHEMA_TOOL_NAME);
    if (jsonCall) {
      const rootIsObject =
        typeof responseFormat.schema['type'] === 'string' &&
        responseFormat.schema['type'] === 'object';
      const payload = rootIsObject
        ? jsonCall.input
        : ((jsonCall.input as { result?: unknown })?.result ?? jsonCall.input);
      text = JSON.stringify(payload);
    }
  }
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
    text: stripThinkTags(text),
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
