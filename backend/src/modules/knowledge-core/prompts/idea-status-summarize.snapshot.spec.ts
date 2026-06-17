/**
 * Snapshot-тест промпта `idea-status-summarize.prompt.ts`.
 *
 * Фиксирует текст `IDEA_STATUS_SUMMARIZE_SYSTEM_PROMPT` и сборку USER-шаблона,
 * в которой статусы подаются человеческими ярлыками (`ideaStatusLabelRu`).
 *
 * Обновлять только при осознанном изменении: `bunx vitest run -u`.
 */
import { describe, expect, it } from 'vitest';

import {
  IDEA_STATUS_SUMMARIZE_SYSTEM_PROMPT,
  IDEA_STATUS_SUMMARIZE_USER_TEMPLATE,
} from './idea-status-summarize.prompt';

describe('idea-status-summarize — snapshot сборки промпта', () => {
  it('system prompt стабилен', () => {
    expect(IDEA_STATUS_SUMMARIZE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('user шаблон с причиной — статусы человеческими ярлыками', () => {
    const user = IDEA_STATUS_SUMMARIZE_USER_TEMPLATE({
      ideaStatement: 'Добавить тёмную тему в кабинет',
      oldStatus: 'captured',
      newStatus: 'in_progress',
      reason: 'взяли в текущий спринт',
    });
    expect(user).toMatchSnapshot('user-with-reason');
  });

  it('user шаблон без причины стабилен', () => {
    const user = IDEA_STATUS_SUMMARIZE_USER_TEMPLATE({
      ideaStatement: 'Интеграция с 1С',
      oldStatus: 'in_discussion',
      newStatus: 'rejected',
      reason: null,
    });
    expect(user).toMatchSnapshot('user-no-reason');
  });
});
