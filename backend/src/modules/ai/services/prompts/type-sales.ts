import { z } from 'zod';

import {
  buildExtractTool,
  fieldEnum,
  fieldNullableEnum,
  fieldNullableString,
  fieldString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  turnsToText,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_sales';

export const SCHEMA = z
  .object({
    pain: z.string().nullable(),
    interest_level: z.enum(['low', 'medium', 'high']).nullable(),
    objections: z.array(z.string()),
    budget: z.string().nullable(),
    decision_maker: z.string().nullable(),
    urgency: z.string().nullable(),
    next_step: z.string(),
  })
  .strict();

const SYSTEM = `Ты — sales-ассистент. Это продажная встреча.
Извлеки:
- "pain": боль клиента или null.
- "interest_level": уровень интереса (low/medium/high) или null.
- "objections": возражения клиента (массив).
- "budget": упомянутый бюджет или null.
- "decision_maker": кто ЛПР, или null.
- "urgency": срочность принятия решения или null.
- "next_step": конкретный следующий шаг (обязательно строка). Если не было — напиши "уточнить следующий шаг с клиентом".
Не выдумывай данных, которых нет в диалоге.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withToolInstructions(SYSTEM, TOOL_NAME),
    user: `Тип встречи: sales\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog)}`,
  };
}

// Для Anthropic: enum без null отдельно, nullable enum через type=['string','null']
// тут не нужен — берём строку, но контролируем enum в Zod на парсе.
export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь sales-отчёт',
  {
    pain: fieldNullableString,
    interest_level: {
      type: ['string', 'null'],
      enum: ['low', 'medium', 'high', null],
    },
    objections: fieldStringArray,
    budget: fieldNullableString,
    decision_maker: fieldNullableString,
    urgency: fieldNullableString,
    next_step: fieldString,
  },
  [
    'pain',
    'interest_level',
    'objections',
    'budget',
    'decision_maker',
    'urgency',
    'next_step',
  ],
);

// Подавляем неиспользуемые имена (на случай будущих рефакторов).
void fieldEnum;
void fieldNullableEnum;
