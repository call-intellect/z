/**
 * Snapshot-тест сборки промпта `query-understand.prompt.ts` (модуль понимания
 * запроса, ТЗ 2026-06-14, схема dialog_multi_query_v2).
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `DIALOG_QUERY_UNDERSTAND_SYSTEM_PROMPT` (guard от случайных правок);
 *   - текст user, который собирает `buildQueryUnderstandUserPrompt`
 *     (summary + history + question).
 *
 * Обновлять только при ОСОЗНАННОМ изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  DIALOG_QUERY_UNDERSTAND_SYSTEM_PROMPT,
  buildQueryUnderstandUserPrompt,
} from './query-understand.prompt';

describe('dialog-layer query-understand — snapshot сборки промпта', () => {
  it('system prompt стабилен (cache-friendly, few-shot внутри)', () => {
    expect(DIALOG_QUERY_UNDERSTAND_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it('user prompt стабилен для follow-up с summary + history', () => {
    const user = buildQueryUnderstandUserPrompt({
      summary: 'Обсуждали продукт Маяк для логистики, запуск в августе.',
      history: [
        { role: 'user', content: 'Что у нас по продукту «Маяк»?' },
        {
          role: 'assistant',
          content: 'Это новая система для логистики, запуск в августе.',
        },
      ],
      question: 'а сколько это стоит?',
    });
    expect(user).toMatchInlineSnapshot(`
      "Краткое содержание диалога:
      Обсуждали продукт Маяк для логистики, запуск в августе.

      Последние сообщения диалога:
      — Пользователь: Что у нас по продукту «Маяк»?
      — Ассистент: Это новая система для логистики, запуск в августе.

      Реплика пользователя:
      а сколько это стоит?

      Три вопроса:"
    `);
  });

  it('user prompt: пустые summary/history → человекочитаемые плейсхолдеры', () => {
    const user = buildQueryUnderstandUserPrompt({
      summary: null,
      history: [],
      question: 'Какие риски по проекту внедрения 1С?',
    });
    expect(user).toMatchInlineSnapshot(`
      "Краткое содержание диалога:
      (нет)

      Последние сообщения диалога:
      (диалог только начался)

      Реплика пользователя:
      Какие риски по проекту внедрения 1С?

      Три вопроса:"
    `);
  });
});
