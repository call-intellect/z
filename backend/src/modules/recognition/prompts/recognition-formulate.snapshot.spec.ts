/**
 * Snapshot-тест сборки промта `recognition-formulate.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `RECOGNITION_FORMULATE_SYSTEM_PROMPT` (constant — guard от
 *     случайных правок этических правил Recognition Agent);
 *   - текст user, который собирает `RECOGNITION_FORMULATE_USER_TEMPLATE`
 *     для типичных типов благодарностей.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  RECOGNITION_FORMULATE_SYSTEM_PROMPT,
  RECOGNITION_FORMULATE_USER_TEMPLATE,
} from './recognition-formulate.prompt';

describe('recognition-formulate — snapshot сборки промта', () => {
  it('system prompt стабилен (этические правила)', () => {
    expect(RECOGNITION_FORMULATE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('user prompt стабилен для thanks_comment от коллеги', () => {
    const user = RECOGNITION_FORMULATE_USER_TEMPLATE({
      type: 'thanks_comment',
      toUserName: 'Сергей',
      fromUserName: 'Маша',
      payload: {
        commentExcerpt: 'Очень полезный разбор, спасибо!',
        commentedOn: 'отчёт о встрече planning-2026-05-22',
      },
    });
    expect(user).toMatchSnapshot('user-thanks-comment');
  });

  it('user prompt стабилен для weekly_summary от AI (без fromUserName)', () => {
    const user = RECOGNITION_FORMULATE_USER_TEMPLATE({
      type: 'weekly_summary',
      toUserName: 'Анна',
      fromUserName: null,
      payload: {
        meetingsAttended: 7,
        commentsLeft: 12,
        decisionsCo_authored: 3,
      },
    });
    expect(user).toMatchSnapshot('user-weekly-summary');
  });
});
