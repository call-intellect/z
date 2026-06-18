/**
 * Snapshot-тест промпта `goal-task-link.prompt.ts` (ТЗ 2026-06-16, пачка 6).
 *
 * Фиксирует:
 *   - текст `GOAL_TASK_LINK_SYSTEM_PROMPT` (standalone: без `withAsrNote` и без
 *     `withConfidenceCalibration` — шкала силы связи встроена в тело);
 *   - JSON-схему `GOAL_TASK_LINK_JSON_SCHEMA`;
 *   - сборку USER через `GOAL_TASK_LINK_USER_TEMPLATE`.
 *
 * Обновлять только при осознанном изменении:
 *   bunx vitest run -u src/modules/knowledge-core/prompts/goal-task-link.snapshot.spec.ts
 */
import { describe, expect, it } from 'vitest';

import {
  GOAL_TASK_LINK_JSON_SCHEMA,
  GOAL_TASK_LINK_SYSTEM_PROMPT,
  GOAL_TASK_LINK_USER_TEMPLATE,
} from './goal-task-link.prompt';

describe('goal-task-link — snapshot сборки промпта', () => {
  it('system prompt стабилен', () => {
    expect(GOAL_TASK_LINK_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабильна', () => {
    expect(GOAL_TASK_LINK_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('USER стабилен', () => {
    const user = GOAL_TASK_LINK_USER_TEMPLATE({
      goalName: 'Увеличить выручку на 20% за квартал',
      tasks: [
        { id: 'task_1', title: 'Запустить рекламную кампанию' },
        { id: 'task_2', title: 'Обновить корпоративный логотип' },
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
