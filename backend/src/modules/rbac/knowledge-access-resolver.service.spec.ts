/**
 * Ф2 knowledge-access-groups — юнит-тесты KnowledgeAccessResolver.
 *
 * Мокаем PrismaService + RbacService.loadContext. Проверяем:
 *   - owner / super_admin → isBypass=true, buildAccessWhere=={}.
 *   - member отдела → его dept-группа в deptGroupIds.
 *   - матрица GroupVisibilityPolicy → +visibleGroup.
 *   - closed membership → closedGroupIds.
 *   - buildAccessWhere(non-bypass) → AND[2]: none-closed + OR[none-dept, some-in].
 *   - canAccessKnowledgeGroup (RbacService) — closed / dept / открытый.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import {
  KnowledgeAccessResolver,
  type KnowledgeAccessContext,
} from './knowledge-access-resolver.service';
import { RbacService } from './rbac.service';

interface MockGroupMembership {
  groupId: string;
  group: { kind: string; isClosed: boolean; tenantId: string };
}

function buildResolver(opts: {
  loadContext: {
    role?: string;
    isSuperAdmin?: boolean;
  } | null;
  person?: { id: string; primaryDepartmentId: string | null } | null;
  personRoles?: Array<{ role: { departmentId: string | null } | null }>;
  appointments?: Array<{ departmentId: string | null }>;
  headOf?: Array<{ id: string }>;
  deptGroups?: Array<{ id: string }>;
  memberships?: MockGroupMembership[];
  policies?: Array<{ visibleGroupId: string }>;
}): { resolver: KnowledgeAccessResolver } {
  const prisma = {
    person: {
      findFirst: vi.fn(async () => opts.person ?? null),
    },
    personRole: {
      findMany: vi.fn(async () => opts.personRoles ?? []),
    },
    appointment: {
      findMany: vi.fn(async () => opts.appointments ?? []),
    },
    department: {
      findMany: vi.fn(async () => opts.headOf ?? []),
    },
    knowledgeGroup: {
      findMany: vi.fn(async () => opts.deptGroups ?? []),
    },
    knowledgeGroupMember: {
      findMany: vi.fn(async () => opts.memberships ?? []),
    },
    groupVisibilityPolicy: {
      findMany: vi.fn(async () => opts.policies ?? []),
    },
  } as unknown as PrismaService;

  const rbac = {
    loadContext: vi.fn(async () => opts.loadContext),
  } as unknown as RbacService;

  return { resolver: new KnowledgeAccessResolver(prisma, rbac) };
}

const TENANT = 't-1';
const USER = 'u-1';

describe('KnowledgeAccessResolver.resolveAccessibleGroups', () => {
  it('owner → isBypass=true, пустые группы', async () => {
    const { resolver } = buildResolver({ loadContext: { role: 'owner' } });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.isBypass).toBe(true);
    expect(ctx.deptGroupIds).toEqual([]);
    expect(ctx.closedGroupIds).toEqual([]);
    expect(resolver.buildAccessWhere(ctx)).toEqual({});
  });

  it('admin → isBypass=true', async () => {
    const { resolver } = buildResolver({ loadContext: { role: 'admin' } });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.isBypass).toBe(true);
  });

  it('super_admin → isBypass=true', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager', isSuperAdmin: true },
    });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.isBypass).toBe(true);
  });

  it('member отдела «Логистика» → его dept-группа в deptGroupIds; closed пуст', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager' },
      person: { id: 'p-1', primaryDepartmentId: 'dept-log' },
      deptGroups: [{ id: 'g-log' }],
      memberships: [],
    });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.isBypass).toBe(false);
    expect(ctx.deptGroupIds).toContain('g-log');
    expect(ctx.closedGroupIds).toEqual([]);
  });

  it('матрица: own «g-sales» + policy →[g-log] → deptGroupIds содержит и g-sales, и g-log', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager' },
      person: { id: 'p-2', primaryDepartmentId: 'dept-sales' },
      deptGroups: [{ id: 'g-sales' }],
      memberships: [],
      policies: [{ visibleGroupId: 'g-log' }],
    });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.deptGroupIds).toContain('g-sales');
    expect(ctx.deptGroupIds).toContain('g-log');
  });

  it('closed membership → closedGroupIds содержит g-council', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager' },
      person: { id: 'p-3', primaryDepartmentId: null },
      deptGroups: [],
      memberships: [
        {
          groupId: 'g-council',
          group: { kind: 'council', isClosed: true, tenantId: TENANT },
        },
      ],
    });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.closedGroupIds).toContain('g-council');
  });

  it('ручной dept-override через membership → попадает в deptGroupIds', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager' },
      person: { id: 'p-4', primaryDepartmentId: null },
      deptGroups: [],
      memberships: [
        {
          groupId: 'g-manual-dept',
          group: { kind: 'department', isClosed: false, tenantId: TENANT },
        },
      ],
    });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.deptGroupIds).toContain('g-manual-dept');
  });

  it('членство чужого tenant игнорируется (tenant-guard)', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager' },
      person: { id: 'p-5', primaryDepartmentId: null },
      deptGroups: [],
      memberships: [
        {
          groupId: 'g-other',
          group: { kind: 'council', isClosed: true, tenantId: 'OTHER' },
        },
      ],
    });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.closedGroupIds).not.toContain('g-other');
  });

  it('нет Person в Org → пустой ctx, не bypass', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager' },
      person: null,
    });
    const ctx = await resolver.resolveAccessibleGroups({ tenantId: TENANT, userId: USER });
    expect(ctx.isBypass).toBe(false);
    expect(ctx.deptGroupIds).toEqual([]);
    expect(ctx.closedGroupIds).toEqual([]);
  });
});

describe('KnowledgeAccessResolver.buildAccessWhere', () => {
  it('non-bypass → AND[2]: none-closed + OR[none-dept, some-in-deptGroupIds]', () => {
    const { resolver } = buildResolver({ loadContext: { role: 'manager' } });
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: ['g-log'],
      closedGroupIds: ['g-council'],
      isBypass: false,
    };
    const where = resolver.buildAccessWhere(ctx);
    expect(where).toEqual({
      AND: [
        {
          blockAccess: {
            none: { group: { isClosed: true }, groupId: { notIn: ['g-council'] } },
          },
        },
        {
          OR: [
            { blockAccess: { none: { group: { kind: 'department' } } } },
            { blockAccess: { some: { groupId: { in: ['g-log'] } } } },
          ],
        },
      ],
    });
  });

  it('bypass → пустой фильтр {}', () => {
    const { resolver } = buildResolver({ loadContext: { role: 'owner' } });
    expect(
      resolver.buildAccessWhere({ deptGroupIds: [], closedGroupIds: [], isBypass: true }),
    ).toEqual({});
  });
});

describe('RbacService.canAccessKnowledgeGroup', () => {
  // canAccessKnowledgeGroup — чистая функция, не требует prisma/policy.csv.
  const rbac = Object.create(RbacService.prototype) as RbacService;

  it('bypass → true для любого блока', () => {
    expect(
      rbac.canAccessKnowledgeGroup(
        { deptGroupIds: [], closedGroupIds: [], isBypass: true },
        [{ groupId: 'g-council', isClosed: true, kind: 'council' }],
      ),
    ).toBe(true);
  });

  it('пустой blockGroups → true (блок открыт)', () => {
    expect(
      rbac.canAccessKnowledgeGroup(
        { deptGroupIds: [], closedGroupIds: [], isBypass: false },
        [],
      ),
    ).toBe(true);
  });

  it('closed-блок виден только члену closed-группы', () => {
    const closedBlock = [{ groupId: 'g-council', isClosed: true, kind: 'council' }];
    expect(
      rbac.canAccessKnowledgeGroup(
        { deptGroupIds: [], closedGroupIds: ['g-council'], isBypass: false },
        closedBlock,
      ),
    ).toBe(true);
    expect(
      rbac.canAccessKnowledgeGroup(
        { deptGroupIds: [], closedGroupIds: [], isBypass: false },
        closedBlock,
      ),
    ).toBe(false);
  });

  it('dept-блок виден при пересечении dept-групп', () => {
    const deptBlock = [{ groupId: 'g-log', isClosed: false, kind: 'department' }];
    expect(
      rbac.canAccessKnowledgeGroup(
        { deptGroupIds: ['g-log'], closedGroupIds: [], isBypass: false },
        deptBlock,
      ),
    ).toBe(true);
    expect(
      rbac.canAccessKnowledgeGroup(
        { deptGroupIds: ['g-sales'], closedGroupIds: [], isBypass: false },
        deptBlock,
      ),
    ).toBe(false);
  });
});
