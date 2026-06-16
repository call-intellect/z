/**
 * Snapshot-тест сборки промта `process-template-extract.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT` (guard, что цепочка
 *     обёрток `withAsrNote(withDecisionDiscriminator(withEdgeCasePolicy(
 *     withConfidenceCalibration(...))))` сохранена и few-shot/self-check на
 *     месте);
 *   - текст user из `PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE` (signalType
 *     подаётся человеческим ярлыком, не кодом).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT,
  PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE,
} from './process-template-extract.prompt';

describe('process-template-extract — snapshot сборки промта', () => {
  it('system prompt стабилен (включает все 4 обёртки)', () => {
    expect(PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system содержит ASR-ноту (withAsrNote)', () => {
    expect(PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT).toContain(
      'автоматического распознавания речи',
    );
  });

  it('user prompt стабилен и подаёт человеческий ярлык signalType', () => {
    const user = PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE({
      blocks: [
        {
          id: 'blk-001',
          signalType: 'process_step',
          criticalQuestion: 'Как онбордим нового клиента?',
          trustedAnswer:
            'Менеджер заводит карточку, юрист готовит договор, бухгалтерия выставляет счёт.',
          quotes: [
            'Когда приходит заявка, менеджер заводит карточку в CRM.',
          ],
        },
      ],
      existingTemplates: [
        { id: 'tpl-1', name: 'Онбординг нового клиента', summary: null },
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
