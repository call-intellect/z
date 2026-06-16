import { describe, expect, it } from 'vitest';

import {
  FEEDBACK_CLUSTER_JSON_SCHEMA,
  FEEDBACK_CLUSTER_PROMPT_KEY,
  FEEDBACK_CLUSTER_SCHEMA_NAME,
  FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK,
  FEEDBACK_CLUSTER_TASK_TYPE,
  FEEDBACK_CLUSTER_USER_TEMPLATE,
  FeedbackClusterOutputSchema,
  validateFeedbackClusterReferences,
  type FeedbackClusterInput,
  type FeedbackClusterOutput,
} from './feedback-cluster.prompt';

const FIXTURE_INPUT: FeedbackClusterInput = {
  messages: [
    {
      id: 'msg_1',
      userId: 'user_a',
      createdAt: '2026-05-25T10:00:00.000Z',
      text: 'дайте тёмную тему и почините экспорт',
    },
    {
      id: 'msg_2',
      userId: 'user_b',
      createdAt: '2026-05-25T10:05:00.000Z',
      text: 'спасибо за дашборд директора, отличный',
    },
    {
      id: 'msg_3',
      userId: 'user_c',
      createdAt: '2026-05-25T10:10:00.000Z',
      text: 'asdfqwer',
    },
  ],
  existingTopics: [
    {
      id: 'topic_export',
      title: 'Проблемы с экспортом',
      description: 'Сообщения о падениях/задержках экспорта отчётов.',
    },
    {
      id: 'topic_dashboard_thanks',
      title: 'Благодарности за дашборд директора',
      description: 'Положительные отзывы о дашборде CEO.',
    },
  ],
};

const FIXTURE_OUTPUT_VALID: FeedbackClusterOutput = {
  newTopics: [
    {
      tempId: 'new_1',
      title: 'Запрос тёмной темы',
      description: 'Пользователи хотят добавить тёмную (dark) тему оформления интерфейса.',
    },
  ],
  assignments: [
    {
      messageId: 'msg_1',
      items: [
        { text: 'дайте тёмную тему', topicRef: 'new_1' },
        { text: 'почините экспорт', topicRef: 'topic_export' },
      ],
    },
    {
      messageId: 'msg_2',
      items: [
        {
          text: 'спасибо за дашборд директора, отличный',
          topicRef: 'topic_dashboard_thanks',
        },
      ],
    },
    {
      messageId: 'msg_3',
      items: [{ text: 'asdfqwer', topicRef: 'discard' }],
    },
  ],
};

describe('feedback.cluster — константы', () => {
  it('promptKey совпадает с taskType (для admin registry)', () => {
    expect(FEEDBACK_CLUSTER_PROMPT_KEY).toBe('feedback.cluster');
    expect(FEEDBACK_CLUSTER_TASK_TYPE).toBe('feedback.cluster');
  });

  it('schemaName зафиксирован (для логов)', () => {
    expect(FEEDBACK_CLUSTER_SCHEMA_NAME).toBe('feedback_cluster_v1');
  });

  it('system prompt — non-empty и упоминает обе части задачи', () => {
    expect(FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK).toMatch(/смысловые тезисы/);
    expect(FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK).toMatch(/existingTopics/);
    expect(FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK).toMatch(/discard/);
    expect(FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK).toMatch(/newTopics/);
  });

  it('JSON schema требует newTopics + assignments', () => {
    expect(FEEDBACK_CLUSTER_JSON_SCHEMA.required).toEqual(['newTopics', 'assignments']);
  });
});

describe('feedback.cluster — user template', () => {
  it('включает все messages и existingTopics во входной JSON', () => {
    const rendered = FEEDBACK_CLUSTER_USER_TEMPLATE(FIXTURE_INPUT);
    expect(rendered).toMatch(/msg_1/);
    expect(rendered).toMatch(/msg_2/);
    expect(rendered).toMatch(/msg_3/);
    expect(rendered).toMatch(/topic_export/);
    expect(rendered).toMatch(/topic_dashboard_thanks/);
    expect(rendered).toMatch(/feedback_cluster_v1/);
  });
});

describe('feedback.cluster — Zod-схема', () => {
  it('валидирует корректный ответ модели', () => {
    const parsed = FeedbackClusterOutputSchema.safeParse(FIXTURE_OUTPUT_VALID);
    expect(parsed.success).toBe(true);
  });

  it('отбрасывает tempId без префикса new_', () => {
    const bad = {
      newTopics: [{ tempId: 'topic_x', title: 'X', description: 'Y' }],
      assignments: [],
    };
    const parsed = FeedbackClusterOutputSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('требует обязательные поля newTopics + assignments', () => {
    expect(FeedbackClusterOutputSchema.safeParse({ newTopics: [] }).success).toBe(false);
    expect(FeedbackClusterOutputSchema.safeParse({ assignments: [] }).success).toBe(false);
  });

  it('отбрасывает пустую строку в topicRef', () => {
    const bad = {
      newTopics: [],
      assignments: [
        {
          messageId: 'msg_1',
          items: [{ text: 'тезис', topicRef: '' }],
        },
      ],
    };
    expect(FeedbackClusterOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('feedback.cluster — validateFeedbackClusterReferences', () => {
  it('пропускает корректный ответ', () => {
    const result = validateFeedbackClusterReferences(FIXTURE_OUTPUT_VALID, FIXTURE_INPUT);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('ловит messageId, которого нет во входе', () => {
    const bad: FeedbackClusterOutput = {
      newTopics: [],
      assignments: [
        {
          messageId: 'msg_ghost',
          items: [{ text: 'что-то', topicRef: 'topic_export' }],
        },
      ],
    };
    const result = validateFeedbackClusterReferences(bad, FIXTURE_INPUT);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('msg_ghost'))).toBe(true);
  });

  it('ловит topicRef, который не существует ни в existingTopics, ни в newTopics', () => {
    const bad: FeedbackClusterOutput = {
      newTopics: [],
      assignments: [
        {
          messageId: 'msg_1',
          items: [{ text: 'тезис', topicRef: 'topic_unknown' }],
        },
      ],
    };
    const result = validateFeedbackClusterReferences(bad, FIXTURE_INPUT);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('topic_unknown'))).toBe(true);
  });

  it('пропускает topicRef="discard" даже если discard не объявлен в topics', () => {
    const ok: FeedbackClusterOutput = {
      newTopics: [],
      assignments: [
        {
          messageId: 'msg_1',
          items: [{ text: 'мусор', topicRef: 'discard' }],
        },
      ],
    };
    const result = validateFeedbackClusterReferences(ok, FIXTURE_INPUT);
    expect(result.ok).toBe(true);
  });

  it('ловит дубликаты tempId в newTopics', () => {
    const bad: FeedbackClusterOutput = {
      newTopics: [
        { tempId: 'new_1', title: 'A', description: 'A1' },
        { tempId: 'new_1', title: 'B', description: 'B1' },
      ],
      assignments: [],
    };
    const result = validateFeedbackClusterReferences(bad, FIXTURE_INPUT);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate tempId'))).toBe(true);
  });

  it('разрешает topicRef на свежесозданный newTopic в этом же ответе', () => {
    const ok: FeedbackClusterOutput = {
      newTopics: [{ tempId: 'new_42', title: 'Новая тема', description: 'desc' }],
      assignments: [
        {
          messageId: 'msg_1',
          items: [{ text: 'тезис', topicRef: 'new_42' }],
        },
      ],
    };
    const result = validateFeedbackClusterReferences(ok, FIXTURE_INPUT);
    expect(result.ok).toBe(true);
  });
});
