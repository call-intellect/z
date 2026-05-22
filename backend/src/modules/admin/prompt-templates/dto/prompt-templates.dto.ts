/**
 * Фаза A.2 — DTO для `/admin/prompt-templates`. Все схемы валидируются через
 * `nestjs-zod` + `ZodValidationPipe`. Используются для всех 10 эндпоинтов
 * (см. ТЗ A §7.1, §7.4).
 *
 * Валидаторы из ТЗ §7.4:
 *   - name: 3..120
 *   - description: 0..1000
 *   - sections.length: 0..30
 *   - section.instruction: 10..4000
 *   - notes: 0..2000
 *   - Сумма maxTokens всех разделов ≤ 16000 (риск §15) — проверяется в сервисе.
 */

import { z } from 'zod';

// MeetingType из Prisma — отражаем как enum строк, чтобы Zod-валидация
// работала без зависимости от @prisma/client (контракт стабильный).
export const MEETING_TYPES = [
  'team',
  'standup',
  'plan_fact',
  'project',
  'sales',
  'custdev',
  'partner',
  'interview',
  'customer_success',
  'review',
  'retrospective',
] as const;
export type MeetingTypeValue = (typeof MEETING_TYPES)[number];

/** taskType — legacy ключи LLM-задач (см. ТЗ A §4.1, §6). */
export const TASK_TYPES = [
  'summary',
  'tasks',
  'chapters',
  'follow-up',
  'card-rollup',
] as const;
export type TaskTypeValue = (typeof TASK_TYPES)[number];

export const SCOPES = ['system', 'org'] as const;
export type ScopeValue = (typeof SCOPES)[number];

export const STATUSES = ['draft', 'active', 'archived'] as const;
export type StatusValue = (typeof STATUSES)[number];

export const OUTPUT_TYPES = ['text', 'bullet_list', 'table', 'json_object'] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

/** DEMO_MEETING_KEYS — фикстуры в `backend/test-fixtures/demo-meetings/`. */
export const DEMO_MEETING_KEYS = ['demo-sales', 'demo-standup', 'demo-interview'] as const;
export type DemoMeetingKey = (typeof DEMO_MEETING_KEYS)[number];

// ─── Запросы списка / детализации ───────────────────────────────────────

export const ListPromptTemplatesQuerySchema = z.object({
  scope: z.enum(SCOPES).optional(),
  status: z.enum(STATUSES).optional(),
  meetingType: z.enum(MEETING_TYPES).optional(),
  taskType: z.enum(TASK_TYPES).optional(),
  search: z.string().min(1).max(120).optional(),
});
export type ListPromptTemplatesQueryDto = z.infer<typeof ListPromptTemplatesQuerySchema>;

// ─── Секции ─────────────────────────────────────────────────────────────

export const SectionInputSchema = z.object({
  /** Slug секции — должен совпадать с key в outputSchema.properties. */
  key: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/i, {
    message: 'Допустимы только латиница, цифры, дефис и подчёркивание',
  }),
  title: z.string().min(1).max(160),
  instruction: z.string().min(10).max(4000),
  outputType: z.enum(OUTPUT_TYPES),
  required: z.boolean().default(true),
  maxTokens: z.number().int().min(1).max(8000).nullable().optional(),
  /** Порядковый номер 1..30 (если не задан — назначается в сервисе по индексу). */
  order: z.number().int().min(1).max(30).optional(),
});
export type SectionInputDto = z.infer<typeof SectionInputSchema>;

// ─── Создание шаблона ───────────────────────────────────────────────────

export const CreatePromptTemplateSchema = z.object({
  scope: z.enum(SCOPES).default('system'),
  /** Для scope='org' — обязателен. Для scope='system' — игнорируется. */
  orgId: z.string().min(1).max(60).nullable().optional(),
  /** Slug шаблона. Уникален в рамках (orgId, key). */
  key: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9_-]+$/i, {
      message: 'Допустимы только латиница, цифры, дефис и подчёркивание',
    }),
  name: z.string().min(3).max(120),
  description: z.string().max(1000).nullable().optional(),
  meetingType: z.enum(MEETING_TYPES).nullable().optional(),
  taskType: z.enum(TASK_TYPES),
  /** Опционально — первая версия. Если не передана, шаблон без version'ов (draft, нельзя активировать). */
  systemPrompt: z.string().min(10).max(40000).optional(),
  toolName: z.string().min(1).max(120).nullable().optional(),
  sections: z.array(SectionInputSchema).min(0).max(30).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type CreatePromptTemplateDto = z.infer<typeof CreatePromptTemplateSchema>;

// ─── PATCH метаданных шаблона ───────────────────────────────────────────

export const UpdatePromptTemplateSchema = z.object({
  name: z.string().min(3).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  meetingType: z.enum(MEETING_TYPES).nullable().optional(),
  taskType: z.enum(TASK_TYPES).optional(),
});
export type UpdatePromptTemplateDto = z.infer<typeof UpdatePromptTemplateSchema>;

// ─── Создание новой версии ──────────────────────────────────────────────

export const CreatePromptVersionSchema = z.object({
  systemPrompt: z.string().min(10).max(40000),
  toolName: z.string().min(1).max(120).nullable().optional(),
  sections: z.array(SectionInputSchema).min(0).max(30),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** Если true — сразу делаем эту версию активной (status шаблона → active). */
  activate: z.boolean().default(false),
});
export type CreatePromptVersionDto = z.infer<typeof CreatePromptVersionSchema>;

// ─── Копирование в Org ──────────────────────────────────────────────────

export const CopyToOrgSchema = z.object({
  orgId: z.string().min(1).max(60),
  /** Опциональное переопределение key (иначе key = <originalKey>-copy). */
  key: z.string().min(3).max(80).optional(),
  /** Опциональное переопределение name. */
  name: z.string().min(3).max(120).optional(),
});
export type CopyToOrgDto = z.infer<typeof CopyToOrgSchema>;

// ─── Preview ────────────────────────────────────────────────────────────

export const PreviewPromptSchema = z.object({
  demoMeetingKey: z.enum(DEMO_MEETING_KEYS),
  /**
   * Опционально — id версии, которую нужно протестировать. Если не задан —
   * берём `activeVersionId`; если и его нет — последнюю созданную (draft).
   */
  versionId: z.string().min(1).max(60).optional(),
});
export type PreviewPromptDto = z.infer<typeof PreviewPromptSchema>;
