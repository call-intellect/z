import { z } from 'zod';

import {
  buildExtractTool,
  fieldNullableString,
  fieldString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_standup';

export const SCHEMA = z
  .object({
    priorities: z.array(z.string()),
    who_does_what: z.array(
      z.object({ person: z.string(), doing: z.string() }).strict(),
    ),
    new_tasks: z.array(z.string()),
    blockers: z.array(z.string()),
    decisions_needed: z.array(z.string()),
    next_checkpoint: z.string().nullable(),
  })
  .strict();

const SYSTEM = `Ты — деловой ассистент. Это планёрка / standup.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

- "priorities": текущие приоритеты команды.
- "who_does_what": кто чем занимается (массив пар person + doing).
- "new_tasks": задачи, появившиеся на встрече.
- "blockers": блокеры участников.
- "decisions_needed": вопросы, требующие решения руководителя.
- "next_checkpoint": следующая контрольная точка / null.
Не выдумывай.

Само-проверка и различения:
new_tasks — только реальные обязательства, не пожелания. who_does_what: если исполнитель не установлен по репликам — person=«не определён», не угадывай из контекста. Пусто — честно «не зафиксировано».`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: standup\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь структурированный отчёт планёрки',
  {
    priorities: fieldStringArray,
    who_does_what: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          person: fieldString,
          doing: fieldString,
        },
        required: ['person', 'doing'],
        additionalProperties: false,
      },
    },
    new_tasks: fieldStringArray,
    blockers: fieldStringArray,
    decisions_needed: fieldStringArray,
    next_checkpoint: fieldNullableString,
  },
  [
    'priorities',
    'who_does_what',
    'new_tasks',
    'blockers',
    'decisions_needed',
    'next_checkpoint',
  ],
);
