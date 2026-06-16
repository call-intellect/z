import { describe, expect, it } from 'vitest';

import { IDEA_EXTRACT_SYSTEM_PROMPT, IDEA_EXTRACT_USER_TEMPLATE } from './idea-extract.prompt';

describe('idea-extract — snapshot сборки промта', () => {
  it('system prompt стабилен (CONFIDENCE_CALIBRATION + EDGE_CASE_POLICY + ASR_NOTE в конце)', () => {
    expect(IDEA_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system содержит ASR-ноту (withAsrNote)', () => {
    expect(IDEA_EXTRACT_SYSTEM_PROMPT).toContain('автоматического распознавания речи');
  });

  it('user prompt стабилен для feature_request «Экспорт отчёта в PDF»', () => {
    const user = IDEA_EXTRACT_USER_TEMPLATE({
      blockName: 'Экспорт отчёта в PDF',
      criticalQuestion: 'Нужен ли PDF-экспорт отчёта о встрече?',
      trustedAnswer: 'Да, для отправки юристам — Word не пропускает безопасник клиента.',
      signalType: 'feature_request',
      tags: ['client_request', 'export'],
      evidenceQuotes: [
        'Иван (клиент Sber): нам нужно отдавать отчёт по встрече юристам в PDF — Word не пропускает их безопасник.',
        'Иван: без этого мы не можем рассылать сводки наружу.',
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
