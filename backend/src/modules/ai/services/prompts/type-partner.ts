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

export const TOOL_NAME = 'extract_partner';

export const SCHEMA = z
  .object({
    benefit_for_us: z.array(z.string()),
    benefit_for_partner: z.array(z.string()),
    partnership_model: z.string().nullable(),
    joint_mechanics: z.array(z.string()),
    pilot: z.string().nullable(),
    risks: z.array(z.string()),
    next_step: z.string().nullable(),
  })
  .strict();

const SYSTEM = `Ты — деловой ассистент. Это партнёрская встреча.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "benefit_for_us": выгода для нашей стороны (массив).
- "benefit_for_partner": выгода для партнёра.
- "partnership_model": модель партнёрства (например "комиссия с продаж", "co-marketing"), или null.
- "joint_mechanics": совместные механики/активности.
- "pilot": формат пилотного проекта (или null).
- "risks": риски сотрудничества.
- "next_step": ближайший следующий шаг или null.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: partner\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт партнёрской встречи',
  {
    benefit_for_us: fieldStringArray,
    benefit_for_partner: fieldStringArray,
    partnership_model: fieldNullableString,
    joint_mechanics: fieldStringArray,
    pilot: fieldNullableString,
    risks: fieldStringArray,
    next_step: fieldNullableString,
  },
  [
    'benefit_for_us',
    'benefit_for_partner',
    'partnership_model',
    'joint_mechanics',
    'pilot',
    'risks',
    'next_step',
  ],
);
