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

export const TOOL_NAME = 'extract_project';

export const SCHEMA = z
  .object({
    agreements: z.array(z.string()),
    responsibilities: z.array(z.string()),
    deadlines: z.array(z.string()),
    risks: z.array(z.string()),
    open_questions: z.array(z.string()),
    next_step: z.string().nullable(),
  })
  .strict();

const SYSTEM = `Ты — деловой ассистент. Это проектная встреча.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "agreements": договорённости сторон.
- "responsibilities": зоны ответственности (кто за что отвечает).
- "deadlines": сроки/дедлайны (текстом, со ссылкой на задачу/блок если упомянуто).
- "risks": риски проекта.
- "open_questions": открытые вопросы.
- "next_step": ближайший следующий шаг или null.

Само-проверка и различения:
agreements — только принятые решения, не обсуждённые варианты. Идея/предложение ≠ договорённость ≠ задача. Если ответственный/срок не назван — «не уточнено». Пусто — честно «не зафиксировано».`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: project\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт проектной встречи',
  {
    agreements: fieldStringArray,
    responsibilities: fieldStringArray,
    deadlines: fieldStringArray,
    risks: fieldStringArray,
    open_questions: fieldStringArray,
    next_step: fieldNullableString,
  },
  [
    'agreements',
    'responsibilities',
    'deadlines',
    'risks',
    'open_questions',
    'next_step',
  ],
);
