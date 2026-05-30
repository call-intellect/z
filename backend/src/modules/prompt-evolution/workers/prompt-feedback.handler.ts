/**
 * Agents v2 Фаза B1 (2026-05-30) — PromptFeedback event handlers (entry-point).
 *
 * Сами `@OnEvent('ai.invocation.completed')` / `@OnEvent('ai.invocation.edited')`
 * хэндлеры живут в `services/prompt-feedback-collector.service.ts`. Этот файл —
 * только entrypoint для тестов и для соблюдения файловой структуры из ТЗ
 * (`workers/prompt-feedback.handler.ts`).
 *
 * TODO Фаза B1.1 (`ai.invocation.edited`): editedOutput collection требует
 * backend-связки edited UI fields ↔ invocationId. Сейчас UI-обновлятели
 * (`Meeting.summary`, `AiResult.*`, `Card.*`, ...) НЕ проставляют invocationId,
 * поэтому события edited никем не эмитятся. Решение:
 *   1. Добавить колонку `lastLlmInvocationId` на editable AI-генерируемые поля.
 *   2. Эмитить `ai.invocation.edited` после успешного update в этих сервисах.
 * См. plans/tz/2026-05-29-agents-v2-umbrella.md §B1 «Сбор feedback» п.2.
 */

export { PromptFeedbackCollectorService } from '../services/prompt-feedback-collector.service';
export type {
  AiInvocationCompletedEvent,
  AiInvocationEditedEvent,
} from '../services/prompt-feedback-collector.service';
