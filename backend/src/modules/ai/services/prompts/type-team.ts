import { z } from 'zod';

import {
  buildExtractTool,
  fieldNullableString,
  fieldString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  TaskItemSchema,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_team';

export const SCHEMA = z
  .object({
    discussed: z.array(z.string()),
    decisions: z.array(z.string()),
    tasks: z.array(TaskItemSchema),
    blockers: z.array(z.string()),
    next_step: z.string().nullable(),
  })
  .strict();

export type TeamReport = z.infer<typeof SCHEMA>;

const SYSTEM = `Ты — деловой ассистент. Это командная встреча.
Извлеки структурированный отчёт. Все поля — на русском, без оценочных суждений.
- "discussed": темы, которые обсуждались (список коротких пунктов).
- "decisions": принятые решения (список).
- "tasks": задачи с ответственными и сроками. assignee/dueDate — null, если не названы.
- "blockers": блокеры/риски, упомянутые на встрече.
- "next_step": следующий шаг команды или null, если не определён.
Если поле пустое — вернуть пустой массив (для строковых null допустим только если так указано).

Само-проверка и различения:
Различай: «решили» (зафиксированное решение) ≠ «обсудили» (вариант без фиксации) ≠ «предложили» (идея). Задача — только обязательство с ответственным; идея/пожелание задачей не считается. Если ответственный/срок не назван — пиши «не уточнено» (это сигнал, не выдумывай). Не было решений/задач — честно «не зафиксировано», не натягивай структуру.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: team\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь структурированный отчёт командной встречи',
  {
    discussed: fieldStringArray,
    decisions: fieldStringArray,
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: fieldString,
          assignee: fieldNullableString,
          dueDate: fieldNullableString,
        },
        required: ['title', 'assignee', 'dueDate'],
        additionalProperties: false,
      },
    },
    blockers: fieldStringArray,
    next_step: fieldNullableString,
  },
  ['discussed', 'decisions', 'tasks', 'blockers', 'next_step'],
);
