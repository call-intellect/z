import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuditLogService } from '../audit/audit-log.service';

import { DepartmentsService } from './services/departments.service';

interface DeptSeed {
  id: string;
  tenantId: string;
  parentDepartmentId?: string | null;
  headPersonId?: string | null;
  entityId?: string | null;
  deletedAt?: Date | null;
  name?: string;
}

interface DomainLinkSeed {
  id: string;
  departmentId: string;
  domainId: string;
}

function makeAudit(): AuditLogService {
  return { log: vi.fn(async () => undefined) } as unknown as AuditLogService;
}

function makePrisma(opts: {
  departments: DeptSeed[];
  domainLinks?: { source: DomainLinkSeed[]; target: DomainLinkSeed[] };
}) {
  const byId = new Map(opts.departments.map((d) => [d.id, { ...d }]));

  const calls = {
    roleUpdateMany: [] as unknown[],
    appointmentUpdateMany: [] as unknown[],
    projectUpdateMany: [] as unknown[],
    personUpdateMany: [] as unknown[],
    childUpdateMany: [] as unknown[],
    domainLinkUpdate: [] as unknown[],
    domainLinkDelete: [] as unknown[],
    metricUpdateMany: [] as unknown[],
    interactionUpdateMany: [] as unknown[],
    orgUnitUpdateMany: [] as unknown[],
    deptUpdate: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  };

  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    department: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const d = byId.get(where.id);
        return d
          ? {
              id: d.id,
              tenantId: d.tenantId,
              parentDepartmentId: d.parentDepartmentId ?? null,
              headPersonId: d.headPersonId ?? null,
              entityId: d.entityId ?? null,
              deletedAt: d.deletedAt ?? null,
              name: d.name ?? d.id,
            }
          : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
        const d = byId.get(where.id);
        if (!d || d.tenantId !== where.tenantId) return null;
        return { parentDepartmentId: d.parentDepartmentId ?? null };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const d = byId.get(where.id);
        if (!d) throw new Error('not found');
        return {
          id: d.id,
          name: d.name ?? d.id,
          parentDepartmentId: d.parentDepartmentId ?? null,
          headPersonId: d.headPersonId ?? null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          deletedAt: d.deletedAt ?? null,
        };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          calls.deptUpdate.push({ where, data });
          const d = byId.get(where.id);
          if (d) Object.assign(d, data);
          return d;
        },
      ),
      updateMany: vi.fn(async (arg: unknown) => {
        calls.childUpdateMany.push(arg);
        return { count: 2 };
      }),
      groupBy: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    role: {
      updateMany: vi.fn(async (arg: unknown) => {
        calls.roleUpdateMany.push(arg);
        return { count: 3 };
      }),
      groupBy: vi.fn(async () => []),
    },
    appointment: {
      updateMany: vi.fn(async (arg: unknown) => {
        calls.appointmentUpdateMany.push(arg);
        return { count: 1 };
      }),
    },
    project: {
      updateMany: vi.fn(async (arg: unknown) => {
        calls.projectUpdateMany.push(arg);
        return { count: 4 };
      }),
    },
    person: {
      updateMany: vi.fn(async (arg: unknown) => {
        calls.personUpdateMany.push(arg);
        return { count: 5 };
      }),
    },
    departmentDomainLink: {
      findMany: vi.fn(async ({ where }: { where: { departmentId: string } }) => {
        if (!opts.domainLinks) return [];
        return where.departmentId === opts.domainLinks.source[0]?.departmentId ||
          opts.domainLinks.source.some((l) => l.departmentId === where.departmentId)
          ? opts.domainLinks.source.filter((l) => l.departmentId === where.departmentId)
          : opts.domainLinks.target.filter((l) => l.departmentId === where.departmentId);
      }),
      update: vi.fn(async (arg: unknown) => {
        calls.domainLinkUpdate.push(arg);
        return {};
      }),
      delete: vi.fn(async (arg: unknown) => {
        calls.domainLinkDelete.push(arg);
        return {};
      }),
    },
    metric: {
      updateMany: vi.fn(async (arg: unknown) => {
        calls.metricUpdateMany.push(arg);
        return { count: 6 };
      }),
    },
    interaction: {
      updateMany: vi.fn(async (arg: unknown) => {
        calls.interactionUpdateMany.push(arg);
        return { count: 7 };
      }),
    },
    orgUnit: {
      updateMany: vi.fn(async (arg: unknown) => {
        calls.orgUnitUpdateMany.push(arg);
        return { count: 8 };
      }),
    },
  };

  return { prisma: prisma as unknown as PrismaService, calls, byId };
}

function makeService(prisma: PrismaService): DepartmentsService {
  return new DepartmentsService(prisma, makeAudit());
}

const TENANT = 't1';

