/**
 * Ф8 «код ↔ схема: dataClassAudit + машинный гард класса» (2026-06-04).
 * Источник: plans/tz/2026-06-04-razblokirovka-konveyera.md §Ф8.
 *
 * ДЕШЁВЫЙ ТИП-ГАРД (без БД, гоняется в `test:unit`).
 *
 * Ловит ВЕРХНЕУРОВНЕВЫЙ дрейф: если из схемы убрать `dataClassAudit` у
 * Insight/Decision, аннотированный литерал `const x: Prisma.XxxCreateInput`
 * перестанет компилироваться (`tsc` ругнётся на лишний ключ) → `bun run build`
 * и `typecheck` упадут. Это дополняет интеграционный тест против реального
 * Postgres (который ловит вложенный where/data, невидимый для tsc).
 *
 * NB: type-only assertion'ы стираются при компиляции; чтобы файл не был «пустым»
 * для vitest и реально проходил через tsc, добавлен один тривиальный рантайм-
 * expect, фиксирующий, что объекты с `dataClassAudit` строятся.
 */
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

// ── Compile-time guard: оба CreateInput принимают dataClassAudit ──
// Если поле уберут из схемы — эти константы перестанут компилироваться.
const insightCreate: Prisma.InsightCreateInput = {
  kind: 'problem',
  statement: 'type-guard',
  dataClassAudit: { policyVersion: 'type_v1' } as Prisma.InputJsonValue,
  org: { connect: { id: 'org-x' } },
};

const decisionCreate: Prisma.DecisionCreateInput = {
  statement: 'type-guard',
  dataClassAudit: { policyVersion: 'type_v1' } as Prisma.InputJsonValue,
  org: { connect: { id: 'org-x' } },
};

// Тип-уровневая проверка, что ключ существует и допускает Json-значение.
type AssertHasDataClassAudit<T extends { dataClassAudit?: unknown }> = T;
type _InsightHasAudit = AssertHasDataClassAudit<Prisma.InsightCreateInput>;
type _DecisionHasAudit = AssertHasDataClassAudit<Prisma.DecisionCreateInput>;

describe('Ф8 — тип-гард: dataClassAudit в Insight/DecisionCreateInput', () => {
  it('CreateInput-литералы с dataClassAudit компилируются и строятся', () => {
    expect(insightCreate.dataClassAudit).toBeDefined();
    expect(decisionCreate.dataClassAudit).toBeDefined();
    // Затыкаем «неиспользуемые типы» — обращение нужно, чтобы tsc их проверил.
    const _checks: [_InsightHasAudit?, _DecisionHasAudit?] = [];
    expect(_checks).toHaveLength(0);
  });
});
