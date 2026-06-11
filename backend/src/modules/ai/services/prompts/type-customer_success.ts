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

export const TOOL_NAME = 'extract_customer_success';

export const SCHEMA = z
  .object({
    customer_outcome: z.string().nullable(),
    issues: z.array(z.string()),
    churn_risk: z.enum(['low', 'medium', 'high']).nullable(),
    upsell_opportunities: z.array(z.string()),
    actions_required: z.array(z.string()),
    next_contact: z.string().nullable(),
    // A11-Волна2 (additive, опциональные — обратная совместимость):
    churn_risk_quote: z.string().nullable().optional(),
    competitors_mentioned: z.array(z.string()).optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

const SYSTEM = `Ты — ассистент Customer Success. Это разговор с клиентом о результатах работы.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "customer_outcome": какой результат клиент получает / не получает (или null).
- "issues": проблемы, с которыми сталкивается клиент.
- "churn_risk": риск оттока клиента (low/medium/high) или null.
  Якоря шкалы (ТЗ F2):
  - high — клиент явно обсуждает уход, сравнивает с конкурентами,
           есть невыполненные обещания с нашей стороны;
  - medium — клиент неактивно использует продукт, есть жалобы без
             озвученного намерения уйти;
  - low — продукт встроен в процессы, обсуждается расширение.
- "upsell_opportunities": возможности расширения / апсейла.
- "actions_required": что нашей команде нужно сделать.
- "next_contact": когда следующий контакт с клиентом или null.

Стороны: НАША сторона — менеджер CS; вторая — клиент. issues — из реплик клиента; actions_required — обязательства ТОЛЬКО нашей стороны. Не приписывай слова не тому спикеру. Пусто — честно «не выявлено».

Дополнительно извлеки:
- "churn_risk_quote": дословная цитата клиента, в которой звучит риск оттока (намёк на уход, сравнение с конкурентом, угроза не продлевать), строкой; null, если такой реплики не было.
- "competitors_mentioned": конкуренты / альтернативные решения, упомянутые клиентом (массив). Пустой массив [], если конкурентов не называли.
- "data_quality": 1–2 фразы о полноте данных встречи — насколько полный транскрипт, есть ли неопределённые спикеры, ненадёжные для распознавания места (числа/имена/термины); null, если оговорок нет.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: customer_success\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт customer success встречи',
  {
    customer_outcome: fieldNullableString,
    issues: fieldStringArray,
    churn_risk: {
      type: ['string', 'null'],
      enum: ['low', 'medium', 'high', null],
    },
    upsell_opportunities: fieldStringArray,
    actions_required: fieldStringArray,
    next_contact: fieldNullableString,
    churn_risk_quote: fieldNullableString,
    competitors_mentioned: fieldStringArray,
    data_quality: fieldNullableString,
  },
  [
    'customer_outcome',
    'issues',
    'churn_risk',
    'upsell_opportunities',
    'actions_required',
    'next_contact',
    'churn_risk_quote',
    'competitors_mentioned',
    'data_quality',
  ],
);
