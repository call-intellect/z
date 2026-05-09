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
  })
  .strict();

const SYSTEM = `Ты — ассистент Customer Success. Это разговор с клиентом о результатах работы.
Извлеки:
- "customer_outcome": какой результат клиент получает / не получает (или null).
- "issues": проблемы, с которыми сталкивается клиент.
- "churn_risk": риск оттока клиента (low/medium/high) или null.
- "upsell_opportunities": возможности расширения / апсейла.
- "actions_required": что нашей команде нужно сделать.
- "next_contact": когда следующий контакт с клиентом или null.`;

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
  },
  [
    'customer_outcome',
    'issues',
    'churn_risk',
    'upsell_opportunities',
    'actions_required',
    'next_contact',
  ],
);
