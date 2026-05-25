/**
 * Snapshot-тест сборки промта `multi-query.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `DIALOG_MULTI_QUERY_SYSTEM_PROMPT` (constant — guard от
 *     случайных правок порядка/смысла трёх формулировок);
 *   - текст user, который собирает `buildMultiQueryUserPrompt`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  buildMultiQueryUserPrompt,
  DIALOG_MULTI_QUERY_SYSTEM_PROMPT,
} from './multi-query.prompt';

describe('dialog-layer multi-query — snapshot сборки промта', () => {
  it('system prompt стабилен (правила 3 формулировок)', () => {
    expect(DIALOG_MULTI_QUERY_SYSTEM_PROMPT).toMatchInlineSnapshot(`
      "Ты — помощник по расширению
      поиска: даю вопрос — возвращаешь 3 разные формулировки того же запроса.

      Принципы:
      1. Первая формулировка — синонимическая (другие термины, тот же смысл).
      2. Вторая — с другой перспективы (тот же объект, иная точка зрения).
      3. Третья — более конкретная/узкая (одна из подцелей оригинального вопроса).

      Все 3 формулировки должны быть полными вопросами на том же языке. Не
      повторяй оригинальный вопрос дословно.

      Отвечай СТРОГО в формате JSON:
      {"queries": ["<формулировка 1>", "<формулировка 2>", "<формулировка 3>"]}
      без markdown-блоков, без префиксов."
    `);
  });

  it('user prompt стабилен для exploratory-вопроса', () => {
    const user = buildMultiQueryUserPrompt({
      question: 'Что мы обсуждали про найм backend-разработчиков в Q1?',
    });
    expect(user).toMatchInlineSnapshot(`
      "Оригинальный вопрос: Что мы обсуждали про найм backend-разработчиков в Q1?

      3 формулировки:"
    `);
  });
});
