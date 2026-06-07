/**
 * Общий контракт LLM-клиента: Anthropic / MiniMax (Anthropic-compat) /
 * OpenAI-via-Proxy / DeepSeek / Ollama. Каждый имплементирует `complete(input)`
 * с одной и той же семантикой — это упрощает fallback-цепочку и подмену
 * в тестах.
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

/**
 * Формат ответа модели.
 *  - `text` — обычный текст (default).
 *  - `json_object` — модель обязана вернуть валидный JSON; схема не проверяется.
 *  - `json_schema` — strict JSON Schema. Поддерживается OpenAI Responses API.
 *    DeepSeek-V4 его НЕ поддерживает (probe 2026-06-03: 400 «This response_format
 *    type is unavailable now», даже flash) — `deepseek.service.ts` для DeepSeek
 *    прозрачно конвертирует json_schema в tool-путь (tools + tool_choice='auto').
 *    Если провайдер не умеет вообще — бросает `LlmFormatNotSupportedError`.
 */
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

/**
 * Пользовательское сообщение. Поддерживает два формата:
 *   - `string` — обычный текст (legacy/default).
 *   - `{ text, cacheControl?: 'ephemeral' }` — оборачиваем в content-блок и
 *     просим провайдера кэшировать (Anthropic / MiniMax). Для остальных
 *     провайдеров `cacheControl` молча игнорируется (см. T7-F3 prompt caching).
 *
 * Когда оборачивать в `cacheControl: 'ephemeral'`:
 *   - Транскрипты, retrieval pool, knowledge-блоки > ~1000 символов.
 *   - Стабильная часть user-сообщения, повторяющаяся между вызовами
 *     (например, тот же транскрипт через retry).
 *
 * Когда НЕ оборачивать:
 *   - Короткие пользовательские вопросы / запросы (< 500 символов).
 *   - Уникальный per-request input — кеш всё равно промахнётся.
 */
export type LlmUserInput =
  | string
  | { text: string; cacheControl?: 'ephemeral' };

export interface LlmCompleteInput {
  system: { text: string; cacheControl?: 'ephemeral' };
  user: LlmUserInput;
  /** Если не задан — клиент использует свой default из `cfg.*.model`. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: LlmTool[];
  /** Структурированный вывод. По умолчанию `text`. */
  responseFormat?: LlmResponseFormat;
  /**
   * Усилия модели на reasoning. Релевантно gpt-5* и deepseek-v4-pro.
   * Для моделей без reasoning адаптер игнорирует.
   */
  reasoningEffort?: LlmReasoningEffort;
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
  /**
   * Сколько входных токенов попало в prompt cache (cache hit / cache_read).
   * 0 если провайдер не сообщает или модель не кэшировалась.
   */
  cachedTokens?: number;
  /**
   * Сколько токенов записано в кеш этим вызовом (cache write / cache_creation).
   * Релевантно только Anthropic-семейству (Anthropic / MiniMax — anthropic-compat).
   * Остальные провайдеры не различают create/read.
   */
  cacheCreationTokens?: number;
  model: string;
  provider:
    | 'anthropic'
    | 'minimax'
    | 'openai-via-proxy'
    | 'deepseek'
    | 'ollama'
    | 'kie'
    | 'grsai';
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

/**
 * Провайдер не поддерживает запрошенный формат ответа (например, Ollama
 * не умеет json_schema strict). LlmRouter трактует это как retriable —
 * переходит на следующего провайдера в цепочке.
 */
export class LlmFormatNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmFormatNotSupportedError';
  }
}

/**
 * Вывод провайдера не прошёл caller-`validate` (например, не распарсился как
 * JSON-вердикт block-linker/entity-graph). LlmRouter трактует как retriable →
 * переключение на следующего провайдера (secondary с настоящим strict).
 */
export class LlmInvalidOutputError extends Error {
  constructor(message: string, readonly rawOutput: string) {
    super(message);
    this.name = 'LlmInvalidOutputError';
  }
}
