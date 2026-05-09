/**
 * Общий контракт LLM-клиента: Anthropic / MiniMax (Anthropic-compat) /
 * OpenAI-via-Proxy. Каждый имплементирует `complete(input)` с одной и той же
 * семантикой — это упрощает fallback-цепочку и подмену в тестах.
 *
 * В отличие от прямой `Messages API` Anthropic'а — здесь нет «messages[]»,
 * только `system + user`. AI-pipeline никогда не ведёт многоходовых диалогов:
 * один проход system + полный диалог-транскрипт в user → ответ.
 */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema для аргументов tool'а. */
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface LlmCompleteInput {
  system: { text: string; cacheControl?: 'ephemeral' };
  user: string;
  /** Если не задан — клиент использует свой default из `cfg.*.model`. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: LlmTool[];
}

export interface LlmToolCall {
  name: string;
  input: unknown;
}

export interface LlmCompleteOutput {
  /** Текстовая часть ответа. Может быть пустой строкой, если был tool_use. */
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: 'anthropic' | 'minimax' | 'openai-via-proxy';
  toolCalls?: LlmToolCall[];
}

/**
 * Доменная ошибка LLM. `httpStatus` помогает каскаду fallback'а решить,
 * стоит ли пробовать следующего провайдера.
 */
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
