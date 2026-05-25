import { z } from 'zod';

import { type DialogTurn } from './common';
import { buildTasksPromptUnified, buildTasksSchemaUnified } from './tasks-unified';

/**
 * Промпт для извлечения action items с расширенными полями (для модели `Task`):
 * привязка к фрагменту разговора (sourceStartMs/EndMs), цитата (sourceQuote),
 * confidence-оценка.
 *
 * Это НЕ замена `prompts/tasks.ts` (там legacy-формат для AiResult.tasks).
 * Здесь — формат для AI-pipeline фазы M3 (модели `Task` + `MeetingHighlight`).
 *
 * F5 (ТЗ 2026-05-24): builder теперь — тонкая обёртка над
 * `buildTasksPromptUnified` (единый источник правды). Сохраняем экспорты
 * `TaskExtractedSchema`/`TasksExtractedArraySchema` для caller'ов
 * (`TaskExtractionService` парсит ответ через них).
 */
export const TASKS_STRUCTURED_TASK_TYPE = 'tasks';
export const TASKS_STRUCTURED_PROMPT_NAME = 'tasks_structured_v1';

/**
 * Zod-схема одной извлечённой задачи в structured-формате.
 * Контракт совпадает с моделью `Task` (`backend/prisma/schema.prisma`).
 */
export const TaskExtractedSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(2000).nullable().optional(),
    assigneeRaw: z.string().max(200).nullable().optional(),
    dueDate: z.string().max(40).nullable().optional(),
    sourceStartMs: z.number().int().nonnegative(),
    sourceEndMs: z.number().int().nonnegative(),
    sourceQuote: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type TaskExtracted = z.infer<typeof TaskExtractedSchema>;

export const TasksExtractedArraySchema = z.array(TaskExtractedSchema);

/**
 * T7-F6: wrapper-схема `{ tasks: [...] }` для strict JSON Schema.
 * Root JSON Schema требует object на верхнем уровне (DeepSeek strict,
 * OpenAI strict, Anthropic tool_use). Голый массив больше не используем —
 * caller (`TaskExtractionService`) гибко принимает оба варианта.
 */
export const TasksStructuredResponseSchema = z
  .object({ tasks: TasksExtractedArraySchema })
  .strict();

/**
 * T7-F6: builder опций для unified-tasks, выровненный со structured-путём.
 * Используется и `buildTasksStructuredPrompt`, и `TaskExtractionService`
 * (последний достаёт JSON Schema через `buildTasksSchemaUnified(opts)`
 * → `z.toJSONSchema`).
 */
export const TASKS_STRUCTURED_OPTIONS = {
  enriched: false,
  useAssigneeRaw: true,
  withFragmentBounds: true,
  withSourceQuote: true,
  withConfidence: true,
} as const;

/**
 * T7-F6: JSON Schema для `responseFormat: { type: 'json_schema', strict: true }`.
 * Собирается через `buildTasksSchemaUnified` → `z.toJSONSchema` (zod v4
 * имеет встроенный конвертер, внешний `zod-to-json-schema` не нужен).
 */
export const TASKS_STRUCTURED_JSON_SCHEMA = z.toJSONSchema(
  buildTasksSchemaUnified({ ...TASKS_STRUCTURED_OPTIONS }),
  { target: 'draft-7' },
) as Record<string, unknown>;

export interface TasksStructuredPromptInput {
  meeting: { id: string; type: string; title: string };
  dialog: DialogTurn[];
}

/**
 * Legacy builder для `TaskExtractionService` → `Task`-модель.
 *
 * F5 (ТЗ 2026-05-24): тонкая обёртка над `buildTasksPromptUnified` с
 * опциями structured-пути:
 *   - `useAssigneeRaw: true`  → поля `assigneeRaw` + `description` вместо `assignee`.
 *   - `withFragmentBounds: true` → поля `sourceStartMs` / `sourceEndMs`.
 *   - `withSourceQuote: true` → обязательная цитата.
 *   - `withConfidence: true`  → обязательное число 0..1 (с шкалой).
 *
 * T7-F6: убрали `responseAsBareArray: true` — теперь возвращаем
 * `{ tasks: [...] }`, что совместимо с json_schema strict. Caller
 * (`TaskExtractionService`) принимает оба варианта (новый объект-обёртку и
 * легаси голый массив, на случай если провайдер игнорирует schema).
 */
export function buildTasksStructuredPrompt(input: TasksStructuredPromptInput): {
  system: string;
  user: string;
} {
  return buildTasksPromptUnified(
    {
      meeting: {
        id: input.meeting.id,
        title: input.meeting.title,
        type: input.meeting.type,
      },
      dialog: input.dialog,
    },
    { ...TASKS_STRUCTURED_OPTIONS },
  );
}
