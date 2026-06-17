/**
 * Snapshot-тест промпта `insight-link-to-decisions.prompt.ts` (ТЗ 2026-06-16, пачка 6).
 *
 * Фиксирует:
 *   - текст `INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT` (standalone, гард на call-site);
 *   - JSON-схему `INSIGHT_LINK_TO_DECISIONS_JSON_SCHEMA`;
 *   - сборку USER через `INSIGHT_LINK_TO_DECISIONS_USER_TEMPLATE` (вид сигнала
 *     через `insightKindLabelRu`, статус решения — `decisionStatusLabelRu`,
 *     без голых `(${insightKind})` / `status=${status}`).
 *
 * Обновлять только при осознанном изменении:
 *   bunx vitest run -u src/modules/knowledge-core/prompts/insight-link-to-decisions.snapshot.spec.ts
 */
import { describe, expect, it } from 'vitest';

import {
  INSIGHT_LINK_TO_DECISIONS_JSON_SCHEMA,
  INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT,
  INSIGHT_LINK_TO_DECISIONS_USER_TEMPLATE,
} from './insight-link-to-decisions.prompt';

describe('insight-link-to-decisions — snapshot сборки промпта', () => {
  it('system prompt стабилен', () => {
    expect(INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабильна', () => {
    expect(INSIGHT_LINK_TO_DECISIONS_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('USER подаёт вид сигнала и статус ярлыками', () => {
    const user = INSIGHT_LINK_TO_DECISIONS_USER_TEMPLATE({
      insightKind: 'problem',
      insightStatement: 'Жалобы на качество комплектующих, рост возвратов',
      candidates: [
        {
          id: 'dec_7f3a',
          statement: 'Перешли на поставщика из соседнего региона',
          decidedAt: '2026-05-01',
          status: 'implemented',
        },
        {
          id: 'dec_9b21',
          statement: 'Запустили реферальную программу',
          decidedAt: null,
          status: 'rolled_back',
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
