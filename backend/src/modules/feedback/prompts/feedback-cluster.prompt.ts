/**
 * ТЗ 2026-05-25 user-feedback-with-ai-clustering, Фаза 4 — системный промпт
 * AI-агента кластеризации канала «Ваши предложения».
 *
 * Контракт:
 *   - taskType: `feedback.cluster` (зарегистрирован в `LlmTaskType` /
 *     `ALL_LLM_TASK_TYPES` в `ai/services/llm-router.service.ts`).
 *   - Промпт admin-editable через registry в БД (Z-Admin → Prompt Templates,
 *     scope=system). Этот файл — **code-fallback**: используется, когда в БД
 *     нет активной версии для ключа `feedback.cluster`.
 *   - Provider chain (см. seed `seed-llm-task-routes-feedback-cluster.ts`):
 *       primary   — deepseek `deepseek-v4-pro`
 *       secondary — openai-via-proxy `gpt-5.4`
 *       tertiary  — kie `gemini-3-pro`
 *       quaternary (через grsai) — `gemini-3-pro` (резерв 2-го уровня)
 *
 * Особенности задачи:
 *   - Один пользовательский батч (≤200 сообщений) обрабатывается ОДНИМ
 *     вызовом — модель сразу делит сообщения на тезисы и атрибутирует их
 *     к existing/new topic'ам.
 *   - response_format = json_object, temperature = 0.2, max_tokens = 8000.
 *   - Валидация выхода — двухуровневая: Zod-схема `FeedbackClusterOutputSchema`
 *     (структура) + `validateFeedbackClusterReferences` (ссылочная целостность
 *     `topicRef` и `messageId`).
 *   - Тональность (жалоба/запрос/благодарность) — часть смысла тезиса, НЕ
 *     отдельная dimension (см. ТЗ §«Промпт агента»).
 *   - Новый топик создаётся ТОЛЬКО когда (a) 2+ тезисов в батче не подходят
 *     ни в один existing, ИЛИ (b) тема принципиально новая. В прочих случаях
 *     ищется ближайший existing — иначе кластеризация деградирует в «1 топик
 *     на 1 тезис».
 *   - Мусорные/неразборчивые тезисы → `topicRef = "discard"`.
 */

import { z } from 'zod';

/**
 * Ключ промпта в admin registry. snake_case + точка как разделитель доменов —
 * в соответствии с naming convention skill `z-ai-agent-rules` (§Naming).
 */
export const FEEDBACK_CLUSTER_PROMPT_KEY = 'feedback.cluster' as const;

/**
 * Имя JSON-схемы выхода (для логов, alert'ов на schema-version mismatch).
 */
export const FEEDBACK_CLUSTER_SCHEMA_NAME = 'feedback_cluster_v1' as const;

/**
 * taskType для LlmRouter. Совпадает со значением, добавленным в
 * `LlmTaskType` union в `llm-router.service.ts`.
 */
export const FEEDBACK_CLUSTER_TASK_TYPE = 'feedback.cluster' as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Вход агента — типы для строителя user-сообщения.
// ─────────────────────────────────────────────────────────────────────────────

export interface FeedbackClusterInputMessage {
  /** Стабильный id сообщения (FeedbackMessage.id из БД). */
  id: string;
  /** Кто прислал (для возможной дедупликации стиля; имя не передаём). */
  userId: string;
  /** ISO-строка (UTC). */
  createdAt: string;
  /** Сырой текст сообщения, как написал пользователь. */
  text: string;
}

export interface FeedbackClusterInputTopic {
  /** Стабильный id топика (FeedbackTopic.id из БД). */
  id: string;
  /** Заголовок топика (≤80 символов в типичном случае). */
  title: string;
  /** Короткое описание (1-2 предложения). */
  description: string;
}

export interface FeedbackClusterInput {
  messages: FeedbackClusterInputMessage[];
  existingTopics: FeedbackClusterInputTopic[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Системный промпт (code-fallback).
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Сборка user-сообщения для модели. Передаёт строго тот же JSON-контракт,
 * что описан в системном промпте — без лишних полей, без локализации.
 */
export const FEEDBACK_CLUSTER_USER_TEMPLATE = (
  input: FeedbackClusterInput,
): string => {
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

// ─────────────────────────────────────────────────────────────────────────────
// 3. Zod-схема выхода + JSON Schema для response_format.
// ─────────────────────────────────────────────────────────────────────────────

const NewTopicSchema = z.object({
  /** Локальный id новой темы внутри ответа. */
  tempId: z.string().regex(/^new_\d+$/),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
});

const AssignmentItemSchema = z.object({
  text: z.string().min(1).max(2_000),
  /**
   * Либо id из `existingTopics`, либо tempId из `newTopics`, либо строка
   * "discard". Ссылочная целостность валидируется отдельной функцией
   * `validateFeedbackClusterReferences` — Zod проверяет только формат.
   */
  topicRef: z.string().min(1),
});

const AssignmentSchema = z.object({
  /** id из `input.messages` — проверяется referential-валидатором. */
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

/**
 * JSON Schema для `response_format: { type: 'json_schema' }` (поддерживается
 * DeepSeek V4 + OpenAI Responses; для Ollama tertiary fallback идёт через
 * обычный `json_object` — провайдер отфильтрует неподдерживаемый формат).
 *
 * Намеренно `additionalProperties: false` — модели легче возвращать строго
 * минимальный объект, ошибки парсинга легче ловить.
 */
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
                  description:
                    'id existingTopic | tempId newTopic | "discard".',
                },
              },
            },
          },
        },
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Referential validator (не Zod — нужен доступ к `input`).
// ─────────────────────────────────────────────────────────────────────────────

export interface FeedbackClusterReferenceValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Доп-валидатор поверх Zod-схемы. Проверяет:
 *   1. Каждый `topicRef` либо `"discard"`, либо id из `input.existingTopics`,
 *      либо tempId из `output.newTopics`.
 *   2. Каждый `messageId` из ответа существует во входе (модель не
 *      «выдумала» новых сообщений).
 *   3. Каждый `tempId` в `newTopics` уникален (защита от повторного
 *      создания одной и той же темы).
 *
 * Возвращает агрегированный список ошибок — caller сам решает, делать
 * retry, фейлить job, или сохранять частичный результат.
 */
export function validateFeedbackClusterReferences(
  output: FeedbackClusterOutput,
  input: FeedbackClusterInput,
): FeedbackClusterReferenceValidation {
  const errors: string[] = [];

  const existingIds = new Set(input.existingTopics.map((t) => t.id));
  const messageIds = new Set(input.messages.map((m) => m.id));

  // 1. Уникальность tempId.
  const seenTempIds = new Set<string>();
  for (const nt of output.newTopics) {
    if (seenTempIds.has(nt.tempId)) {
      errors.push(`duplicate tempId in newTopics: ${nt.tempId}`);
    }
    seenTempIds.add(nt.tempId);
  }

  // 2. Каждый assignment.messageId — из input.messages.
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

// ─────────────────────────────────────────────────────────────────────────────
// 5. Параметры вызова LLM (для caller'а — FeedbackDigestService в Фазе 5).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Параметры структурированного вывода и температуры (см. ТЗ §«LLM-router»).
 * Caller (FeedbackDigestService) использует их при сборке LlmCallParams.
 */
export const FEEDBACK_CLUSTER_LLM_PARAMS = {
  temperature: 0.2,
  maxTokens: 8_000,
  responseFormat: { type: 'json_object' as const },
} as const;
