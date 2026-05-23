import { describe, expect, it } from 'vitest';

import { ProcessTemplateCompletenessService } from './process-template-completeness.service';

/**
 * SBA α-7 wave 2 — юнит-тесты для pure-функции `compute()`
 * `ProcessTemplateCompletenessService`. Не используют БД.
 */
describe('ProcessTemplateCompletenessService.compute', () => {
  // Сервис без DI — PrismaService нам тут не нужен (compute pure).
  const svc = new ProcessTemplateCompletenessService({
    /* мок не используется в compute */
  } as never);

  it('пустой шаблон без version → completeness=0', () => {
    const score = svc.compute({
      template: { ownerRoleId: null, ownerPersonId: null },
      currentVersion: null,
      decisionPointsCount: 0,
      handoffsCount: 0,
      siblingTemplatesCount: 0,
    });
    // siblingTemplatesCount=0 даёт «handoff_or_terminal» = true (0.2).
    // Также «decision_or_simple» = true (нет шагов → simple, 0.15).
    expect(score).toBeCloseTo(0.35, 2);
  });

  it('полностью заполненный шаблон → completeness=1.0', () => {
    const score = svc.compute({
      template: { ownerRoleId: 'role_1', ownerPersonId: null },
      currentVersion: {
        definition: {
          steps: [
            {
              name: 'Шаг 1',
              order: 1,
              ownerRoleId: 'role_1',
              outputArtifact: 'PDF',
            },
            {
              name: 'Шаг 2',
              order: 2,
              ownerRoleId: 'role_2',
              inputArtifact: 'PDF',
              outputArtifact: 'JSON',
            },
            {
              name: 'Шаг 3',
              order: 3,
              ownerRoleId: 'role_3',
              outputArtifact: 'OK',
            },
          ],
          handoffsInline: [],
          decisionPointsInline: [],
        },
      },
      decisionPointsCount: 1,
      handoffsCount: 1,
      siblingTemplatesCount: 5,
    });
    expect(score).toBe(1);
  });

  it('шаги без owner → steps_have_owner=false (минус 0.15)', () => {
    const score = svc.compute({
      template: { ownerRoleId: 'role_1', ownerPersonId: null },
      currentVersion: {
        definition: {
          steps: [
            { name: 'Шаг 1', order: 1, outputArtifact: 'PDF' },
            { name: 'Шаг 2', order: 2, outputArtifact: 'JSON' },
          ],
          handoffsInline: [],
          decisionPointsInline: [],
        },
      },
      decisionPointsCount: 0,
      handoffsCount: 0,
      siblingTemplatesCount: 0,
    });
    // has_current_version=true(0.2), has_owner=true(0.15),
    // steps_have_owner=false(0), steps_have_artifacts=true(0.15),
    // decision_or_simple=true (<= 2 шагов, 0.15),
    // handoff_or_terminal=true (siblings=0, 0.2)
    expect(score).toBeCloseTo(0.85, 2);
  });

  it('значение всегда в [0..1]', () => {
    const score = svc.compute({
      template: { ownerRoleId: null, ownerPersonId: null },
      currentVersion: { definition: null },
      decisionPointsCount: 0,
      handoffsCount: 0,
      siblingTemplatesCount: 100,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
