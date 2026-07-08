import { z } from 'zod';

import type { LlmTool } from '../../ai/services/llm.types';

export const TASK_SOLUTION_EXTRACT_TASK_TYPE = 'compile-org-document' as const;
export const TASK_SOLUTION_EXTRACT_TOOL_NAME = 'extract_task_solution';
export const TASK_SOLUTION_EXTRACT_MAX_TOKENS = 700;

export const TaskSolutionExtractOutputSchema = z
  .object({
    hasConcreteMethod: z.boolean(),
    solverNames: z.array(z.string()),
  })
  .strict();
export type TaskSolutionExtractOutput = z.infer<typeof TaskSolutionExtractOutputSchema>;

export const TASK_SOLUTION_EXTRACT_TOOL: LlmTool = {
  name: TASK_SOLUTION_EXTRACT_TOOL_NAME,
  description:
    'Определить по материалу задачи: есть ли содержательное «как решалось», и кто из людей реально решал.',
  input_schema: {
    type: 'object',
    required: ['hasConcreteMethod', 'solverNames'],
    additionalProperties: false,
    properties: {
      hasConcreteMethod: {
        type: 'boolean',
        description:
          'true, если материал описывает КОНКРЕТНОЕ решение (шаги/действия/приём). false — отписка без сути («само решилось», «фигня», «нечего рассказывать», «не помню»).',
      },
      solverNames: {
        type: 'array',
        description:
          'Имена людей, которые РЕАЛЬНО делали работу по решению задачи. НЕ включай тех, кто лишь рассказал/упомянул/передал информацию. Сомневаешься — не включай.',
        items: { type: 'string' },
      },
    },
  },
};

const SYSTEM = `# Кто ты
Ты — фильтр качества «Решений задач» в системе памяти компании Кора. По материалу конкретной задачи (её название + реплики людей о том, как её решали) ты определяешь две вещи: (1) есть ли вообще содержательное «как решали», (2) кто из людей реально решал.

# Что вернуть
Строго через инструмент ${TASK_SOLUTION_EXTRACT_TOOL_NAME}, два поля:

## hasConcreteMethod (boolean)
- true — в материале есть хоть одно КОНКРЕТНОЕ действие/шаг/приём решения (даже кратко: «добавил индекс на user_id», «поставил лимитер и очередь ретраев»).
- false — отписка без содержания: «да фигня», «само решилось», «нечего рассказывать», «не помню», «не знаю», «как-то решилось», пустые общие слова без конкретики.
- Смещение к ПОЛНОТЕ: если есть хоть какая-то конкретика решения — true. false ставь только для явных отписок.

## solverNames (string[])
- Имена тех, кто РЕАЛЬНО делал работу по задаче.
- КРИТИЧНО: «кто решал» ≠ «кто рассказал». «Сергей рассказал, что Михаил настроил SSO» → решал Михаил (не Сергей). «Дарья в чате: Иван починил вебхук» → решал Иван (не Дарья).
- Соисполнители: «Иван поднял сеть, Михаил — стораджи» → оба: [«Иван», «Михаил»].
- Первое лицо без имени («поставил лимитер…») → пустой массив (исполнителя определит система по владельцу задачи).
- Смещение к ТОЧНОСТИ: сомневаешься, делал ли человек работу, — НЕ включай. Лучше пропустить, чем приписать чужое.
- Только имена людей из материала. Не выдумывай.

# Запреты
- Никаких пояснений вне инструмента. Только два поля.`;

export function buildTaskSolutionExtractSystemPrompt(): string {
  return SYSTEM;
}

export interface TaskSolutionExtractBlock {
  name: string;
  question?: string | null;
  answer: string;
  quotes?: string[];
}

export function buildTaskSolutionExtractUserMessage(input: {
  taskTitle: string;
  assigneeName?: string | null;
  blocks: TaskSolutionExtractBlock[];
}): string {
  const parts: string[] = [];
  parts.push(`Задача: ${input.taskTitle}`);
  if (input.assigneeName) parts.push(`Исполнитель задачи (assignee): ${input.assigneeName}`);
  parts.push('');
  parts.push('Материал (реплики о том, как решали):');
  input.blocks.forEach((b, i) => {
    const lines = [`[Блок ${i + 1}] ${b.name}`];
    if (b.question) lines.push(`  Вопрос: ${b.question}`);
    lines.push(`  Суть: ${b.answer}`);
    const quotes = (b.quotes ?? []).filter((q) => q && q.trim().length > 0);
    if (quotes.length > 0) lines.push(`  Цитаты: ${quotes.map((q) => `«${q}»`).join('; ')}`);
    parts.push(lines.join('\n'));
  });
  parts.push('');
  parts.push(`Верни результат через инструмент ${TASK_SOLUTION_EXTRACT_TOOL_NAME}.`);
  return parts.join('\n');
}
