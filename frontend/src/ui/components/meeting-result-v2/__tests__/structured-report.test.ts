import { describe, expect, it } from 'vitest';

import {
  isEmptyStructuredValue,
  structuredFieldLabel,
} from '../structured-report';

describe('structuredFieldLabel', () => {
  it('маппит известные ключи на русские заголовки', () => {
    expect(structuredFieldLabel('tasks')).toBe('Задачи');
    expect(structuredFieldLabel('next_step')).toBe('Следующий шаг');
    expect(structuredFieldLabel('blockers')).toBe('Блокеры');
  });

  it('неизвестный snake_case → «Snake case»', () => {
    expect(structuredFieldLabel('foo_bar')).toBe('Foo bar');
  });

  it('пустую строку возвращает как есть (сам key)', () => {
    expect(structuredFieldLabel('')).toBe('');
  });
});

describe('isEmptyStructuredValue', () => {
  it('null/undefined/пустая строка/пробелы/[]/{} → true', () => {
    expect(isEmptyStructuredValue(null)).toBe(true);
    expect(isEmptyStructuredValue(undefined)).toBe(true);
    expect(isEmptyStructuredValue('')).toBe(true);
    expect(isEmptyStructuredValue('   ')).toBe(true);
    expect(isEmptyStructuredValue([])).toBe(true);
    expect(isEmptyStructuredValue({})).toBe(true);
  });

  it('непустые значения → false (включая 0 и false)', () => {
    expect(isEmptyStructuredValue('x')).toBe(false);
    expect(isEmptyStructuredValue(0)).toBe(false);
    expect(isEmptyStructuredValue(false)).toBe(false);
    expect(isEmptyStructuredValue([1])).toBe(false);
    expect(isEmptyStructuredValue({ a: 1 })).toBe(false);
  });
});
