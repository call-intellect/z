/**
 * SBA α-10 wave 3 — LlmProtocolAdapterRegistry.
 *
 * Contract for protocol-specific LLM adapters. Каждый адаптер обслуживает
 * один `protocolKind` из реестра LlmProvider:
 *   - 'openai-chat'         — OpenAI Chat Completions API (deepseek-compatible)
 *   - 'openai-responses'    — OpenAI Responses API (через proxy.agent-lia.ru)
 *   - 'anthropic-messages'  — Anthropic Messages API (нативный и/или через прокси)
 *   - 'ollama-native'       — Ollama /api/generate (нет prompt caching)
 *   - 'custom-http'         — generic HTTP — для будущих внутренних/корп. моделей
 *
 * Адаптер инкапсулирует ВСЁ, что специфично для протокола:
 *   - формирование тела запроса (включая reasoning effort / json schema),
 *   - аутентификация (Authorization header),
 *   - парсинг ответа (output_text / message.content / output[]…),
 *   - обработка ошибок и нормализация в `LlmError`.
 *
 * Адаптер НЕ занимается:
 *   - маршрутизацией по taskType (это LlmRouterService),
 *   - подсчётом стоимости (LlmRouter.computeCostUsd),
 *   - метриками (LlmRouter + AiUsageLogService),
 *   - fallback-цепочкой (LlmRouter).
 *
 * Registry собирает все адаптеры в DI и резолвит по `protocolKind`. См.
 * `LlmProtocolAdapterRegistry`.
 *
 * Feature-flag `USE_PROTOCOL_ADAPTER_REGISTRY` контролирует переключение со
 * старого `switch(provider)` на новый registry — default false (production
 * safety, см. ТЗ §3.5 и §17 о mitigation).
 */

import type {
  LlmCompleteInput,
  LlmCompleteOutput,
} from '../llm.types';

/** Имя протокола, как оно хранится в LlmProvider.protocolKind. */
export type ProtocolKind =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'ollama-native'
  | 'custom-http';

/**
 * Описание провайдера, передаваемое адаптеру. Достаточно для построения
 * запроса; никаких прямых обращений к Prisma из адаптеров — они должны быть
 * протокол-чистыми (тестируемые юнитами без БД).
 */
export interface ProtocolAdapterProviderInfo {
  /** Slug провайдера, например 'deepseek' / 'openai-via-proxy' / 'ollama'. */
  name: string;
  /** Базовый URL API (с учётом возможного proxy). */
  baseUrl: string;
  /** API-ключ в открытом виде. NULL/'' для self-hosted моделей (Ollama). */
  apiKey: string | null;
  /** Дополнительные заголовки (например, Anthropic-Version). */
  defaultHeaders?: Record<string, string>;
  /** Имя модели по умолчанию, если caller не передал `input.model`. */
  defaultModel?: string;
  /**
   * Префикс для Authorization (используется OpenAI Responses через прокси,
   * где Bearer выглядит как `<prefix>:<apiKey>`).
   */
  authPrefix?: string;
}

export interface LlmProtocolAdapter {
  /** Имя протокола, которое адаптер обслуживает. */
  readonly protocolKind: ProtocolKind;
  /**
   * Сделать LLM-вызов через заданного провайдера. Адаптер сам разбирает
   * input.responseFormat / reasoningEffort и преобразует под свой протокол.
   * При нерекаверебельной ошибке — кидает `LlmError`.
   */
  complete(args: {
    provider: ProtocolAdapterProviderInfo;
    input: LlmCompleteInput;
  }): Promise<LlmCompleteOutput>;
}

/**
 * Метаданные регистрации адаптера через @ProtocolAdapter('openai-chat') —
 * сейчас используем NestJS DI напрямую (constructor injection в registry),
 * без декоратора. Декоратор оставлен только как тип-хелпер для будущих
 * dynamic-providers.
 */
export const PROTOCOL_ADAPTER_TOKEN = Symbol.for('LlmProtocolAdapter');
