import {
  buildExtractTool,
  fieldNullableString,
  fieldString,
  type PromptInput,
  type PromptOutput,
  TasksSchema,
  turnsToText,
  withToolInstructions,
} from './common';

export const TASKS_TOOL_NAME = 'extract_tasks';
export const TASKS_SCHEMA = TasksSchema;

const TASKS_SYSTEM = `Ты — деловой ассистент. Извлеки из встречи список задач, которые были поставлены или зафиксированы.
Для каждой задачи укажи:
- "title": краткая формулировка задачи (на русском, императив).
- "assignee": ФИО или роль ответственного. Если ответственный не назван — null.
- "dueDate": срок в формате ISO-8601 (YYYY-MM-DD) или относительная фраза ("к концу недели"). Если срока нет — null.
Не выдумывай задач. Если задач не было — верни пустой массив.`;

export function buildTasksPrompt(input: PromptInput): PromptOutput {
  const dialog = turnsToText(input.dialog);
  return {
    system: withToolInstructions(TASKS_SYSTEM, TASKS_TOOL_NAME),
    user: `Тип встречи: ${input.meeting.type}\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${dialog}`,
  };
}

export const TASKS_TOOL = buildExtractTool(
  TASKS_TOOL_NAME,
  'Извлечь задачи (поручения) из встречи',
  {
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
  },
  ['tasks'],
);
