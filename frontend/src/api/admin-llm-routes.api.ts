import { z } from 'zod';

import { apiClient } from './api-client';

/**
 * API DTO для админ-роутера LLM (admin → AI Models).
 * Контракт — `backend/src/modules/admin/llm-routes/`.
 *
 * Полный список taskType — `ALL_LLM_TASK_TYPES` в backend
 * `llm-router.service.ts`. Backend Zod-схема расширена под все taskType
 * (Фаза 7 шаг 4). Здесь зеркалируем их для UI.
 *
 * GET /api/v1/admin/llm-routes возвращает «сырые» записи `LlmTaskRoute` из БД.
 * Каждая запись — это либо нормализованная (`tier` + `providerName` + `model`),
 * либо legacy (`providers` — JSON-массив `{provider, model?}`). Под одним
 * `taskType` может быть до 3 нормализованных записей (по одной на tier) ИЛИ
 * одна legacy. Группировку в UI делаем в domain-слое.
 */

export const LLM_TASK_TYPES = [
  'summary',
  'chapters',
  'tasks',
  'chat',
  'regenerate-section',
  'custom-prompt',
  'follow-up',
  'clip-title',
  'card-rollup',
  'card-chat',
  'block-ingest',
  'block-distill',
  'block-linker',
  'entity-resolver',
  'entity-merge-arbiter',
  'entity-graph-builder',
  'theme-classify',
  'reframing',
  'card-rollup-v2',
  'task-extract-v2',
  'chapter-extract-v2',
  'summary-v2',
  'chat-v2',
  'goal-alignment',
  'dashboard-summary',
] as const;
export type LlmTaskType = (typeof LLM_TASK_TYPES)[number];

export const LLM_PROVIDERS = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type LlmRouteProvider = {
  provider: LlmProvider;
  model?: string;
};

/* ─────────────────────────── Zod-схемы ─────────────────────────── */

const LlmRouteProviderSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
});

/**
 * Сырая запись `LlmTaskRoute` из БД. Все «новые» поля (`tier`, `providerName`,
 * `model`, `editedByAdmin`, ...) — опциональны, чтобы пережить legacy-записи.
 */
const LlmRouteRawSchema = z.object({
  id: z.string().optional(),
  taskType: z.string(),
  tenantId: z.string().nullable().optional(),
  tier: z.enum(['primary', 'secondary', 'tertiary']).nullable().optional(),
  providerName: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  priority: z.number().optional(),
  isActive: z.boolean(),
  editedByAdmin: z.boolean().optional(),
  requiredDataClass: z.string().nullable().optional(),
  // Legacy: массив { provider, model? }.
  providers: z.array(LlmRouteProviderSchema).optional().nullable(),
  updatedAt: z.string().optional(),
});

export const LlmRoutesListResponseSchema = z.object({
  items: z.array(LlmRouteRawSchema),
});

export type LlmRouteRawApi = z.infer<typeof LlmRouteRawSchema>;
export type LlmRoutesListApiResponse = z.infer<typeof LlmRoutesListResponseSchema>;

/* ─────────────────────────── Back-compat экспорт ─────────────────────────── */

/**
 * Старый тип, который ещё используют существующие потребители
 * (`analytics/functions/[taskType]`, `usage/functions/[taskType]`).
 * Сохраняем форму: `providers: LlmRouteProvider[]`, плюс новые опц. поля.
 */
export type LlmRouteApi = {
  taskType: string;
  providers: LlmRouteProvider[];
  isActive: boolean;
  updatedAt?: string;
  // Новые опц. поля (могут быть пустыми у legacy-записей).
  tier?: 'primary' | 'secondary' | 'tertiary' | null;
  providerName?: string | null;
  model?: string | null;
  editedByAdmin?: boolean;
  requiredDataClass?: string | null;
};

export const PutLlmRouteSchema = z.object({
  providers: z
    .array(
      z.object({
        provider: z.enum(LLM_PROVIDERS),
        model: z.string().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(10),
  isActive: z.boolean(),
});

export type PutLlmRouteRequest = z.infer<typeof PutLlmRouteSchema>;

/* ─────────────────────────── Клиент ─────────────────────────── */

export const adminLlmRoutesApi = {
  /**
   * Возвращает сырые записи `LlmTaskRoute`. Каждый taskType может встречаться
   * 1-3 раза (по tier'ам) либо в legacy-форме. Группировку делает
   * `llmRoutesUiListFromApi` в domain-слое.
   */
  async list(): Promise<LlmRoutesListApiResponse> {
    const raw = await apiClient.get<unknown>('/api/v1/admin/llm-routes');
    return LlmRoutesListResponseSchema.parse(raw);
  },

  /** PUT — выбираем primary/secondary/tertiary одной командой. */
  async upsert(
    taskType: string,
    body: PutLlmRouteRequest,
  ): Promise<LlmRouteRawApi> {
    const validated = PutLlmRouteSchema.parse(body);
    const raw = await apiClient.put<unknown>(
      `/api/v1/admin/llm-routes/${encodeURIComponent(taskType)}`,
      validated,
    );
    return LlmRouteRawSchema.parse(raw);
  },
};
