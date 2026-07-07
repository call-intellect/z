export type StringWithSuggestions<T extends string> = T | (string & Record<never, never>);

export interface LlmTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export type LlmResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      name: string;
      schema: Record<string, unknown>;
      strict: boolean;
    };

export type LlmReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type LlmUserInput = string | { text: string; cacheControl?: 'ephemeral' };

export interface LlmCompleteInput {
  system: { text: string; cacheControl?: 'ephemeral' };
  user: LlmUserInput;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: LlmTool[];
  responseFormat?: LlmResponseFormat;
  reasoningEffort?: LlmReasoningEffort;
}

export interface LlmToolCall {
  name: string;
  input: unknown;
}

export interface LlmCompleteOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  model: string;
  provider: StringWithSuggestions<
    'anthropic' | 'minimax' | 'openai-via-proxy' | 'deepseek' | 'ollama' | 'kie' | 'grsai'
  >;
  toolCalls?: LlmToolCall[];
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export class LlmFormatNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmFormatNotSupportedError';
  }
}

export class LlmInvalidOutputError extends Error {
  constructor(
    message: string,
    readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'LlmInvalidOutputError';
  }
}
