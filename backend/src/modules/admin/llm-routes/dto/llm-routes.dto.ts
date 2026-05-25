import { z } from 'zod';

import { ALL_LLM_TASK_TYPES } from '../../../ai/services/llm-router.service';

const PROVIDER_NAMES = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
  'kie',
  'grsai',
] as const;

/**
 * Источник правды — `ALL_LLM_TASK_TYPES` из `llm-router.service.ts`. Здесь
 * кортеж переэкспортируется как readonly array и используется для runtime-валидации.
 *
 * Расширение taskType — только в одном месте: `LlmTaskType` union + `ALL_LLM_TASK_TYPES`.
 */
export const TASK_TYPES_TUPLE = ALL_LLM_TASK_TYPES;

export const PutLlmRouteSchema = z.object({
  providers: z
    .array(
      z.object({
        provider: z.enum(PROVIDER_NAMES),
        model: z.string().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(10),
  isActive: z.boolean(),
  /**
   * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 6.5 — текстовая пометка
   * о закреплении версии модели. Прокси DeepSeek версионные slug-и не
   * поддерживает, поэтому здесь — свободный текст (например «закреплено на
   * deepseek-v4-pro версии 2026-04-15; перед обновлением — прогнать golden-набор»).
   * Пустая строка / null — снять закрепление.
   */
  pinnedVersionNote: z.string().max(2000).nullable().optional(),
});

export type PutLlmRouteDto = z.infer<typeof PutLlmRouteSchema>;