describe('DepartmentsService.mergeDepartments', () => {
  it('переносит все 10 FK/ссылок source→target и soft-удаляет source', async () => {
    const { prisma, calls, byId } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT },
        { id: 'dst', tenantId: TENANT },
      ],
    });
    const svc = makeService(prisma);

    const res = await svc.mergeDepartments({
      tenantId: TENANT,
      sourceId: 'src',
      targetId: 'dst',
      byUserId: 'u1',
    });

    expect(calls.roleUpdateMany[0]).toEqual({
      where: { tenantId: TENANT, departmentId: 'src' },
      data: { departmentId: 'dst' },
    });
    expect(calls.appointmentUpdateMany[0]).toEqual({
      where: { tenantId: TENANT, departmentId: 'src' },
      data: { departmentId: 'dst' },
    });
    expect(calls.projectUpdateMany[0]).toEqual({
      where: { tenantId: TENANT, departmentId: 'src' },
      data: { departmentId: 'dst' },
    });
    expect(calls.personUpdateMany[0]).toEqual({
      where: { tenantId: TENANT, primaryDepartmentId: 'src' },
      data: { primaryDepartmentId: 'dst' },
    });
    expect(calls.childUpdateMany).toContainEqual({
      where: { tenantId: TENANT, parentDepartmentId: 'src' },
      data: { parentDepartmentId: 'dst' },
    });
    expect(calls.metricUpdateMany[0]).toEqual({
      where: { tenantId: TENANT, attachedToDepartmentId: 'src' },
      data: { attachedToDepartmentId: 'dst' },
    });
    expect(calls.interactionUpdateMany[0]).toEqual({
      where: { tenantId: TENANT, counterpartDepartmentId: 'src' },
      data: { counterpartDepartmentId: 'dst' },
    });
    expect(calls.orgUnitUpdateMany[0]).toEqual({
      where: { tenantId: TENANT, parentDepartmentId: 'src' },
      data: { parentDepartmentId: 'dst' },
    });

    expect(byId.get('src')?.deletedAt).toBeInstanceOf(Date);

    expect(res.ok).toBe(true);
    expect(res.target.id).toBe('dst');
    expect(res.moved).toMatchObject({
      roles: 3,
      appointments: 1,
      projects: 4,
      persons: 5,
      childDepartments: 2,
      metrics: 6,
      interactions: 7,
      orgUnits: 8,
    });
  });

  it('DepartmentDomainLink: дубль домена → delete, новый → update на target', async () => {
    const { prisma, calls } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT },
        { id: 'dst', tenantId: TENANT },
      ],
      domainLinks: {
        source: [
          { id: 'ls1', departmentId: 'src', domainId: 'd-shared' },
          { id: 'ls2', departmentId: 'src', domainId: 'd-new' },
        ],
        target: [{ id: 'lt1', departmentId: 'dst', domainId: 'd-shared' }],
      },
    });
    const svc = makeService(prisma);

    const res = await svc.mergeDepartments({
      tenantId: TENANT,
      sourceId: 'src',
      targetId: 'dst',
      byUserId: 'u1',
    });

    expect(calls.domainLinkDelete).toContainEqual({ where: { id: 'ls1' } });
    expect(calls.domainLinkUpdate).toContainEqual({
      where: { id: 'ls2' },
      data: { departmentId: 'dst' },
    });
    expect(res.moved.domainLinks).toBe(1);
  });

  it('переносит headPersonId source→target только если у target пусто', async () => {
    const { prisma, calls } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT, headPersonId: 'head-src' },
        { id: 'dst', tenantId: TENANT, headPersonId: null },
      ],
    });
    const svc = makeService(prisma);
    await svc.mergeDepartments({
      tenantId: TENANT,
      sourceId: 'src',
      targetId: 'dst',
      byUserId: 'u1',
    });
    expect(calls.deptUpdate).toContainEqual({
      where: { id: 'dst' },
      data: { headPersonId: 'head-src' },
    });
  });

  it('НЕ затирает headPersonId target, если он уже задан', async () => {
    const { prisma, calls } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT, headPersonId: 'head-src' },
        { id: 'dst', tenantId: TENANT, headPersonId: 'head-dst' },
      ],
    });
    const svc = makeService(prisma);
    await svc.mergeDepartments({
      tenantId: TENANT,
      sourceId: 'src',
      targetId: 'dst',
      byUserId: 'u1',
    });
    expect(calls.deptUpdate).not.toContainEqual({
      where: { id: 'dst' },
      data: { headPersonId: 'head-src' },
    });
  });

  it('entityId: переносит с обходом UNIQUE (обнулить source → присвоить target), если у target пусто', async () => {
    const { prisma, calls } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT, entityId: 'ent-src' },
        { id: 'dst', tenantId: TENANT, entityId: null },
      ],
    });
    const svc = makeService(prisma);
    const res = await svc.mergeDepartments({
      tenantId: TENANT,
      sourceId: 'src',
      targetId: 'dst',
      byUserId: 'u1',
    });

    const srcNull = calls.deptUpdate.findIndex(
      (c) => c.where.id === 'src' && c.data.entityId === null,
    );
    const dstSet = calls.deptUpdate.findIndex(
      (c) => c.where.id === 'dst' && c.data.entityId === 'ent-src',
    );
    expect(srcNull).toBeGreaterThanOrEqual(0);
    expect(dstSet).toBeGreaterThanOrEqual(0);
    expect(srcNull).toBeLessThan(dstSet);
    expect(res.moved.entity).toBe(1);
  });

  it('entityId: НЕ трогает, если у target уже есть entityId (source осиротеет)', async () => {
    const { prisma, calls } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT, entityId: 'ent-src' },
        { id: 'dst', tenantId: TENANT, entityId: 'ent-dst' },
      ],
    });
    const svc = makeService(prisma);
    const res = await svc.mergeDepartments({
      tenantId: TENANT,
      sourceId: 'src',
      targetId: 'dst',
      byUserId: 'u1',
    });

    expect(calls.deptUpdate.some((c) => c.where.id === 'dst' && 'entityId' in c.data)).toBe(false);
    expect(calls.deptUpdate.some((c) => c.where.id === 'src' && c.data.entityId === null)).toBe(
      false,
    );
    expect(res.moved.entity).toBe(0);
  });

  it('регресс A2: после merge — 0 висячих ссылок (все перенесённые FK source→target)', async () => {
    const { prisma, calls } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT, entityId: 'ent-src' },
        { id: 'dst', tenantId: TENANT, entityId: null },
      ],
    });
    const svc = makeService(prisma);
    await svc.mergeDepartments({
      tenantId: TENANT,
      sourceId: 'src',
      targetId: 'dst',
      byUserId: 'u1',
    });

    expect(calls.roleUpdateMany).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ departmentId: 'src' }),
        data: expect.objectContaining({ departmentId: 'dst' }),
      }),
    );
    expect(calls.appointmentUpdateMany).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ departmentId: 'src' }),
        data: expect.objectContaining({ departmentId: 'dst' }),
      }),
    );
    expect(calls.projectUpdateMany).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ departmentId: 'src' }),
        data: expect.objectContaining({ departmentId: 'dst' }),
      }),
    );
    expect(calls.personUpdateMany).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ primaryDepartmentId: 'src' }),
        data: expect.objectContaining({ primaryDepartmentId: 'dst' }),
      }),
    );
    expect(calls.childUpdateMany).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ parentDepartmentId: 'src' }),
        data: expect.objectContaining({ parentDepartmentId: 'dst' }),
      }),
    );
    expect(calls.metricUpdateMany).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ attachedToDepartmentId: 'src' }),
        data: expect.objectContaining({ attachedToDepartmentId: 'dst' }),
      }),
    );
    expect(calls.interactionUpdateMany).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ counterpartDepartmentId: 'src' }),
        data: expect.objectContaining({ counterpartDepartmentId: 'dst' }),
      }),
    );
    expect(calls.orgUnitUpdateMany).toContainEqual(
      expect.objectContaining({
        where: expect.objectContaining({ parentDepartmentId: 'src' }),
        data: expect.objectContaining({ parentDepartmentId: 'dst' }),
      }),
    );
    expect(calls.deptUpdate).toContainEqual(
      expect.objectContaining({
        where: { id: 'dst' },
        data: expect.objectContaining({ entityId: 'ent-src' }),
      }),
    );
  });

  it('self-merge (source===target) → BadRequest', async () => {
    const { prisma } = makePrisma({
      departments: [{ id: 'src', tenantId: TENANT }],
    });
    const svc = makeService(prisma);
    await expect(
      svc.mergeDepartments({
        tenantId: TENANT,
        sourceId: 'src',
        targetId: 'src',
        byUserId: 'u1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('запрет цикла: target — потомок source → BadRequest', async () => {
    const { prisma } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT },
        { id: 'dst', tenantId: TENANT, parentDepartmentId: 'src' },
      ],
    });
    const svc = makeService(prisma);
    await expect(
      svc.mergeDepartments({
        tenantId: TENANT,
        sourceId: 'src',
        targetId: 'dst',
        byUserId: 'u1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('повторный merge уже удалённого source → BadRequest (не 500)', async () => {
    const { prisma } = makePrisma({
      departments: [
        { id: 'src', tenantId: TENANT, deletedAt: new Date('2026-06-01T00:00:00.000Z') },
        { id: 'dst', tenantId: TENANT },
      ],
    });
    const svc = makeService(prisma);
    await expect(
      svc.mergeDepartments({
        tenantId: TENANT,
        sourceId: 'src',
        targetId: 'dst',
        byUserId: 'u1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
