import { describe, expect, it } from 'vitest';

import { Specialist35Service } from './specialist-3-5-insights.service';

/**
 * SBA β-4 wave 2 (2026-05-23) — unit-тест для нормализации causeCategory.
 * Покрывает все 8 валидных значений + edge-cases (null/undefined/неизвестное/
 * с пробелами/в другом регистре).
 *
 * Логика: если ответ LLM невалиден или пуст — fallback на 'unknown',
 * чтобы куратор смог переоценить через UI Curation.
 */
describe('Specialist35Service.normalizeCauseCategory', () => {
  it('возвращает все 8 валидных категорий как-есть', () => {
    const valid = [
      'process_gap',
      'tooling',
      'role_skill',
      'communication',
      'priority',
      'resource_constraint',
      'external',
      'unknown',
    ];
    for (const v of valid) {
      expect(Specialist35Service.normalizeCauseCategory(v)).toBe(v);
    }
  });

  it('null / undefined / пустая строка → "unknown"', () => {
    expect(Specialist35Service.normalizeCauseCategory(null)).toBe('unknown');
    expect(Specialist35Service.normalizeCauseCategory(undefined)).toBe(
      'unknown',
    );
    expect(Specialist35Service.normalizeCauseCategory('')).toBe('unknown');
  });

  it('неизвестное значение → "unknown" (не пробрасываем мусор в БД)', () => {
    expect(Specialist35Service.normalizeCauseCategory('foo_bar')).toBe(
      'unknown',
    );
    expect(Specialist35Service.normalizeCauseCategory('PROCESS')).toBe(
      'unknown',
    );
    expect(Specialist35Service.normalizeCauseCategory('123')).toBe('unknown');
  });

  it('пробелы по краям тримуются', () => {
    expect(Specialist35Service.normalizeCauseCategory('  tooling  ')).toBe(
      'tooling',
    );
    expect(Specialist35Service.normalizeCauseCategory('\tcommunication\n')).toBe(
      'communication',
    );
  });

  it('верхний регистр приводится к нижнему', () => {
    expect(Specialist35Service.normalizeCauseCategory('TOOLING')).toBe(
      'tooling',
    );
    expect(Specialist35Service.normalizeCauseCategory('Process_Gap')).toBe(
      'process_gap',
    );
  });
});
