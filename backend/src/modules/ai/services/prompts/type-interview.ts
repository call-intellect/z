import { z } from 'zod';

import {
  buildExtractTool,
  fieldNullableString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_interview';

export const SCHEMA = z
  .object({
    experience: z.array(z.string()),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    risks: z.array(z.string()),
    motivation: z.string().nullable(),
    role_fit: z.enum(['low', 'medium', 'high']).nullable(),
    overall_rating: z.string().nullable(),
    next_step: z.string().nullable(),
    competing_offers: z.string().nullable().optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

const SYSTEM = `Ты — рекрутер-ассистент. Это собеседование с кандидатом.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "experience": опыт кандидата (релевантные пункты).
- "strengths": сильные стороны.
- "weaknesses": слабые стороны.
- "risks": риски найма (потенциальные проблемы, gaps).
- "motivation": мотивация кандидата работать у нас (или null).
- "role_fit": соответствие роли (low/medium/high) или null.
  Якоря шкалы (ТЗ F2):
  - high — есть подтверждённый релевантный опыт для всех ключевых требований роли;
  - medium — релевантный опыт частичный, есть гэпы, но кандидат осваиваемый;
  - low — опыт слабо соответствует роли или мотивация под вопросом.
- "overall_rating": итоговая оценка фразой (например "сильный сеньор" / "соответствует, но с оговорками") или null.
- "next_step": следующий этап (next round, оффер, отказ) или null.
Будь объективен — опирайся только на сказанное на встрече.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Анна (рекрутер): Расскажите про опыт с NestJS. Сергей (кандидат): Два года в проде, работал с микросервисами через RabbitMQ, писал кастомные guards и interceptors. Анна: А с Prisma? Сергей: С ним только полгода, поверхностно, в основном работал с TypeORM».
Вывод: {"experience": ["2 года NestJS в проде, микросервисы на RabbitMQ", "написание кастомных guards/interceptors", "TypeORM (основной ORM в опыте)"], "strengths": ["глубокий опыт NestJS и интеграции через очереди"], "weaknesses": ["Prisma — только полгода и поверхностно"], "risks": ["потребуется доращивать Prisma под наш стек"], "motivation": null, "role_fit": "medium", "overall_rating": "релевантный middle с гэпом по Prisma", "next_step": null}.

Что НЕ делать (edge case — общие фразы без подтверждённых фактов):
Транскрипт-фрагмент: «Анна: Расскажите о себе. Сергей: Я люблю программировать, постоянно учусь. Анна: А чего хотите от новой работы? Сергей: Интересных задач».
Вывод: {"experience": [], "strengths": [], "weaknesses": [], "risks": ["нет конкретики по опыту и стэку — нужно отдельное техническое собеседование"], "motivation": "интересные задачи", "role_fit": null, "overall_rating": null, "next_step": null}. Пояснение: «люблю программировать» — не сильная сторона, риторика, а не факт; пустые массивы для strengths/weaknesses.

Само-проверка и различения:
Стороны: НАША сторона — рекрутер/интервьюер; кандидат — внешняя сторона. role_fit обоснуй опытом/ответами кандидата. ЛЮБАЯ оценка кандидата — ГИПОТЕЗА по наблюдаемому на интервью (формулируй «похоже/по этому собеседованию»), не приговор. Пусто — «не выявлено».

Дополнительно извлеки:
- "competing_offers": другие офферы / предложения о работе, которые рассматривает кандидат (где, на какой стадии, сроки решения, если прозвучало), строкой; null, если кандидат про другие офферы не говорил.
- "data_quality": 1–2 фразы о полноте данных встречи — насколько полный транскрипт, есть ли неопределённые спикеры, ненадёжные для распознавания места (числа/имена/термины); null, если оговорок нет.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: interview\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт собеседования',
  {
    experience: fieldStringArray,
    strengths: fieldStringArray,
    weaknesses: fieldStringArray,
    risks: fieldStringArray,
    motivation: fieldNullableString,
    role_fit: {
      type: ['string', 'null'],
      enum: ['low', 'medium', 'high', null],
    },
    overall_rating: fieldNullableString,
    next_step: fieldNullableString,
    competing_offers: fieldNullableString,
    data_quality: fieldNullableString,
  },
  [
    'experience',
    'strengths',
    'weaknesses',
    'risks',
    'motivation',
    'role_fit',
    'overall_rating',
    'next_step',
    'competing_offers',
    'data_quality',
  ],
);
