import { z } from 'zod';

import { withAsrNote } from '../../ai/services/prompts/common';

export const TASK_DEDUPE_SCHEMA_NAME = 'TaskDedupeVerdict';

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

export const TaskDedupeResponseSchema = z.object({
  verdict: z.enum(['same', 'different']),
  confidence: z.number().min(0).max(1),
});

export type TaskDedupeResponse = z.infer<typeof TaskDedupeResponseSchema>;

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
