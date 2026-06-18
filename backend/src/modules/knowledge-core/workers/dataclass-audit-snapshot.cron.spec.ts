import { describe, expect, it } from 'vitest';

import { modelKeysWithDataClassAudit } from './dataclass-audit-snapshot.cron';

describe('modelKeysWithDataClassAudit — DMMF-гард dataClassAudit', () => {
  const keys = modelKeysWithDataClassAudit();

  it('включает 4 модели, починенные миграцией add_dataclass_audit_to_projections', () => {
    for (const k of ['regulation', 'process', 'policy', 'idea']) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it('включает проекции, уже имевшие колонку (Ф8): insight, decision', () => {
    expect(keys.has('insight')).toBe(true);
    expect(keys.has('decision')).toBe(true);
  });

  it('исключает skillTrait — у модели нет колонки dataClassAudit', () => {
    expect(keys.has('skillTrait')).toBe(false);
  });

  it('возвращает camelCase-ключи делегатов (а не PascalCase имена моделей DMMF)', () => {
    expect(keys.has('policy')).toBe(true);
    expect(keys.has('Policy')).toBe(false);
  });
});
