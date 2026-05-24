import { z } from 'zod';

import { type DialogTurn } from './common';
import { buildTasksPromptUnified } from './tasks-unified';

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
 *   - `responseAsBareArray: true` → ответ голым JSON-массивом
 *     (`TaskExtractionService` парсит через `JSON.parse(result.text)`
 *     при `responseFormat: { type: 'json_object' }`).
 *
 * `tasks-unified` builder возвращает `{ system, user }` под унифицированный
 * tool-flow (объект `{ tasks: [...] }`). В structured-пути caller ждёт
 * голый JSON-массив, поэтому здесь оборачиваем user-вывод так, чтобы
 * сохранить исторический контракт: убираем строку «Тип встречи / Заголовок»
 * не нужно — она уже есть в unified; добавляем явную инструкцию
 * вернуть массив (это делает `responseAsBareArray: true` внутри builder'а).
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
    {
      enriched: false,
      useAssigneeRaw: true,
      withFragmentBounds: true,
      withSourceQuote: true,
      withConfidence: true,
      responseAsBareArray: true,
    },
  );
}
