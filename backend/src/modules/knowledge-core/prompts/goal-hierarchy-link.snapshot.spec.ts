/**
 * Snapshot-тест промпта `goal-hierarchy-link.prompt.ts` (ТЗ 2026-06-16, пачка 6).
 *
 * Фиксирует:
 *   - текст `GOAL_HIERARCHY_LINK_SYSTEM_PROMPT` (тело в `withConfidenceCalibration`,
 *     без `withAsrNote`);
 *   - JSON-схему `GOAL_HIERARCHY_LINK_JSON_SCHEMA`;
 *   - сборку USER через `GOAL_HIERARCHY_LINK_USER_TEMPLATE` (ярлыки горизонта
 *     через `goalHorizonLabelRu`, без голого `горизонт=<код>`).
 *
 * Обновлять только при осознанном изменении:
 *   bunx vitest run -u src/modules/knowledge-core/prompts/goal-hierarchy-link.snapshot.spec.ts
 */
import { describe, expect, it } from 'vitest';

import {
  GOAL_HIERARCHY_LINK_JSON_SCHEMA,
  GOAL_HIERARCHY_LINK_SYSTEM_PROMPT,
  GOAL_HIERARCHY_LINK_USER_TEMPLATE,
} from './goal-hierarchy-link.prompt';

describe('goal-hierarchy-link — snapshot сборки промпта', () => {
  it('system prompt стабилен', () => {
    expect(GOAL_HIERARCHY_LINK_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабильна', () => {
    expect(GOAL_HIERARCHY_LINK_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('USER подаёт горизонт ярлыком', () => {
    const user = GOAL_HIERARCHY_LINK_USER_TEMPLATE({
      draftStatement: 'Достичь годовой выручки 10 млн ₽',
      draftHorizon: 'annual',
      candidates: [
        {
          id: 'goal_1',
          name: 'Вырасти в выручке за год',
          horizon: 'annual',
          description: 'рост за счёт продаж',
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
