/**
 * Гард против schema drift по `dataClassAudit` (2026-06-05).
 * Источник: plans/tz/2026-06-05-dataclass-audit-schema-drift-fix.md.
 *
 * ДЕТЕРМИНИРОВАННЫЙ ТЕСТ (без БД, гоняется в `test:unit`).
 *
 * Проверяет рантайм-фильтр крона `modelKeysWithDataClassAudit()`, который
 * считается из `Prisma.dmmf` (т.е. отражает регенерированный Prisma Client) и
 * отсекает проекции без колонки `dataClassAudit`. Без этого фильтра крон слал
 * `count({ where: { dataClassAudit: { not: null } } })` по моделям без колонки,
 * и PrismaService логировал по 5 ERROR каждые 30 минут (Unknown argument).
 *
 * Если кто-то откатит миграцию `*_add_dataclass_audit_to_projections` (уберёт
 * колонку у Regulation/Process/Policy/Idea) и регенерит клиент — эти проверки
 * покраснеют, не дав дрейфу уйти в прод незаметно.
 */
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
