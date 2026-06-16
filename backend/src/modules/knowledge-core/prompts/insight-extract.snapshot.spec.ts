/**
 * Snapshot-тест сборки промта `insight-extract.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `INSIGHT_EXTRACT_SYSTEM_PROMPT` (guard, что обёртки
 *     `withDecisionDiscriminator` / `withEdgeCasePolicy` /
 *     `withConfidenceCalibration` / `withAsrNote` всё ещё корректно
 *     подмешивают свои блоки);
 *   - JSON-схему `INSIGHT_EXTRACT_JSON_SCHEMA`;
 *   - текст user, который собирает `INSIGHT_EXTRACT_USER_TEMPLATE`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  INSIGHT_EXTRACT_JSON_SCHEMA,
  INSIGHT_EXTRACT_SYSTEM_PROMPT,
  INSIGHT_EXTRACT_USER_TEMPLATE,
} from './insight-extract.prompt';

describe('insight-extract — snapshot сборки промта', () => {
  it('system prompt стабилен (DECISION_DISCRIMINATOR + EDGE_CASE_POLICY + CONFIDENCE_CALIBRATION + ASR_NOTE)', () => {
    expect(INSIGHT_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(INSIGHT_EXTRACT_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('user prompt стабилен для блока «Загрузка отчётов»', () => {
    const user = INSIGHT_EXTRACT_USER_TEMPLATE({
      blockName: 'Загрузка отчётов',
      criticalQuestion: 'Почему клиенты жалуются на отчёты?',
      trustedAnswer: 'Отчёт грузится около минуты, часть клиентов не дожидается.',
      signalType: 'pain',
      tags: ['report', 'performance'],
      evidenceQuotes: [
        'Клиенты жалуются: отчёт грузится по минуте, кто-то уже не дожидается.',
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
