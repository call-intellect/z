import { z } from 'zod';

export const FEEDBACK_CLUSTER_PROMPT_KEY = 'feedback.cluster' as const;

export const FEEDBACK_CLUSTER_SCHEMA_NAME = 'feedback_cluster_v1' as const;

export const FEEDBACK_CLUSTER_TASK_TYPE = 'feedback.cluster' as const;

export interface FeedbackClusterInputMessage {
  id: string;
  userId: string;
  createdAt: string;
  text: string;
}

export interface FeedbackClusterInputTopic {
  id: string;
  title: string;
  description: string;
}

export interface FeedbackClusterInput {
  messages: FeedbackClusterInputMessage[];
  existingTopics: FeedbackClusterInputTopic[];
}

export const FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK = [
  'Ты обрабатываешь обратную связь от пользователей продукта.',
  '',
  'ВХОД (JSON):',
  '- messages: массив { id, userId, createdAt, text }',
  '- existingTopics: массив { id, title, description }',
  '',
  'ЗАДАЧА (внутри одного ответа, обе части):',
  '',
  '1) Раздели каждое сообщение на отдельные смысловые тезисы.',
  '   Один пользователь в одном сообщении может высказать несколько тем — разнеси.',
  '   Пример: «дайте тёмную тему и почините экспорт» = 2 тезиса.',
  '',
  '2) Каждый тезис привяжи либо к одному из existingTopics (по смыслу, не по словам),',
  '   либо создай новый блок, если ни один существующий не подходит.',
  '',
  'ПРАВИЛА:',
  '- Один тезис ровно в один блок.',
  '- Тональность (жалоба, запрос, благодарность) — часть смысла, не отдельное измерение.',
  '  «спасибо за дашборд директора» → блок «Благодарности за дашборд директора».',
  '  «кнопка экспорта виснет» → блок «Проблемы с кнопкой экспорта».',
  '- Новый блок создавай ТОЛЬКО ЕСЛИ:',
  '  (a) 2+ тезисов в этом батче не подходят ни в один existingTopic, ИЛИ',
  '  (b) тезис явно про принципиально новую тему.',
  '  Иначе ищи ближайший существующий.',
  '- Если в этом же батче уже создал tempId под эту тему — переиспользуй.',
  '- Если тезис — мусор (нечитаемый текст, спам, оффтоп) — topicRef = "discard".',
  '',
  'ВЫХОД (строго этот JSON, ничего лишнего):',
  '{',
  '  "newTopics": [{ "tempId": "new_1", "title": "...", "description": "..." }],',
  '  "assignments": [',
  '    { "messageId": "msg_1", "items": [{ "text": "...", "topicRef": "..." }] }',
  '  ]',
  '}',
  '',
  'topicRef = id из existingTopics, либо tempId из newTopics, либо строка "discard".',
  'title нового блока ≤80 символов, description — 1-2 предложения.',
].join('\n');

export const FEEDBACK_CLUSTER_USER_TEMPLATE = (input: FeedbackClusterInput): string => {
  const payload = {
    messages: input.messages.map((m) => ({
      id: m.id,
      userId: m.userId,
      createdAt: m.createdAt,
      text: m.text,
    })),
    existingTopics: input.existingTopics.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
    })),
  };
  return [
    'Вход (JSON):',
    JSON.stringify(payload, null, 2),
    '',
    `Верни JSON по схеме ${FEEDBACK_CLUSTER_SCHEMA_NAME}.`,
  ].join('\n');
};

const NewTopicSchema = z.object({
  tempId: z.string().regex(/^new_\d+$/),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
});

const AssignmentItemSchema = z.object({
  text: z.string().min(1).max(2_000),
  topicRef: z.string().min(1),
});

const AssignmentSchema = z.object({
  messageId: z.string().min(1),
  items: z.array(AssignmentItemSchema),
});

export const FeedbackClusterOutputSchema = z.object({
  newTopics: z.array(NewTopicSchema),
  assignments: z.array(AssignmentSchema),
});

export type FeedbackClusterOutput = z.infer<typeof FeedbackClusterOutputSchema>;
export type FeedbackClusterNewTopic = z.infer<typeof NewTopicSchema>;
export type FeedbackClusterAssignment = z.infer<typeof AssignmentSchema>;
export type FeedbackClusterAssignmentItem = z.infer<typeof AssignmentItemSchema>;

export const FEEDBACK_CLUSTER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['newTopics', 'assignments'],
  properties: {
    newTopics: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tempId', 'title', 'description'],
        properties: {
          tempId: {
            type: 'string',
            pattern: '^new_\\d+$',
            description: 'Локальный id новой темы внутри ответа (new_1, new_2).',
          },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['messageId', 'items'],
        properties: {
          messageId: { type: 'string', minLength: 1 },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'topicRef'],
              properties: {
                text: { type: 'string', minLength: 1, maxLength: 2_000 },
                topicRef: {
                  type: 'string',
                  minLength: 1,
                  description: 'id existingTopic | tempId newTopic | "discard".',
                },
              },
            },
          },
        },
      },
    },
  },
};

export interface FeedbackClusterReferenceValidation {
  ok: boolean;
  errors: string[];
}

export function validateFeedbackClusterReferences(
  output: FeedbackClusterOutput,
  input: FeedbackClusterInput,
): FeedbackClusterReferenceValidation {
  const errors: string[] = [];

  const existingIds = new Set(input.existingTopics.map((t) => t.id));
  const messageIds = new Set(input.messages.map((m) => m.id));

  const seenTempIds = new Set<string>();
  for (const nt of output.newTopics) {
    if (seenTempIds.has(nt.tempId)) {
      errors.push(`duplicate tempId in newTopics: ${nt.tempId}`);
    }
    seenTempIds.add(nt.tempId);
  }

  for (const a of output.assignments) {
    if (!messageIds.has(a.messageId)) {
      errors.push(`assignment.messageId not in input.messages: ${a.messageId}`);
    }
    for (const item of a.items) {
      if (item.topicRef === 'discard') continue;
      const isExisting = existingIds.has(item.topicRef);
      const isNew = seenTempIds.has(item.topicRef);
      if (!isExisting && !isNew) {
        errors.push(
          `unknown topicRef in message=${a.messageId}: "${item.topicRef}" ` +
            '(не существует в existingTopics и не объявлен в newTopics)',
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export const FEEDBACK_CLUSTER_LLM_PARAMS = {
  temperature: 0.2,
  maxTokens: 8_000,
  responseFormat: {
    type: 'json_schema' as const,
    name: FEEDBACK_CLUSTER_SCHEMA_NAME,
    schema: FEEDBACK_CLUSTER_JSON_SCHEMA,
    strict: true as const,
  },
} as const;
