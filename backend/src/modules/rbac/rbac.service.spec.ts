/**
 * RBAC × Tenant матрица (Phase F.3).
 *
 * Табличный тест: для каждой пары (role × resource × action) проверяем, что
 * `RbacService.check` возвращает ожидаемый verdict. Источник правды о
 * разрешениях — `policies/policy.csv`; здесь мы лишь фиксируем ключевые
 * сценарии, чтобы изменение policy.csv не сломало контракт незаметно.
 *
 * super_admin (User.isSuperAdmin=true) — bypass всех проверок.
 * Отсутствие membership'а у обычного пользователя — отказ.
 *
 * PrismaService мокаем — нас интересует только evaluate(), а не I/O.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import { RbacService, type Action, type ResourceType } from './rbac.service';


interface MockedMembership {
  role: 'owner' | 'admin' | 'manager' | 'coo';
  org: { visibilityMode: 'open' | 'strict' };
}

function buildRbac(opts: {
  isSuperAdmin?: boolean;
  membership?: MockedMembership | null;
  orgVisibility?: 'open' | 'strict';
}): RbacService {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        isSuperAdmin: opts.isSuperAdmin === true,
      })),
    },
    membership: {
      findUnique: vi.fn(async () => opts.membership ?? null),
    },
    org: {
      findUnique: vi.fn(async () => ({
        visibilityMode: opts.orgVisibility ?? 'open',
      })),
    },
  } as unknown as PrismaService;

  const rbac = new RbacService(prisma);
  // onModuleInit грузит policy.csv с диска — нужно вызвать вручную в тестах.
  rbac.onModuleInit();
  return rbac;
}

describe('RbacService — матрица ролей × ресурсов × действий', () => {
  // ─────────────────────────── super_admin ──────────────────────────────
  describe('super_admin (isSuperAdmin=true) — bypass любых ограничений', () => {
    const superAdminCases: Array<{ obj: ResourceType; act: Action }> = [
      { obj: 'meeting', act: 'read' },
      { obj: 'meeting', act: 'delete' },
      { obj: 'org', act: 'manage' },
      { obj: 'block', act: 'delete' },
      { obj: 'audit-log', act: 'read' },
      { obj: 'person', act: 'erase' },
    ];
    it.each(superAdminCases)('$obj.$act → true', async ({ obj, act }) => {
      const rbac = buildRbac({ isSuperAdmin: true, membership: null });
      const allowed = await rbac.check({
        userId: 'super',
        tenantId: 'any-org',
        obj,
        act,
      });
      expect(allowed).toBe(true);
    });
  });

  // ─────────────────────────── нет membership ───────────────────────────
  describe('нет membership и не super_admin → false', () => {
    it('обычный user без membership на любой ресурс → false', async () => {
      const rbac = buildRbac({ isSuperAdmin: false, membership: null });
      const allowed = await rbac.check({
        userId: 'u-1',
        tenantId: 't-1',
        obj: 'meeting',
        act: 'read',
      });
      expect(allowed).toBe(false);
    });
  });

  // ─────────────────────────── owner ────────────────────────────────────
  describe('owner — полный доступ на основные ресурсы', () => {
    const ownerCases: Array<{ obj: ResourceType; act: Action; expected: boolean }> = [
      { obj: 'meeting', act: 'read', expected: true },
      { obj: 'meeting', act: 'write', expected: true },
      { obj: 'meeting', act: 'delete', expected: true },
      { obj: 'block', act: 'read', expected: true },
      { obj: 'block', act: 'write', expected: true },
      { obj: 'block', act: 'delete', expected: true },
      { obj: 'theme', act: 'read', expected: true },
      { obj: 'theme', act: 'delete', expected: true },
      { obj: 'audit-log', act: 'read', expected: true },
      { obj: 'person', act: 'erase', expected: true },
    ];
    it.each(ownerCases)('owner $obj $act → $expected', async ({ obj, act, expected }) => {
      const rbac = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      const allowed = await rbac.check({
        userId: 'u-owner',
        tenantId: 't-1',
        obj,
        act,
        resourceOwnerId: 'u-owner',
      });
      expect(allowed).toBe(expected);
    });
  });

  // ─────────────────────────── admin ────────────────────────────────────
  describe('admin — полный доступ на основные ресурсы, но НЕ erase', () => {
    const adminCases: Array<{ obj: ResourceType; act: Action; expected: boolean }> = [
      { obj: 'meeting', act: 'read', expected: true },
      { obj: 'meeting', act: 'delete', expected: true },
      { obj: 'block', act: 'write', expected: true },
      { obj: 'theme', act: 'write', expected: true },
      // admin НЕ может erase персональные данные — только owner.
      { obj: 'person', act: 'erase', expected: false },
    ];
    it.each(adminCases)('admin $obj $act → $expected', async ({ obj, act, expected }) => {
      const rbac = buildRbac({
        membership: { role: 'admin', org: { visibilityMode: 'open' } },
      });
      const allowed = await rbac.check({
        userId: 'u-admin',
        tenantId: 't-1',
        obj,
        act,
        resourceOwnerId: 'u-admin',
      });
      expect(allowed).toBe(expected);
    });
  });

  // ─────────────────────────── manager OPEN ─────────────────────────────
  describe('manager (visibility=open) — read всего, write только своих', () => {
    const cases: Array<{
      obj: ResourceType;
      act: Action;
      isSelf: boolean;
      expected: boolean;
    }> = [
      // Read meetings/cards/tasks — на всё в Org.
      { obj: 'meeting', act: 'read', isSelf: false, expected: true },
      { obj: 'card', act: 'read', isSelf: false, expected: true },
      { obj: 'task', act: 'read', isSelf: false, expected: true },
      // Write — только свои.
      { obj: 'meeting', act: 'write', isSelf: true, expected: true },
      { obj: 'meeting', act: 'write', isSelf: false, expected: false },
      { obj: 'card', act: 'write', isSelf: true, expected: true },
      { obj: 'card', act: 'write', isSelf: false, expected: false },
      // Delete — только свои.
      { obj: 'meeting', act: 'delete', isSelf: true, expected: true },
      { obj: 'meeting', act: 'delete', isSelf: false, expected: false },
      // Knowledge-core shared: read всем member'ам.
      { obj: 'block', act: 'read', isSelf: false, expected: true },
      { obj: 'theme', act: 'read', isSelf: false, expected: true },
      { obj: 'entity', act: 'read', isSelf: false, expected: true },
      // Manager НЕ имеет write на block / theme / entity.
      { obj: 'block', act: 'write', isSelf: true, expected: false },
      { obj: 'block', act: 'delete', isSelf: true, expected: false },
      // Audit log — только admin/owner.
      { obj: 'audit-log', act: 'read', isSelf: true, expected: false },
      // person.erase — только owner.
      { obj: 'person', act: 'erase', isSelf: true, expected: false },
    ];
    it.each(cases)(
      'manager open $obj $act self=$isSelf → $expected',
      async ({ obj, act, isSelf, expected }) => {
        const rbac = buildRbac({
          membership: { role: 'manager', org: { visibilityMode: 'open' } },
        });
        const allowed = await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj,
          act,
          resourceOwnerId: isSelf ? 'u-mgr' : 'u-other',
        });
        expect(allowed).toBe(expected);
      },
    );
  });

  // ─────────────────────────── manager STRICT ───────────────────────────
  describe('manager (visibility=strict) — read/write только своих', () => {
    const cases: Array<{
      obj: ResourceType;
      act: Action;
      isSelf: boolean;
      expected: boolean;
    }> = [
      // Read meetings/cards/tasks ТОЛЬКО свои.
      { obj: 'meeting', act: 'read', isSelf: true, expected: true },
      { obj: 'meeting', act: 'read', isSelf: false, expected: false },
      { obj: 'card', act: 'read', isSelf: true, expected: true },
      { obj: 'card', act: 'read', isSelf: false, expected: false },
      { obj: 'task', act: 'write', isSelf: true, expected: true },
      { obj: 'task', act: 'write', isSelf: false, expected: false },
      // Knowledge-core (shared) — read всё равно открыт всем member'ам (исключение из strict).
      { obj: 'block', act: 'read', isSelf: false, expected: true },
      { obj: 'theme', act: 'read', isSelf: false, expected: true },
      { obj: 'entity', act: 'read', isSelf: false, expected: true },
      // Audit-log — нет.
      { obj: 'audit-log', act: 'read', isSelf: true, expected: false },
    ];
    it.each(cases)(
      'manager strict $obj $act self=$isSelf → $expected',
      async ({ obj, act, isSelf, expected }) => {
        const rbac = buildRbac({
          membership: { role: 'manager', org: { visibilityMode: 'strict' } },
          orgVisibility: 'strict',
        });
        const allowed = await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj,
          act,
          resourceOwnerId: isSelf ? 'u-mgr' : 'u-other',
        });
        expect(allowed).toBe(expected);
      },
    );
  });

  // ──────────────── Clones=Roles Ф5 (2026-05-25) — clone_persona member-wide read ───
  describe('clone_persona — Clones=Roles Ф5: read доступен всем member ролям (включая manager strict)', () => {
    const memberRoles: Array<{
      role: 'owner' | 'admin' | 'manager';
      visibility: 'open' | 'strict';
    }> = [
      { role: 'owner', visibility: 'open' },
      { role: 'admin', visibility: 'open' },
      { role: 'manager', visibility: 'open' },
      { role: 'manager', visibility: 'strict' },
    ];
    it.each(memberRoles)(
      '$role/$visibility read clone_persona → true',
      async ({ role, visibility }) => {
        const rbac = buildRbac({
          membership: { role, org: { visibilityMode: visibility } },
          orgVisibility: visibility,
        });
        const allowed = await rbac.check({
          userId: 'u-1',
          tenantId: 't-1',
          obj: 'clone_persona',
          act: 'read',
          resourceOwnerId: 'u-other', // не-self, проверяем именно shared-access
        });
        expect(allowed).toBe(true);
      },
    );

    it('write clone_persona — только owner/admin', async () => {
      const owner = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      expect(
        await owner.check({
          userId: 'u-o',
          tenantId: 't-1',
          obj: 'clone_persona',
          act: 'write',
          resourceOwnerId: null,
        }),
      ).toBe(true);

      const admin = buildRbac({
        membership: { role: 'admin', org: { visibilityMode: 'open' } },
      });
      expect(
        await admin.check({
          userId: 'u-a',
          tenantId: 't-1',
          obj: 'clone_persona',
          act: 'write',
          resourceOwnerId: null,
        }),
      ).toBe(true);

      const mgr = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(
        await mgr.check({
          userId: 'u-m',
          tenantId: 't-1',
          obj: 'clone_persona',
          act: 'write',
          resourceOwnerId: 'u-m',
        }),
      ).toBe(false);
    });

    it('skill_profile read доступен manager strict без self-ограничителя (Clones=Roles Ф5)', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'strict' } },
        orgVisibility: 'strict',
      });
      const allowed = await rbac.check({
        userId: 'u-mgr',
        tenantId: 't-1',
        obj: 'skill_profile',
        act: 'read',
        resourceOwnerId: 'u-other', // чужой профиль — должен открыться
      });
      expect(allowed).toBe(true);
    });
  });

  // ─────────────────────────── shortcuts ────────────────────────────────
  describe('shortcuts canRead/canWrite/canManageOrg', () => {
    it('canRead делегирует в check с action=read', async () => {
      const rbac = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      expect(await rbac.canRead('u-1', 't-1', 'block')).toBe(true);
    });

    it('canWrite делегирует в check с action=write', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      // manager open не имеет write на block.
      expect(await rbac.canWrite('u-1', 't-1', 'block', 'u-1')).toBe(false);
    });

    it('canManageOrg: owner → true, admin → false, super_admin → true', async () => {
      const owner = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      expect(await owner.canManageOrg('u-o', 't-1')).toBe(true);

      const admin = buildRbac({
        membership: { role: 'admin', org: { visibilityMode: 'open' } },
      });
      expect(await admin.canManageOrg('u-a', 't-1')).toBe(false);

      const sa = buildRbac({
        isSuperAdmin: true,
        membership: null,
      });
      expect(await sa.canManageOrg('u-s', 't-1')).toBe(true);
    });

    it('canViewDirectorDashboard: owner/admin → true, manager → false', async () => {
      const owner = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      expect(await owner.canViewDirectorDashboard('u-o', 't-1')).toBe(true);

      const admin = buildRbac({
        membership: { role: 'admin', org: { visibilityMode: 'open' } },
      });
      expect(await admin.canViewDirectorDashboard('u-a', 't-1')).toBe(true);

      const mgr = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(await mgr.canViewDirectorDashboard('u-m', 't-1')).toBe(false);
    });

    it('canViewOperationsDashboard: owner/admin/coo → true, manager → false', async () => {
      const owner = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      expect(await owner.canViewOperationsDashboard('u-o', 't-1')).toBe(true);

      const coo = buildRbac({
        membership: { role: 'coo', org: { visibilityMode: 'open' } },
      });
      expect(await coo.canViewOperationsDashboard('u-c', 't-1')).toBe(true);

      const mgr = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(await mgr.canViewOperationsDashboard('u-m', 't-1')).toBe(false);
    });
  });

  // ─────────────────────────── cache ────────────────────────────────────
  describe('membership cache', () => {
    it('повторный check одного и того же (user, tenant) не дёргает PrismaService снова', async () => {
      const findUserMock = vi.fn(async () => ({ isSuperAdmin: false }));
      const findMembershipMock = vi.fn(async () => ({
        role: 'owner' as const,
        org: { visibilityMode: 'open' as const },
      }));
      const prisma = {
        user: { findUnique: findUserMock },
        membership: { findUnique: findMembershipMock },
        org: { findUnique: vi.fn() },
      } as unknown as PrismaService;
      const rbac = new RbacService(prisma);
      rbac.onModuleInit();

      await rbac.check({ userId: 'u', tenantId: 't', obj: 'meeting', act: 'read' });
      await rbac.check({ userId: 'u', tenantId: 't', obj: 'meeting', act: 'write' });
      await rbac.check({ userId: 'u', tenantId: 't', obj: 'card', act: 'read' });

      expect(findUserMock).toHaveBeenCalledTimes(1);
      expect(findMembershipMock).toHaveBeenCalledTimes(1);
    });

    it('invalidate сбрасывает кэш', async () => {
      const findUserMock = vi.fn(async () => ({ isSuperAdmin: false }));
      const findMembershipMock = vi.fn(async () => ({
        role: 'owner' as const,
        org: { visibilityMode: 'open' as const },
      }));
      const prisma = {
        user: { findUnique: findUserMock },
        membership: { findUnique: findMembershipMock },
        org: { findUnique: vi.fn() },
      } as unknown as PrismaService;
      const rbac = new RbacService(prisma);
      rbac.onModuleInit();

      await rbac.check({ userId: 'u', tenantId: 't', obj: 'meeting', act: 'read' });
      rbac.invalidate('u', 't');
      await rbac.check({ userId: 'u', tenantId: 't', obj: 'meeting', act: 'read' });
      expect(findUserMock).toHaveBeenCalledTimes(2);
    });
  });

  // ─────────────────────────── audit В7 (2026-05-29) ────────────────────────
  // Дополнительное покрытие основных ролей × ключевых ресурсов из policy.csv.
  // Цель — поймать регрессии при правках policy: каждая важная роль/ресурс
  // имеет хотя бы один кейс «должно работать» и один «не должно».
  describe('audit В7: покрытие COO и admin-only ресурсов', () => {
    // COO — операционный директор. Read на большинство shared-ресурсов,
    // нет write на org/meeting/card/task.
    const cooReadAllowedCases: ResourceType[] = [
      'meeting',
      'card',
      'task',
      'block',
      'entity',
      'theme',
      'goal',
      'person',
      'department',
      'process',
      'regulation',
      'policy',
      'decision',
      'insight',
      'idea',
      'experiment',
      'appointment',
      'kpi',
      'maturity',
      'company_profile',
      'functional_domain',
      'skill_profile',
      'knowledge_profile',
      'dashboard_operations',
      'daily_checkin',
      'personal_relation',
      'project',
      'issue',
      'cycle',
      'commitment',
    ];
    it.each(cooReadAllowedCases)(
      'coo %s read → true',
      async (obj) => {
        const rbac = buildRbac({
          membership: { role: 'coo', org: { visibilityMode: 'open' } },
        });
        const allowed = await rbac.check({
          userId: 'u-coo',
          tenantId: 't-1',
          obj,
          act: 'read',
          resourceOwnerId: 'u-other',
        });
        expect(allowed).toBe(true);
      },
    );

    it('coo НЕ имеет write на org', async () => {
      const rbac = buildRbac({
        membership: { role: 'coo', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-coo',
          tenantId: 't-1',
          obj: 'org',
          act: 'write',
        }),
      ).toBe(false);
    });

    it('coo НЕ имеет delete на meeting', async () => {
      const rbac = buildRbac({
        membership: { role: 'coo', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-coo',
          tenantId: 't-1',
          obj: 'meeting',
          act: 'delete',
          resourceOwnerId: 'u-coo',
        }),
      ).toBe(false);
    });

    it('coo write self daily_checkin → true', async () => {
      const rbac = buildRbac({
        membership: { role: 'coo', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-coo',
          tenantId: 't-1',
          obj: 'daily_checkin',
          act: 'write',
          resourceOwnerId: 'u-coo',
        }),
      ).toBe(true);
    });

    it('coo write чужой daily_checkin → false', async () => {
      const rbac = buildRbac({
        membership: { role: 'coo', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-coo',
          tenantId: 't-1',
          obj: 'daily_checkin',
          act: 'write',
          resourceOwnerId: 'u-other',
        }),
      ).toBe(false);
    });
  });

  describe('audit В7: clone_persona / source — owner-территории', () => {
    it('source.manage — owner/admin (manager → false)', async () => {
      const ownerR = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      expect(
        await ownerR.check({
          userId: 'u',
          tenantId: 't',
          obj: 'source',
          act: 'manage',
        }),
      ).toBe(true);

      const adminR = buildRbac({
        membership: { role: 'admin', org: { visibilityMode: 'open' } },
      });
      expect(
        await adminR.check({
          userId: 'u',
          tenantId: 't',
          obj: 'source',
          act: 'manage',
        }),
      ).toBe(true);

      const mgrOpen = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(
        await mgrOpen.check({
          userId: 'u',
          tenantId: 't',
          obj: 'source',
          act: 'manage',
          resourceOwnerId: 'u',
        }),
      ).toBe(false);
    });

    it('clone_persona.delete — только owner (admin тоже НЕ может)', async () => {
      const ownerR = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      expect(
        await ownerR.check({
          userId: 'u',
          tenantId: 't',
          obj: 'clone_persona',
          act: 'delete',
        }),
      ).toBe(true);

      const adminR = buildRbac({
        membership: { role: 'admin', org: { visibilityMode: 'open' } },
      });
      // В policy admin clone_persona delete не объявлен → false.
      expect(
        await adminR.check({
          userId: 'u',
          tenantId: 't',
          obj: 'clone_persona',
          act: 'delete',
        }),
      ).toBe(false);
    });
  });

  describe('audit В7: visibility-mode граничные кейсы для manager', () => {
    // commitment: open — read all members, strict — read self
    it('manager open read commitment (чужой) → true', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'commitment',
          act: 'read',
          resourceOwnerId: 'u-other',
        }),
      ).toBe(true);
    });

    it('manager strict read commitment (чужой) → false', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'strict' } },
        orgVisibility: 'strict',
      });
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'commitment',
          act: 'read',
          resourceOwnerId: 'u-other',
        }),
      ).toBe(false);
    });

    it('manager strict read commitment (свой) → true', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'strict' } },
        orgVisibility: 'strict',
      });
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'commitment',
          act: 'read',
          resourceOwnerId: 'u-mgr',
        }),
      ).toBe(true);
    });

    // decision: SBA β-3 — manager open читает все, strict — self.
    it('manager open read decision (чужой) → true', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'decision',
          act: 'read',
          resourceOwnerId: 'u-other',
        }),
      ).toBe(true);
    });

    it('manager strict read decision (чужой) → false', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'strict' } },
        orgVisibility: 'strict',
      });
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'decision',
          act: 'read',
          resourceOwnerId: 'u-other',
        }),
      ).toBe(false);
    });
  });

  describe('audit В7: tracker resources', () => {
    it('owner полный CRUD на project/issue/cycle', async () => {
      const rbac = buildRbac({
        membership: { role: 'owner', org: { visibilityMode: 'open' } },
      });
      for (const obj of ['project', 'issue', 'cycle'] as ResourceType[]) {
        for (const act of ['read', 'write', 'delete'] as Action[]) {
          expect(
            await rbac.check({
              userId: 'u-o',
              tenantId: 't-1',
              obj,
              act,
            }),
          ).toBe(true);
        }
      }
    });

    it('manager open write issue (любую) → true', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'issue',
          act: 'write',
          resourceOwnerId: 'u-other',
        }),
      ).toBe(true);
    });

    it('manager delete issue (свой) → true, чужой → false', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'issue',
          act: 'delete',
          resourceOwnerId: 'u-mgr',
        }),
      ).toBe(true);
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'issue',
          act: 'delete',
          resourceOwnerId: 'u-other',
        }),
      ).toBe(false);
    });

    it('manager НЕ имеет write на intake_issue', async () => {
      const rbac = buildRbac({
        membership: { role: 'manager', org: { visibilityMode: 'open' } },
      });
      expect(
        await rbac.check({
          userId: 'u-mgr',
          tenantId: 't-1',
          obj: 'intake_issue',
          act: 'write',
          resourceOwnerId: 'u-mgr',
        }),
      ).toBe(false);
    });
  });
});
