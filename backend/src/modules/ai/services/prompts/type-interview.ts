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
  })
  .strict();

const SYSTEM = `Ты — рекрутер-ассистент. Это собеседование с кандидатом.
Извлеки:
- "experience": опыт кандидата (релевантные пункты).
- "strengths": сильные стороны.
- "weaknesses": слабые стороны.
- "risks": риски найма (потенциальные проблемы, gaps).
- "motivation": мотивация кандидата работать у нас (или null).
- "role_fit": соответствие роли (low/medium/high) или null.
- "overall_rating": итоговая оценка фразой (например "сильный сеньор" / "соответствует, но с оговорками") или null.
- "next_step": следующий этап (next round, оффер, отказ) или null.
Будь объективен — опирайся только на сказанное на встрече.`;

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
  ],
);
