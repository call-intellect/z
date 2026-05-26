import { describe, expect, it } from 'vitest';

import { parseCheckinSentimentBatchToolInput } from './checkin-sentiment.prompt';

/**
 * Unit-тесты для `parseCheckinSentimentBatchToolInput`.
 *
 * Источник:
 *   - plans/tz/2026-05-26-checkin-batch-cron-tests.md §2.2 (8 кейсов).
 *   - plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md §6
 *     (batch-инфраструктура для checkin-sentiment).
 *   - Коммит 3cba11d (Фаза 2 миграции LLM на DeepSeek-V4-Pro).
 *
 * Тесты фиксируют ФАКТИЧЕСКОЕ поведение парсера (silent-skip кривых
 * элементов + throw на дубликат checkInId — решение пользователя
 * 2026-05-26).
 */
describe('parseCheckinSentimentBatchToolInput', () => {
  it('кейс 1: валидный input с 10 элементами — массив 10 в исходном порядке', () => {
    const sentiments = ['green', 'yellow', 'red'] as const;
    const results = Array.from({ length: 10 }, (_, i) => ({
      checkInId: `cin-${i}`,
      sentiment: sentiments[i % 3],
      rationale: `обоснование ${i}`,
    }));
    const out = parseCheckinSentimentBatchToolInput({ results });
    expect(out).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(out[i]!.checkInId).toBe(`cin-${i}`);
      expect(out[i]!.sentiment).toBe(sentiments[i % 3]);
      expect(out[i]!.rationale).toBe(`обоснование ${i}`);
    }
  });

  it('кейс 2: невалидный input (null/undefined/строка/число/массив) → []', () => {
    expect(parseCheckinSentimentBatchToolInput(null)).toEqual([]);
    expect(parseCheckinSentimentBatchToolInput(undefined)).toEqual([]);
    expect(parseCheckinSentimentBatchToolInput('строка')).toEqual([]);
    expect(parseCheckinSentimentBatchToolInput(42)).toEqual([]);
    // массив — !objet, проходит проверку `typeof === 'object'`, но `.results`
    // у него undefined → не Array → []
    expect(parseCheckinSentimentBatchToolInput([])).toEqual([]);
  });

  it('кейс 3: input.results не массив → []', () => {
    expect(parseCheckinSentimentBatchToolInput({ results: 'строка' })).toEqual(
      [],
    );
    expect(parseCheckinSentimentBatchToolInput({ results: null })).toEqual([]);
    expect(parseCheckinSentimentBatchToolInput({ results: {} })).toEqual([]);
    expect(parseCheckinSentimentBatchToolInput({ results: 42 })).toEqual([]);
  });

  it('кейс 4: невалидный sentiment-enum → элемент молча пропускается', () => {
    const input = {
      results: [
        { checkInId: 'a', sentiment: 'green', rationale: 'ок' },
        { checkInId: 'b', sentiment: 'PURPLE', rationale: 'bad' },
        { checkInId: 'c', sentiment: 'red', rationale: '!' },
      ],
    };
    const out = parseCheckinSentimentBatchToolInput(input);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.checkInId)).toEqual(['a', 'c']);
    expect(out[0]!.sentiment).toBe('green');
    expect(out[1]!.sentiment).toBe('red');
  });

  it('кейс 5: checkInId не строка → элемент пропускается', () => {
    const input = {
      results: [
        { checkInId: 42, sentiment: 'green', rationale: '!' },
        { checkInId: 'b', sentiment: 'green', rationale: '!' },
        { checkInId: null, sentiment: 'red', rationale: '!' },
        { checkInId: undefined, sentiment: 'yellow', rationale: '!' },
      ],
    };
    const out = parseCheckinSentimentBatchToolInput(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.checkInId).toBe('b');
  });

  it('кейс 6a: отсутствующий rationale → подставляется пустая строка', () => {
    const input = {
      results: [{ checkInId: 'a', sentiment: 'green' }],
    };
    const out = parseCheckinSentimentBatchToolInput(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.rationale).toBe('');
  });

  it('кейс 6b: rationale не строка (число) → подставляется пустая строка', () => {
    const input = {
      results: [{ checkInId: 'a', sentiment: 'green', rationale: 42 }],
    };
    const out = parseCheckinSentimentBatchToolInput(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.rationale).toBe('');
  });

  it('кейс 6c: длинный rationale обрезается до 1000 символов', () => {
    const input = {
      results: [
        {
          checkInId: 'a',
          sentiment: 'green',
          rationale: 'X'.repeat(2000),
        },
      ],
    };
    const out = parseCheckinSentimentBatchToolInput(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.rationale).toHaveLength(1000);
    expect(out[0]!.rationale).toBe('X'.repeat(1000));
  });

  it('кейс 7: пустой results [] → []', () => {
    expect(parseCheckinSentimentBatchToolInput({ results: [] })).toEqual([]);
  });

  it('кейс 8: дубликат checkInId → throw Error(/дубликат/)', () => {
    const input = {
      results: [
        { checkInId: 'a', sentiment: 'green', rationale: '!' },
        { checkInId: 'a', sentiment: 'red', rationale: '!' },
      ],
    };
    expect(() => parseCheckinSentimentBatchToolInput(input)).toThrow(
      /дубликат/,
    );
  });
});
