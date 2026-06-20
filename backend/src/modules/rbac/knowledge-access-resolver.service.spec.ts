import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';

import {
  PROVENANCE_ACCESS_MASK,
  ProvenanceService,
} from '../knowledge-core/services/provenance.service';
import type { S3Service } from '../recordings/s3.service';

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

describe('KnowledgeAccessResolver.resolveDirectGroupIds', () => {
  it('owner → isBypass=true, personId=null, пустые группы', async () => {
    const { resolver } = buildResolver({ loadContext: { role: 'owner' } });
    const res = await resolver.resolveDirectGroupIds({ tenantId: TENANT, userId: USER });
    expect(res.isBypass).toBe(true);
    expect(res.personId).toBeNull();
    expect(res.groupIds).toEqual([]);
  });

  it('нет Person → isBypass=false, personId=null, пустые группы', async () => {
    const { resolver } = buildResolver({ loadContext: { role: 'manager' }, person: null });
    const res = await resolver.resolveDirectGroupIds({ tenantId: TENANT, userId: USER });
    expect(res.isBypass).toBe(false);
    expect(res.personId).toBeNull();
    expect(res.groupIds).toEqual([]);
  });

  it('МАТРИЦА НЕ применяется: groupIds содержит свою dept-группу, но НЕ visibleGroup из policy', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager', isSuperAdmin: false },
      person: { id: 'p-1', primaryDepartmentId: 'dep-1' },
      personRoles: [],
      appointments: [],
      headOf: [],
      deptGroups: [{ id: 'g-dep-1' }],
      memberships: [],
      policies: [{ visibleGroupId: 'g-visible-via-matrix' }],
    });
    const res = await resolver.resolveDirectGroupIds({ tenantId: TENANT, userId: USER });
    expect(res.personId).toBe('p-1');
    expect(res.isBypass).toBe(false);
    expect(res.groupIds).toContain('g-dep-1');
    expect(res.groupIds).not.toContain('g-visible-via-matrix');
  });

  it('прямое членство в closed-группе → в groupIds; чужой tenant игнорируется', async () => {
    const { resolver } = buildResolver({
      loadContext: { role: 'manager' },
      person: { id: 'p-2', primaryDepartmentId: null },
      deptGroups: [],
      memberships: [
        { groupId: 'g-council', group: { kind: 'council', isClosed: true, tenantId: TENANT } },
        { groupId: 'g-other', group: { kind: 'council', isClosed: true, tenantId: 'OTHER' } },
      ],
    });
    const res = await resolver.resolveDirectGroupIds({ tenantId: TENANT, userId: USER });
    expect(res.groupIds).toContain('g-council');
    expect(res.groupIds).not.toContain('g-other');
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
  const rbac = Object.create(RbacService.prototype) as RbacService;

  it('bypass → true для любого блока', () => {
    expect(
      rbac.canAccessKnowledgeGroup({ deptGroupIds: [], closedGroupIds: [], isBypass: true }, [
        { groupId: 'g-council', isClosed: true, kind: 'council' },
      ]),
    ).toBe(true);
  });

  it('пустой blockGroups → true (блок открыт)', () => {
    expect(
      rbac.canAccessKnowledgeGroup({ deptGroupIds: [], closedGroupIds: [], isBypass: false }, []),
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

describe('KnowledgeAccessResolver.buildAccessSqlPredicate (Ф4)', () => {
  const { resolver } = buildResolver({ loadContext: { role: 'manager' } });

  it('bypass → пустая строка', () => {
    const sql = resolver.buildAccessSqlPredicate(
      { deptGroupIds: [], closedGroupIds: [], isBypass: true },
      () => '$1',
    );
    expect(sql).toBe('');
  });

  it('non-bypass → AND-фрагмент с IdeaBlockAccess и обоими placeholder', () => {
    const params: unknown[] = [];
    const pushParam = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const sql = resolver.buildAccessSqlPredicate(
      { deptGroupIds: ['g-log'], closedGroupIds: ['g-council'], isBypass: false },
      pushParam,
    );
    expect(sql).toContain('IdeaBlockAccess');
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(params).toEqual([['g-council'], ['g-log']]);
  });
});

describe('KnowledgeAccessResolver.partitionBlockIdsByAccess (Ф4)', () => {
  function buildPartitionResolver(
    accessRows: Array<{
      blockId: string;
      groupId: string;
      group: { isClosed: boolean; kind: string };
    }>,
  ): KnowledgeAccessResolver {
    const prisma = {
      ideaBlockAccess: {
        findMany: vi.fn(async () => accessRows),
      },
    } as unknown as PrismaService;
    const rbacReal = Object.create(RbacService.prototype) as RbacService;
    return new KnowledgeAccessResolver(prisma, rbacReal);
  }

  it('bypass → все accessible, denied=0 (без запроса в БД)', async () => {
    const resolver = buildPartitionResolver([]);
    const res = await resolver.partitionBlockIdsByAccess(
      { deptGroupIds: [], closedGroupIds: [], isBypass: true },
      ['b1', 'b2'],
    );
    expect(res.accessible).toEqual(['b1', 'b2']);
    expect(res.denied).toBe(0);
  });

  it('пустой вход → пустой результат', async () => {
    const resolver = buildPartitionResolver([]);
    const res = await resolver.partitionBlockIdsByAccess(
      { deptGroupIds: [], closedGroupIds: [], isBypass: false },
      [],
    );
    expect(res.accessible).toEqual([]);
    expect(res.denied).toBe(0);
  });

  it('closed-блок недоступен → denied++; открытый блок → accessible', async () => {
    const resolver = buildPartitionResolver([
      {
        blockId: 'b-closed',
        groupId: 'g-council',
        group: { isClosed: true, kind: 'council' },
      },
    ]);
    const res = await resolver.partitionBlockIdsByAccess(
      { deptGroupIds: [], closedGroupIds: [], isBypass: false },
      ['b-closed', 'b-open'],
    );
    expect(res.accessible).toEqual(['b-open']);
    expect(res.denied).toBe(1);
  });

  it('закрытый блок виден члену closed-группы (accessible)', async () => {
    const resolver = buildPartitionResolver([
      {
        blockId: 'b-closed',
        groupId: 'g-council',
        group: { isClosed: true, kind: 'council' },
      },
    ]);
    const res = await resolver.partitionBlockIdsByAccess(
      { deptGroupIds: [], closedGroupIds: ['g-council'], isBypass: false },
      ['b-closed'],
    );
    expect(res.accessible).toEqual(['b-closed']);
    expect(res.denied).toBe(0);
  });
});

describe('KnowledgeAccessResolver.partitionProjectionsByAccess (Ф6)', () => {
  function buildResolverFor(
    accessRows: Array<{
      blockId: string;
      groupId: string;
      group: { isClosed: boolean; kind: string };
    }>,
  ): KnowledgeAccessResolver {
    const prisma = {
      ideaBlockAccess: {
        findMany: vi.fn(async () => accessRows),
      },
    } as unknown as PrismaService;
    const rbacReal = Object.create(RbacService.prototype) as RbacService;
    return new KnowledgeAccessResolver(prisma, rbacReal);
  }

  it('bypass → все проекции доступны, denied=0', async () => {
    const resolver = buildResolverFor([]);
    const res = await resolver.partitionProjectionsByAccess(
      { deptGroupIds: [], closedGroupIds: [], isBypass: true },
      [
        { id: 'd1', sourceBlockIds: ['b-council'] },
        { id: 'd2', sourceBlockIds: [] },
      ],
    );
    expect(res.accessibleIds).toEqual(new Set(['d1', 'd2']));
    expect(res.denied).toBe(0);
  });

  it('пустой вход → пустой результат', async () => {
    const resolver = buildResolverFor([]);
    const res = await resolver.partitionProjectionsByAccess(
      { deptGroupIds: [], closedGroupIds: [], isBypass: false },
      [],
    );
    expect(res.accessibleIds).toEqual(new Set());
    expect(res.denied).toBe(0);
  });

  it('проекция с council-source-блоком недоступна не-члену (denied)', async () => {
    const resolver = buildResolverFor([
      {
        blockId: 'b-council',
        groupId: 'g-council',
        group: { isClosed: true, kind: 'council' },
      },
    ]);
    const res = await resolver.partitionProjectionsByAccess(
      { deptGroupIds: [], closedGroupIds: [], isBypass: false },
      [{ id: 'd-council', sourceBlockIds: ['b-council'] }],
    );
    expect(res.accessibleIds.has('d-council')).toBe(false);
    expect(res.denied).toBe(1);
  });

  it('проекция без sourceBlockIds → доступна всем', async () => {
    const resolver = buildResolverFor([]);
    const res = await resolver.partitionProjectionsByAccess(
      { deptGroupIds: [], closedGroupIds: [], isBypass: false },
      [{ id: 'd-open', sourceBlockIds: [] }],
    );
    expect(res.accessibleIds.has('d-open')).toBe(true);
    expect(res.denied).toBe(0);
  });

  it('проекция с dept-source доступна члену отдела; недоступна чужому', async () => {
    const resolver = buildResolverFor([
      {
        blockId: 'b-log',
        groupId: 'g-log',
        group: { isClosed: false, kind: 'department' },
      },
    ]);
    const member = await resolver.partitionProjectionsByAccess(
      { deptGroupIds: ['g-log'], closedGroupIds: [], isBypass: false },
      [{ id: 'd-log', sourceBlockIds: ['b-log'] }],
    );
    expect(member.accessibleIds.has('d-log')).toBe(true);
    expect(member.denied).toBe(0);

    const outsider = await resolver.partitionProjectionsByAccess(
      { deptGroupIds: ['g-sales'], closedGroupIds: [], isBypass: false },
      [{ id: 'd-log', sourceBlockIds: ['b-log'] }],
    );
    expect(outsider.accessibleIds.has('d-log')).toBe(false);
    expect(outsider.denied).toBe(1);
  });

  it('строжайшее union: любой council-source среди нескольких → проекция закрыта', async () => {
    const resolver = buildResolverFor([
      {
        blockId: 'b-council',
        groupId: 'g-council',
        group: { isClosed: true, kind: 'council' },
      },
    ]);
    const res = await resolver.partitionProjectionsByAccess(
      { deptGroupIds: [], closedGroupIds: [], isBypass: false },
      [{ id: 'd-mix', sourceBlockIds: ['b-open', 'b-council'] }],
    );
    expect(res.accessibleIds.has('d-mix')).toBe(false);
    expect(res.denied).toBe(1);
  });
});

describe('ProvenanceService.resolve — инвариант доступа (Ф1)', () => {
  it('источник закрыт: блок в closed-группе, зритель не член → accessFiltered + маскировка (название встречи не утекает)', async () => {
    const resolverPrisma = {
      ideaBlockAccess: {
        findMany: vi.fn(async () => [
          {
            blockId: 'b-council',
            groupId: 'g-council',
            group: { isClosed: true, kind: 'council' },
          },
        ]),
      },
    } as unknown as PrismaService;
    const rbacReal = Object.create(RbacService.prototype) as RbacService;
    const resolver = new KnowledgeAccessResolver(resolverPrisma, rbacReal);
    vi.spyOn(resolver, 'resolveAccessibleGroups').mockResolvedValue({
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    });

    const servicePrisma = {
      decision: {
        findFirst: vi.fn(async () => ({ sourceBlockIds: ['b-council'] })),
      },
      ideaBlock: {
        findMany: vi.fn(async () => [
          { id: 'b-council', primarySource: 'transcript' },
        ]),
      },
      ideaBlockEvidence: {
        findMany: vi.fn(async () => [
          {
            blockId: 'b-council',
            rawEventId: 'raw-1',
            quote: 'Секретная цифра выручки',
            startMs: 1000,
            endMs: 2000,
            sourceTimestamp: new Date('2026-03-10T09:00:00.000Z'),
          },
        ]),
      },
      rawEvent: {
        findMany: vi.fn(async () => [
          { id: 'raw-1', sourceType: 'meeting', sourceExternalId: 'm-secret' },
        ]),
      },
      meeting: {
        findMany: vi.fn(async () => [
          { id: 'm-secret', title: 'Закрытая планёрка совета' },
        ]),
      },
      document: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaService;

    const s3 = {
      presignGet: vi.fn(async () => ({
        url: 'https://s3.example/presigned',
        expiresAt: new Date('2026-06-21T00:10:00.000Z'),
      })),
    } as unknown as S3Service;
    const cfg = {
      getDynamic: vi.fn(async (_k: string, _e: unknown, def: unknown) => def),
    } as unknown as TypedConfigService;
    const provenance = new ProvenanceService(servicePrisma, resolver, s3, cfg);
    const nodes = await provenance.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-outsider',
    });

    expect(nodes).toHaveLength(1);
    const n = nodes[0]!;
    expect(n.accessFiltered).toBe(true);
    expect(n.quote).toBe(PROVENANCE_ACCESS_MASK);
    expect(n.source.label).toBe(PROVENANCE_ACCESS_MASK);
    expect(n.source.label).not.toContain('Закрытая планёрка');
    expect(n.source.deepLink).toBeNull();
    expect(n.startMs).toBeNull();
  });
});
