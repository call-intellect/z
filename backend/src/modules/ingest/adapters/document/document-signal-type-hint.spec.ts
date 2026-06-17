import { describe, expect, it } from 'vitest';

import { docTypeToSignalTypeHint } from './document.adapter';

/**
 * Ф6 (knowledge-base-redesign) — детерминированный маппинг ручного `docType`
 * документа в `signalTypeHint`. Чистая функция, без моков/сети.
 */
describe('docTypeToSignalTypeHint', () => {
  const cases: Array<[string | null | undefined, string | undefined]> = [
    ['regulation', 'regulation'],
    // policy → 'regulation': 'policy' НЕ отдельное значение enum SignalType,
    // policy-блоки идут через 'regulation' → Specialist 3.1 → upsertPolicy при
    // kind=policy. Документ детерминированно доходит до экстрактора орг-документов.
    ['policy', 'regulation'],
    ['process', 'process_step'],
    ['instruction', 'process_step'],
    ['job_description', undefined],
    ['other', undefined],
    [null, undefined],
    [undefined, undefined],
  ];

  it.each(cases)('docType=%s → %s', (input, expected) => {
    expect(docTypeToSignalTypeHint(input)).toBe(expected);
  });
});
