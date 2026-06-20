/**
 * Snapshot-тест сборки промта `regulation-extract.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `REGULATION_EXTRACT_SYSTEM_PROMPT` (guard, что обёртки
 *     `withEdgeCasePolicy` / `withExtractedNotConfirmedNote` /
 *     `withConfidenceCalibration` / `withAsrNote` подмешиваются, а
 *     интерполяция `${EXTRACTION_STATUS_RU.join(' | ')}` сохранена);
 *   - JSON-схему `REGULATION_EXTRACT_JSON_SCHEMA`;
 *   - текст user, который собирает `REGULATION_EXTRACT_USER_TEMPLATE`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  REGULATION_EXTRACT_JSON_SCHEMA,
  REGULATION_EXTRACT_SYSTEM_PROMPT,
  REGULATION_EXTRACT_USER_TEMPLATE,
} from './regulation-extract.prompt';

describe('regulation-extract — snapshot сборки промта', () => {
  it('system prompt стабилен (EDGE_CASE_POLICY + EXTRACTED_NOT_CONFIRMED + CONFIDENCE_CALIBRATION + ASR_NOTE)', () => {
    expect(REGULATION_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(REGULATION_EXTRACT_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('user prompt стабилен для блока «Проверка договоров»', () => {
    const user = REGULATION_EXTRACT_USER_TEMPLATE({
      blockName: 'Проверка договоров',
      criticalQuestion: 'Как проходят договоры с подрядчиками?',
      trustedAnswer: 'Через юр-проверку до подписания, ответ юриста за 3 рабочих дня.',
      signalType: 'regulation',
      tags: ['legal', 'process'],
      evidenceQuotes: [
        'Все договоры с подрядчиком сначала уходят юристу на проверку, юрист отвечает в течение 3 рабочих дней.',
      ],
      ownerCompanyPrior: 'неизвестно',
      meetingExternalLikely: false,
    });
    expect(user).toMatchSnapshot('user');
  });
});
