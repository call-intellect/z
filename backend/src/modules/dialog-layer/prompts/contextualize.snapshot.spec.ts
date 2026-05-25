/**
 * Snapshot-тест сборки промта `contextualize.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT` (constant — guard от
 *     случайных правок правил standalone-формулировки);
 *   - текст user, который собирает `buildContextualizeUserPrompt` для
 *     двух фикстур: с summary+history и без summary (только последний
 *     вопрос).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  buildContextualizeUserPrompt,
  DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT,
} from './contextualize.prompt';

describe('dialog-layer contextualize — snapshot сборки промта', () => {
  it('system prompt стабилен (правила standalone-формулировки)', () => {
    expect(DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('user prompt стабилен с summary + history + текущим вопросом', () => {
    const user = buildContextualizeUserPrompt({
      summary:
        'Обсуждали ценообразование продукта X для рынка СНГ, упоминался конкурент Y.',
      history: [
        {
          role: 'user',
          content: 'Расскажи про продукт X.',
        },
        {
          role: 'assistant',
          content:
            'Продукт X — SaaS-платформа для аналитики встреч. Тарифы от 5к до 50к/мес.',
        },
      ],
      question: 'А сколько стоит?',
    });
    expect(user).toMatchSnapshot('user-with-history');
  });

  it('user prompt стабилен без summary и без history (только вопрос)', () => {
    const user = buildContextualizeUserPrompt({
      summary: null,
      history: [],
      question: 'Кто отвечает за миграцию на новый CRM?',
    });
    expect(user).toMatchSnapshot('user-question-only');
  });
});
