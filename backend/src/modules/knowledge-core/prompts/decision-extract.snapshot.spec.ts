/**
 * Snapshot-тест сборки промта `decision-extract.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `DECISION_EXTRACT_SYSTEM_PROMPT` (system — guard, что
 *     `withConfidenceCalibration` всё ещё корректно подмешивает шкалу
 *     и `withEdgeCasePolicy` дописывает edge-case политику в конец);
 *   - текст user, который собирает `DECISION_EXTRACT_USER_TEMPLATE`
 *     для фикстуры с цитатами и контекстом.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  DECISION_EXTRACT_SYSTEM_PROMPT,
  DECISION_EXTRACT_USER_TEMPLATE,
} from './decision-extract.prompt';

describe('decision-extract — snapshot сборки промта', () => {
  it('system prompt стабилен (включает CONFIDENCE_CALIBRATION + EDGE_CASE_POLICY)', () => {
    expect(DECISION_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('user prompt стабилен для блока «Поставщик SMS» с цитатами и контекстом', () => {
    const user = DECISION_EXTRACT_USER_TEMPLATE({
      blockName: 'Поставщик SMS',
      criticalQuestion: 'Какой провайдер SMS выбираем для рассылок?',
      trustedAnswer: 'Выбран SMS Aero вместо Twilio.',
      signalType: 'decision',
      tags: ['vendor', 'sms', 'q2-2026'],
      evidenceQuotes: [
        'Иван: смотрели Twilio и SMS Aero.',
        'Маша: Twilio дорогой в России, SMS Aero справился с тестом доставки в 99%.',
        'Сергей: окей, идём с SMS Aero, договор подписываем на квартал.',
      ],
      contextQuotes: [
        'Маша: до этого пользовались внутренним SMS-шлюзом, но он лёг в марте.',
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
