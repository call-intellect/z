/**
 * Snapshot-тест сборки промта `experiment-extract.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `EXPERIMENT_EXTRACT_SYSTEM_PROMPT` (guard, что обёртки
 *     `withDecisionDiscriminator` / `withEdgeCasePolicy` /
 *     `withConfidenceCalibration` / `withAsrNote` подмешиваются);
 *   - JSON-схему `EXPERIMENT_EXTRACT_JSON_SCHEMA`;
 *   - текст user, который собирает `EXPERIMENT_EXTRACT_USER_TEMPLATE`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_EXTRACT_JSON_SCHEMA,
  EXPERIMENT_EXTRACT_SYSTEM_PROMPT,
  EXPERIMENT_EXTRACT_USER_TEMPLATE,
} from './experiment-extract.prompt';

describe('experiment-extract — snapshot сборки промта', () => {
  it('system prompt стабилен (DECISION_DISCRIMINATOR + EDGE_CASE_POLICY + CONFIDENCE_CALIBRATION + ASR_NOTE)', () => {
    expect(EXPERIMENT_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(EXPERIMENT_EXTRACT_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('user prompt стабилен для блока-гипотезы про время рассылки', () => {
    const user = EXPERIMENT_EXTRACT_USER_TEMPLATE({
      signalType: 'hypothesis',
      blockName: 'Время рассылки',
      criticalQuestion: 'Когда лучше слать рассылку?',
      trustedAnswer: 'Проверим утреннюю рассылку против вечерней.',
      tags: ['marketing', 'experiment'],
      evidenceQuotes: [
        'Попробуем рассылку в 9 утра вместо 18 — гипотеза, что открываемость будет выше.',
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
