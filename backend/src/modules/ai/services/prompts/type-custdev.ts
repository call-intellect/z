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

export const TOOL_NAME = 'extract_custdev';

export const SCHEMA = z
  .object({
    pains: z.array(z.string()),
    use_cases: z.array(z.string()),
    quotes: z.array(z.string()),
    alternatives: z.array(z.string()),
    frequency: z.string().nullable(),
    willingness_to_pay: z.string().nullable(),
    insights: z.array(z.string()),
  })
  .strict();

const SYSTEM = `Ты — продуктовый ассистент. Это CustDev / интервью.
Извлеки:
- "pains": боли респондента (массив).
- "use_cases": сценарии использования / контекст работы.
- "quotes": цитаты респондента дословно (важные формулировки).
- "alternatives": какие альтернативы / workaround'ы он использует сегодня.
- "frequency": как часто проблема случается (или null).
- "willingness_to_pay": готовность платить (или null).
- "insights": ключевые инсайты для команды продукта.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: custdev\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт CustDev-интервью',
  {
    pains: fieldStringArray,
    use_cases: fieldStringArray,
    quotes: fieldStringArray,
    alternatives: fieldStringArray,
    frequency: fieldNullableString,
    willingness_to_pay: fieldNullableString,
    insights: fieldStringArray,
  },
  [
    'pains',
    'use_cases',
    'quotes',
    'alternatives',
    'frequency',
    'willingness_to_pay',
    'insights',
  ],
);
