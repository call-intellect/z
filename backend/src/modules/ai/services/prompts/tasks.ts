import {
  type PromptInput,
  type PromptOutput,
  TasksSchema,
} from './common';
import {
  buildTasksPromptUnified,
  buildTasksToolUnified,
  TASKS_UNIFIED_TOOL_NAME,
  type TasksOrgContext,
} from './tasks-unified';

// ─────────────────── Legacy экспорты (F5, ТЗ 2026-05-24) ──────────────────
//
// Тонкие обёртки над `tasks-unified.ts`. Сохраняют 1:1 поведение
// существующих caller'ов (`analyze.worker`, `MeetingExtractActionsService`).
// При следующем рефакторинге caller'ы должны мигрировать на
// `buildTasksPromptUnified` напрямую.
//
// Реальные тексты SYSTEM и сборка JSON-Schema теперь живут в одном месте —
// `tasks-unified.ts`. Это закрывает F5 (дедупликация трёх tasks-промтов).

/**
 * Имя tool'а для tasks-агента. Единое значение из `tasks-unified.ts`.
 */
export const TASKS_TOOL_NAME = TASKS_UNIFIED_TOOL_NAME;

/**
 * Zod-схема для `tasks`-ответа. Это «широкая» схема из `common.ts`:
 * confidence/sourceQuote/suggested*-поля — `.optional()`, чтобы старые
 * модели (которые возвращают только title/assignee/dueDate) проходили
 * валидацию.
 *
 * Для строгой схемы под конкретные опции (например, enriched +
 * withConfidence) используй `buildTasksSchemaUnified(opts)` из
 * `tasks-unified.ts`.
 */
export const TASKS_SCHEMA = TasksSchema;

/**
 * LlmTool для tasks-агента. Содержит JSON-Schema с обогащёнными полями
 * (suggestedAssigneeHint, suggestedDueDate, suggestedPriority, confidence,
 * sourceQuote) — все optional, чтобы старые модели не падали на
 * валидации. required = ['title', 'assignee', 'dueDate'].
 *
 * Это эквивалент исторического `TASKS_TOOL` из этого файла до F5.
 * `includeOptionalFields: true` включает «lax»-режим: suggested* +
 * confidence + sourceQuote присутствуют в properties, но НЕ в required.
 */
export const TASKS_TOOL = buildTasksToolUnified({
  includeOptionalFields: true,
});

/**
 * Legacy builder для базового tasks-агента (используется `analyze.worker`).
 * Тонкая обёртка над `buildTasksPromptUnified` с дефолтными опциями
 * (legacy 3-полевой формат: title / assignee / dueDate).
 *
 * Сохраняет 1:1 поведение с историческим `buildTasksPrompt` до F5:
 *   - system: BASE_SYSTEM + withToolInstructions + withRoomChatNote +
 *     withConfidenceCalibration (F2 уже был применён ранее).
 *   - user: `Тип встречи: ...\nЗаголовок: ...\n\nДиалог:\n${dialog}`.
 *
 * Примечание: исторический промт НЕ включал блок про confidence как
 * отдельное поле — модель сама решала, возвращать ли. F2 ранее добавил
 * `withConfidenceCalibration` (общую шкалу), оставляем его и здесь, чтобы
 * не регрессировать поведение. Поэтому `withConfidence: true` для
 * вызова unified builder — это даёт шкалу в system. Поле confidence
 * остаётся optional на уровне TASKS_SCHEMA (caller использует «широкую»
 * схему) — это ровно то, что было до F5.
 */
export function buildTasksPrompt(input: PromptInput): PromptOutput {
  return buildTasksPromptUnified(input, {
    enriched: false,
    withConfidence: false,
    withSourceQuote: false,
    // F2 ранее (до F5) подмешивал калибровку шкалы через
    // `withConfidenceCalibration` поверх legacy SYSTEM. Сохраняем это
    // поведение: калибровка применяется, но блок «Поле confidence — ...»
    // и required-флаг confidence НЕ добавляются (модель сама решает).
    calibrationOnly: true,
  });
}

/**
 * Контекст для `MeetingExtractActionsService` (Wave 3 / Tracker Phase 3
 * part B). Naследует базу `TasksOrgContext` (projects/goals/people),
 * добавляет `meetingDateIso` для перевода относительных сроков.
 */
export interface MeetingExtractActionsContext extends TasksOrgContext {
  /** Текущая дата встречи (ISO YYYY-MM-DD) — опора для относительных сроков. */
  meetingDateIso?: string;
}

/**
 * Wave 3 builder для `MeetingExtractActionsService`. Обогащённый формат:
 * suggestedAssigneeHint / suggestedDueDate / suggestedPriority +
 * confidence (с min/max enforcement) + sourceQuote (обязательное).
 *
 * Тонкая обёртка над `buildTasksPromptUnified`. Все настройки одинаковые
 * с историческим `buildMeetingExtractActionsPrompt` до F5.
 */
export function buildMeetingExtractActionsPrompt(
  input: PromptInput,
  ctx: MeetingExtractActionsContext = {},
): PromptOutput {
  return buildTasksPromptUnified(input, {
    enriched: true,
    withConfidence: true,
    withSourceQuote: true,
    ...(ctx.meetingDateIso !== undefined
      ? { meetingDateIso: ctx.meetingDateIso }
      : {}),
    orgContext: {
      ...(ctx.projects !== undefined ? { projects: ctx.projects } : {}),
      ...(ctx.goals !== undefined ? { goals: ctx.goals } : {}),
      ...(ctx.people !== undefined ? { people: ctx.people } : {}),
    },
  });
}

/**
 * @deprecated Используй `buildTasksPromptUnified(input, { enriched: true,
 *   withConfidence: true, withSourceQuote: true })` напрямую. Эта константа
 *   оставлена как функция-getter для backward-compat существующих тестов,
 *   которые могут импортировать SYSTEM-текст напрямую (грепом по
 *   `MEETING_EXTRACT_ACTIONS_SYSTEM`).
 *
 *   ВНИМАНИЕ: значение вычисляется лениво при первом обращении (через
 *   builder с фиктивным минимальным input), а НЕ хранится как
 *   синхронизированная строковая константа. Это означает, что любая
 *   правка system-текста в `tasks-unified.ts` автоматически попадёт сюда.
 */
export const MEETING_EXTRACT_ACTIONS_SYSTEM: string = (() => {
  const dummy: PromptInput = {
    meeting: { id: '__legacy__', title: '__legacy__', type: 'team' },
    dialog: [],
  };
  return buildMeetingExtractActionsPrompt(dummy).system;
})();
