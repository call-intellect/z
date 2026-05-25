/**
 * ТЗ 2026-05-25 §9 (clone-respond эволюция, Фаза 7) — unit-тесты
 * `RbacService.canAccessPersonClone` / `canAccessRoleClone` в обоих режимах
 * (`cloneV2Enabled` true и false).
 *
 * Источник правды:
 *  - cloneV2Enabled=true → ТОЛЬКО CloneAccessGrant (галочка админа).
 *  - cloneV2Enabled=false → legacy логика (owner/admin Org, self, manager
 *    для person; rbac.check obj='role' act='read' для role).
 *
 * PrismaService мокаем — нас интересует поведение веток, а не I/O.
 */
import { describe, expect, it, vi } from 'vitest';

import { RbacService } from './rbac.service';

import type { PrismaService } from '../../common/prisma/prisma.service';

interface BuildOpts {
  isSuperAdmin?: boolean;
  membership?: {
    role: 'owner' | 'admin' | 'manager' | 'coo';
    org: { visibilityMode: 'open' | 'strict' };
  } | null;
  cloneAccessGrant?: { id: string } | null;
  target?: {
    id: string;
    userId: string | null;
    primaryDepartmentId: string | null;
    tenantId: string;
  } | null;
  requesterPerson?: {
    id: string;
    primaryDepartmentId: string | null;
  } | null;
  isRequesterManager?: boolean;
}

function buildRbac(opts: BuildOpts): RbacService {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        isSuperAdmin: opts.isSuperAdmin === true,
      })),
    },
    membership: {
      findUnique: vi.fn(async () => opts.membership ?? null),
      findFirst: vi.fn(async () =>
        opts.isRequesterManager ? { id: 'm-1' } : null,
      ),
    },
    org: {
      findUnique: vi.fn(async () => ({ visibilityMode: 'open' })),
    },
    cloneAccessGrant: {
      findUnique: vi.fn(async () => opts.cloneAccessGrant ?? null),
    },
    person: {
      findUnique: vi.fn(async () => opts.target ?? null),
      findFirst: vi.fn(async () => opts.requesterPerson ?? null),
    },
  } as unknown as PrismaService;

  const rbac = new RbacService(prisma);
  rbac.onModuleInit();
  return rbac;
}

describe('RbacService.canAccessPersonClone — режим cloneV2Enabled=true (галочка)', () => {
  it('грант есть → allowed=true, relation=grant', async () => {
    const rbac = buildRbac({ cloneAccessGrant: { id: 'g-1' } });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      personId: 'p-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: true, relation: 'grant' });
  });

  it('грант отсутствует → allowed=false, даже если super_admin', async () => {
    // В режиме v2 super_admin сам должен выдать себе галочку — bypass нет.
    const rbac = buildRbac({
      isSuperAdmin: true,
      cloneAccessGrant: null,
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'sa-1',
      personId: 'p-1',
      cloneV2Enabled: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.relation).toBe('none');
  });

  it('грант отсутствует → allowed=false, даже если owner Org', async () => {
    const rbac = buildRbac({
      membership: { role: 'owner', org: { visibilityMode: 'open' } },
      cloneAccessGrant: null,
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-owner',
      personId: 'p-1',
      cloneV2Enabled: true,
    });
    expect(res.allowed).toBe(false);
  });
});

describe('RbacService.canAccessPersonClone — режим cloneV2Enabled=false (legacy)', () => {
  it('owner Org → allowed=true, relation=owner_admin', async () => {
    const rbac = buildRbac({
      membership: { role: 'owner', org: { visibilityMode: 'open' } },
      target: {
        id: 'p-1',
        userId: 'u-bearer',
        primaryDepartmentId: 'd-1',
        tenantId: 't-1',
      },
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-owner',
      personId: 'p-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.relation).toBe('owner_admin');
  });

  it('сам носитель → allowed=true, relation=self', async () => {
    const rbac = buildRbac({
      membership: { role: 'manager', org: { visibilityMode: 'open' } },
      target: {
        id: 'p-1',
        userId: 'u-bearer',
        primaryDepartmentId: 'd-1',
        tenantId: 't-1',
      },
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-bearer',
      personId: 'p-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.relation).toBe('self');
  });

  it('manager того же department → allowed=true, relation=manager', async () => {
    const rbac = buildRbac({
      membership: { role: 'manager', org: { visibilityMode: 'open' } },
      target: {
        id: 'p-1',
        userId: 'u-bearer',
        primaryDepartmentId: 'd-1',
        tenantId: 't-1',
      },
      requesterPerson: { id: 'p-req', primaryDepartmentId: 'd-1' },
      isRequesterManager: true,
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-req',
      personId: 'p-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.relation).toBe('manager');
  });

  it('manager другого department → allowed=false', async () => {
    const rbac = buildRbac({
      membership: { role: 'manager', org: { visibilityMode: 'open' } },
      target: {
        id: 'p-1',
        userId: 'u-bearer',
        primaryDepartmentId: 'd-1',
        tenantId: 't-1',
      },
      requesterPerson: { id: 'p-req', primaryDepartmentId: 'd-OTHER' },
      isRequesterManager: true,
    });
    const res = await rbac.canAccessPersonClone({
      tenantId: 't-1',
      requesterUserId: 'u-req',
      personId: 'p-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(false);
  });
});

describe('RbacService.canAccessRoleClone — оба режима', () => {
  it('v2 без гранта → allowed=false', async () => {
    const rbac = buildRbac({ cloneAccessGrant: null });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res.allowed).toBe(false);
  });

  it('v2 с грантом → allowed=true, relation=grant', async () => {
    const rbac = buildRbac({ cloneAccessGrant: { id: 'g-1' } });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-1',
      roleId: 'r-1',
      cloneV2Enabled: true,
    });
    expect(res).toEqual({ allowed: true, relation: 'grant' });
  });

  it('legacy: owner Org → allowed=true, relation=role_read', async () => {
    const rbac = buildRbac({
      membership: { role: 'owner', org: { visibilityMode: 'open' } },
    });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-owner',
      roleId: 'r-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.relation).toBe('role_read');
  });

  it('legacy: без membership → allowed=false', async () => {
    const rbac = buildRbac({ membership: null });
    const res = await rbac.canAccessRoleClone({
      tenantId: 't-1',
      requesterUserId: 'u-stranger',
      roleId: 'r-1',
      cloneV2Enabled: false,
    });
    expect(res.allowed).toBe(false);
  });
});
