import { describe, expect, it } from 'vitest';

import { CrossFunctionalDetectorService } from './cross-functional-detector.service';

/**
 * SBA γ-3 — юнит-тесты pure-функции `compute()` CrossFunctionalDetectorService.
 * Не используют БД / PrismaService.
 */
describe('CrossFunctionalDetectorService.compute', () => {
  // Сервис без DI — для compute не нужны Prisma / Config.
  const svc = new CrossFunctionalDetectorService(
    {} as never,
    {} as never,
  );

  it('пустые шаги → score=0, isCrossFunctional=false', () => {
    const r = svc.compute({
      steps: [],
      roleToDepartment: new Map(),
      threshold: 0.5,
    });
    expect(r.score).toBe(0);
    expect(r.isCrossFunctional).toBe(false);
    expect(r.uniqueDepartments).toBe(0);
    expect(r.totalSteps).toBe(0);
  });

  it('все шаги одного отдела → score=1/N (low), isCrossFunctional=false', () => {
    const r = svc.compute({
      steps: [
        { ownerRoleId: 'role_1' },
        { ownerRoleId: 'role_2' },
        { ownerRoleId: 'role_3' },
      ],
      roleToDepartment: new Map([
        ['role_1', 'dept_sales'],
        ['role_2', 'dept_sales'],
        ['role_3', 'dept_sales'],
      ]),
      threshold: 0.5,
    });
    // 1 уникальный dept / 3 шага = 0.333
    expect(r.score).toBeCloseTo(0.333, 3);
    expect(r.isCrossFunctional).toBe(false);
    expect(r.uniqueDepartments).toBe(1);
  });

  it('каждый шаг — свой отдел → score=1, isCrossFunctional=true', () => {
    const r = svc.compute({
      steps: [
        { ownerRoleId: 'role_1' },
        { ownerRoleId: 'role_2' },
      ],
      roleToDepartment: new Map([
        ['role_1', 'dept_sales'],
        ['role_2', 'dept_eng'],
      ]),
      threshold: 0.5,
    });
    expect(r.score).toBe(1);
    expect(r.isCrossFunctional).toBe(true);
    expect(r.uniqueDepartments).toBe(2);
  });

  it('score >= threshold (0.5) → isCrossFunctional=true', () => {
    const r = svc.compute({
      steps: [
        { ownerRoleId: 'role_a' },
        { ownerRoleId: 'role_b' },
        { ownerRoleId: 'role_c' },
        { ownerRoleId: 'role_d' },
      ],
      roleToDepartment: new Map([
        ['role_a', 'dept_x'],
        ['role_b', 'dept_y'],
        ['role_c', 'dept_z'],
        ['role_d', 'dept_y'],
      ]),
      threshold: 0.5,
    });
    // 3 уникальных / 4 = 0.75
    expect(r.score).toBeCloseTo(0.75, 3);
    expect(r.isCrossFunctional).toBe(true);
  });

  it('шаги без ownerRoleId → не учитываются → score=0', () => {
    const r = svc.compute({
      steps: [
        { ownerRoleId: null },
        { ownerRoleId: undefined },
        { ownerRoleId: '' },
      ],
      roleToDepartment: new Map(),
      threshold: 0.5,
    });
    // totalSteps = 3, deptSet = 0 → 0/3 = 0
    expect(r.score).toBe(0);
    expect(r.isCrossFunctional).toBe(false);
    expect(r.uniqueDepartments).toBe(0);
    expect(r.totalSteps).toBe(3);
  });

  it('role без departmentId → пропускаем; департамент не считается', () => {
    const r = svc.compute({
      steps: [
        { ownerRoleId: 'role_1' },
        { ownerRoleId: 'role_2' },
      ],
      roleToDepartment: new Map([
        ['role_1', 'dept_sales'],
        ['role_2', null],
      ]),
      threshold: 0.5,
    });
    // Только 1 dept из 2 шагов = 0.5 — на границе threshold = true.
    expect(r.score).toBeCloseTo(0.5, 3);
    expect(r.isCrossFunctional).toBe(true);
  });

  it('score всегда в [0..1]', () => {
    const r = svc.compute({
      steps: [{ ownerRoleId: 'role_1' }],
      roleToDepartment: new Map([['role_1', 'dept_a']]),
      threshold: 0.5,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});
