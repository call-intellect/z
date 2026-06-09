/**
 * Промпт `task-dedupe` — LLM-арбитр семантического совпадения двух задач
 * встречи (action items).
 *
 * Используется `MeetingTaskDedupeService` для «серой зоны» KNN: когда cosine
 * между fast-черновиком (Task.extractorVersion='fast') и canonical-задачей
 * той же встречи близок к порогу, но не уверенно выше его. На одну пару —
 * один вызов LLM. Вердикт:
 *   - 'same'      — это одна и та же задача (дубль) → черновик удаляется.
 *   - 'different' — это разные задачи → обе остаются (non-lossy).
 *
 * Ф5 Р2 (2026-06-08) — семантический дедуп задач. РИСКОВО (может скрыть
 * задачу) → за флагом DEFAULT OFF; при сомнении арбитр ОБЯЗАН вернуть
 * 'different' (лучше показать обе задачи, чем потерять одну).
 *
 * Cache-friendly: SYSTEM (роль + правила + few-shot) — стабильная константа,
 * переменные данные (две задачи) — только в КОНЦЕ user.
 */

import { z } from 'zod';

import { withAsrNote } from '../../ai/services/prompts/common';

/** Имя strict JSON-схемы для `responseFormat`. */
export const TASK_DEDUPE_SCHEMA_NAME = 'TaskDedupeVerdict';

/**
 * Strict JSON Schema для арбитра. `verdict` — enum, `confidence` ∈ [0,1].
 * Оба поля required (под Anthropic/OpenAI strict dialect — без optional).
 */
export const TASK_DEDUPE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['same', 'different'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

/** Zod-схема ответа арбитра — зеркалит `TASK_DEDUPE_JSON_SCHEMA`. */
export const TaskDedupeResponseSchema = z.object({
  verdict: z.enum(['same', 'different']),
  confidence: z.number().min(0).max(1),
});

export type TaskDedupeResponse = z.infer<typeof TaskDedupeResponseSchema>;

/**
 * Стабильный SYSTEM-промпт. Few-shot встроен статично (1 same + 1 different),
 * чтобы не ломать кэш. ASR-нота — поверх (числа/имена могли исказиться при
 * распознавании речи). Никаких переменных данных здесь нет — они в user.
 */
export const TASK_DEDUPE_SYSTEM_PROMPT = withAsrNote(
  `Ты определяешь, описывают ли две задачи встречи ОДНО И ТО ЖЕ действие (action item), даже при разной формулировке.

Верни:
- verdict="same" — это дубль: одна суть, тот же исполнитель/объект (одно поручение, по-разному записанное).
- verdict="different" — это разные задачи.

ПРАВИЛО: сомневаешься → "different". Лучше показать обе задачи, чем скрыть задачу. Не объединяй задачи только потому, что они «про одно и то же» в общем (например, обе про маркетинг) — нужна одна и та же конкретная суть действия.

"confidence" ∈ [0,1] — насколько ты уверен в вердикте.

Ответ — строго JSON по схеме. Никакого markdown.

Примеры:
1) A: «Подготовить смету по проекту X к пятнице» (исполнитель: Иван)
   B: «Иван готовит смету X до конца недели» (исполнитель: Иван)
   → {"verdict":"same","confidence":0.9}
2) A: «Согласовать макет лендинга» (исполнитель: Мария)
   B: «Написать текст для лендинга» (исполнитель: Мария)
   → {"verdict":"different","confidence":0.85}`,
);

/**
 * Шаблон user-сообщения. Переменные данные (две задачи: title + assignee) —
 * в самом КОНЦЕ (cache-friendly). На call-site результат оборачивается в
 * `wrapUserData` при включённом prompt-injection guard.
 */
export function TASK_DEDUPE_USER_TEMPLATE(args: {
  a: { title: string; assignee?: string | null };
  b: { title: string; assignee?: string | null };
}): string {
  const fmt = (t: { title: string; assignee?: string | null }): string =>
    t.assignee ? `${t.title} (исполнитель: ${t.assignee})` : t.title;
  return `Определи, описывают ли задача A и задача B одно и то же действие.

Задача A: ${fmt(args.a)}
Задача B: ${fmt(args.b)}`;
}
