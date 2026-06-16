import { describe, expect, it } from 'vitest';

import fixtures from './__fixtures__/classify-fixtures.json';

const ENABLE_EVAL = process.env['CLASSIFY_ACCURACY_EVAL'] === '1';

describe('classify-fixtures.json — структура (always-on)', () => {
  it('30 фикстур на daily_plan_morning', () => {
    expect(fixtures.daily_plan_morning).toHaveLength(30);
    expect(fixtures.daily_plan_morning.every((f) => f.expected === 'daily_plan_morning')).toBe(
      true,
    );
  });

  it('30 фикстур на daily_report_evening', () => {
    expect(fixtures.daily_report_evening).toHaveLength(30);
    expect(fixtures.daily_report_evening.every((f) => f.expected === 'daily_report_evening')).toBe(
      true,
    );
  });

  it('30 фикстур на note (включая ловушки про план на отпуск/квартал)', () => {
    expect(fixtures.note).toHaveLength(30);
    expect(fixtures.note.every((f) => f.expected === 'note')).toBe(true);
    const noteTexts = fixtures.note.map((f) => f.question.toLowerCase());
    expect(noteTexts.some((t) => t.includes('отпуск'))).toBe(true);
    expect(noteTexts.some((t) => t.includes('квартал'))).toBe(true);
    expect(noteTexts.some((t) => t.includes('встреч'))).toBe(true);
  });

  it('30 регрессионных фикстур на 4 chat-категории', () => {
    expect(fixtures.regression_chat).toHaveLength(30);
    const intents = new Set(fixtures.regression_chat.map((f) => f.expected));
    expect(intents).toEqual(new Set(['factual', 'exploratory', 'analytical', 'clone_roleplay']));
  });
});

describe.skipIf(!ENABLE_EVAL)('classify accuracy gate (требует LLM)', () => {
  it('TODO: запустить QueryClassifierService на 120 фикстурах', () => {
    expect(ENABLE_EVAL).toBe(true);
  });
});
