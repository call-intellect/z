import { z } from 'zod';

import { withAsrNote } from '../../ai/services/prompts/common';

export const GOAL_TASK_LINK_SCHEMA_NAME = 'GoalTaskLinks';

export const GOAL_TASK_LINK_SYSTEM_PROMPT = withAsrNote(
  [
    'Ты определяешь, какие задачи встречи служат достижению цели (develops).',
    'Задача develops цель, если её выполнение прямо продвигает цель — закрывает её часть, снимает препятствие или приближает измеримый результат.',
    'Не уверен → develops=false. Лучше не привязать задачу, чем привязать её к чужой цели.',
    'Общей темы или одного проекта НЕДОСТАТОЧНО: нужна реальная связь «эта задача двигает эту цель».',
    '',
    'Для каждой задачи из списка верни запись { taskId, develops, confidence }.',
    '- taskId — строго id из переданного списка (не выдумывай).',
    '- develops — true, если задача служит цели; иначе false.',
    '- confidence ∈ [0,1] — уверенность. 0.9+ только если связь явная.',
    '',
    'Пример (develops=true): цель «Увеличить выручку на 20% за квартал»,',
    'задача «Запустить рекламную кампанию для лидогенерации» → develops=true (кампания напрямую растит выручку).',
    'Пример (develops=false): та же цель, задача «Обновить корпоративный логотип» → develops=false (общая компания, но цель не двигает).',
    '',
    'Отвечай строго в формате JSON по предоставленной схеме на русском языке. Никакого markdown.',
  ].join('\n'),
);

export const GOAL_TASK_LINK_USER_TEMPLATE = (args: {
  goalName: string;
  tasks: ReadonlyArray<{ id: string; title: string }>;
}): string => {
  const lines = [
    'Цель:',
    `«${args.goalName}»`,
    '',
    'Задачи встречи (определи по каждой, служит ли она цели):',
  ];
  if (args.tasks.length === 0) {
    lines.push('  (нет задач — верни links=[])');
  } else {
    args.tasks.forEach((t, idx) => {
      lines.push(`  ${idx + 1}. [${t.id}] «${t.title}»`);
    });
  }
  lines.push('', 'Верни JSON по схеме `GoalTaskLinks`.');
  return lines.join('\n');
};

export const GOAL_TASK_LINK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['links'],
  properties: {
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'develops', 'confidence'],
        properties: {
          taskId: { type: 'string' },
          develops: { type: 'boolean' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

export const GoalTaskLinkResponseSchema = z.object({
  links: z.array(
    z.object({
      taskId: z.string(),
      develops: z.boolean(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export type GoalTaskLinkResponse = z.infer<typeof GoalTaskLinkResponseSchema>;
