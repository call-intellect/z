/**
 * Snapshot-тест сборки промта `goal-extract.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `GOAL_EXTRACT_SYSTEM_PROMPT` (guard, что
 *     `withConfidenceCalibration` подмешивает шкалу, `withAsrNote` дописывает
 *     ASR-ноту в конец, правило «outcome, а не output» и 3 few-shot на месте);
 *   - текст user из `GOAL_EXTRACT_USER_TEMPLATE` (signalType подаётся
 *     человеческим ярлыком, не кодом).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  GOAL_EXTRACT_SYSTEM_PROMPT,
  GOAL_EXTRACT_USER_TEMPLATE,
} from './goal-extract.prompt';

describe('goal-extract — snapshot сборки промта', () => {
  it('system prompt стабилен (включает CONFIDENCE_CALIBRATION + ASR_NOTE)', () => {
    expect(GOAL_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system сохраняет правило outcome≠output', () => {
    expect(GOAL_EXTRACT_SYSTEM_PROMPT).toContain('outcome, а не output');
  });

  it('system содержит ASR-ноту (withAsrNote)', () => {
    expect(GOAL_EXTRACT_SYSTEM_PROMPT).toContain(
      'автоматического распознавания речи',
    );
  });

  it('user prompt стабилен и подаёт человеческий ярлык signalType', () => {
    const user = GOAL_EXTRACT_USER_TEMPLATE({
      blockName: 'План на квартал',
      criticalQuestion: 'Какая цель на квартал?',
      trustedAnswer: '100 встреч с потенциальными клиентами.',
      signalType: 'commitment',
      tags: ['sales', 'q2-2026'],
      evidenceQuotes: [
        'Сергей: к концу квартала нам нужно 100 встреч, сейчас около 20.',
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
