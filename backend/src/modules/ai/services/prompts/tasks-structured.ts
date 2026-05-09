import { z } from 'zod';

import { type DialogTurn, turnsToText } from './common';

/**
 * Промпт для извлечения action items с расширенными полями (для модели `Task`):
 * привязка к фрагменту разговора (sourceStartMs/EndMs), цитата (sourceQuote),
 * confidence-оценка.
 *
 * Это НЕ замена `prompts/tasks.ts` (там legacy-формат для AiResult.tasks).
 * Здесь — новый формат для AI-pipeline фазы M3 (модели `Task` + `MeetingHighlight`).
 */
export const TASKS_STRUCTURED_TASK_TYPE = 'tasks';
export const TASKS_STRUCTURED_PROMPT_NAME = 'tasks_structured_v1';

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

const TASKS_STRUCTURED_SYSTEM = `Ты — деловой ассистент. Извлеки из встречи список action items (задач, которые были поставлены или зафиксированы).

Правила:
- Извлекай только реальные задачи. Если задач не было — верни пустой массив [].
- "title" — краткая формулировка задачи (на русском, императив).
- "description" — расширенное описание, если в разговоре есть детали (или null).
- "assigneeRaw" — ФИО, ник или роль ответственного, как было сказано в разговоре (или null).
- "dueDate" — срок: ISO-8601 (YYYY-MM-DD) или относительная фраза («к концу недели», «до пятницы»). null — если срока нет.
- "sourceStartMs", "sourceEndMs" — миллисекунды от начала встречи: фрагмент, где задача была сформулирована.
- "sourceQuote" — точная цитата из разговора (1-3 предложения), на основании которой извлечена задача.
- "confidence" — твоя уверенность от 0 до 1, что это действительно задача (а не пустое обсуждение). Минимум 0.5 для серьёзных задач.

Формат ответа: ТОЛЬКО валидный JSON-массив. Без текста до или после, без markdown-обёрток.`;

export interface TasksStructuredPromptInput {
  meeting: { id: string; type: string; title: string };
  dialog: DialogTurn[];
}

export function buildTasksStructuredPrompt(input: TasksStructuredPromptInput): {
  system: string;
  user: string;
} {
  const dialog = turnsToText(input.dialog);
  return {
    system: TASKS_STRUCTURED_SYSTEM,
    user: `Тип встречи: ${input.meeting.type}
Заголовок: ${input.meeting.title}

Диалог (timestamps в формате [mm:ss-mm:ss]):
${dialog}

Верни JSON-массив задач. Reply with valid JSON only.`,
  };
}
