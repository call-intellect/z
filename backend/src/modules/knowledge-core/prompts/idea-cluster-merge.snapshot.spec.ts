/**
 * Snapshot-тест промпта `idea-cluster-merge.prompt.ts`.
 *
 * Фиксирует текст `IDEA_CLUSTER_MERGE_SYSTEM_PROMPT` (внутри
 * `withConfidenceCalibration`) и сборку USER-шаблона с кандидатами и без.
 *
 * Обновлять только при осознанном изменении: `bunx vitest run -u`.
 */
import { describe, expect, it } from 'vitest';

import {
  IDEA_CLUSTER_MERGE_SYSTEM_PROMPT,
  IDEA_CLUSTER_MERGE_USER_TEMPLATE,
} from './idea-cluster-merge.prompt';

describe('idea-cluster-merge — snapshot сборки промпта', () => {
  it('system prompt стабилен', () => {
    expect(IDEA_CLUSTER_MERGE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('user шаблон с кандидатами стабилен', () => {
    const user = IDEA_CLUSTER_MERGE_USER_TEMPLATE({
      ideaStatement: 'Массовое назначение исполнителей в задачах в один клик',
      ideaRationale: 'Сейчас приходится назначать по одному',
      candidates: [
        {
          id: 'k_7f3a',
          name: 'Удобство работы с задачами',
          description: 'Идеи про эргономику задач',
          sampleStatements: ['Drag-n-drop задач', 'Быстрый фильтр'],
        },
      ],
    });
    expect(user).toMatchSnapshot('user-with-candidates');
  });

  it('user шаблон без кандидатов стабилен', () => {
    const user = IDEA_CLUSTER_MERGE_USER_TEMPLATE({
      ideaStatement: 'Хорошо бы улучшить тёмную тему',
      ideaRationale: null,
      candidates: [],
    });
    expect(user).toMatchSnapshot('user-no-candidates');
  });
});
