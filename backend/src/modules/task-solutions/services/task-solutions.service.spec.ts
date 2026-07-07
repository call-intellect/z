import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import { ListTaskSolutionsQuerySchema } from '../dto/task-solutions.dto';

import { TaskSolutionsService } from './task-solutions.service';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

function makeTaskSolution(over: Record<string, unknown> = {}) {
  return {
    id: 'ts-1',
    tenantId: 't-1',
    title: 'Решение по онбордингу',
    taskDescription: 'Как оформить нового сотрудника',
    solutionMd: '# Шаги',
    ownerPersonId: 'p-1',
    personSubjectIds: [] as string[],
    sourceIssueId: 'iss-1',
    sourceBlockIds: [] as string[],
    skillTags: ['onboarding'] as string[],
    status: 'active',
    version: 1,
    currentVersionId: null,
    confidence: null,
    promotedToInstructionId: null,
    repeatGroupKey: null,
    candidateInstruction: false,
    previewQuote: null,
    previewSourceRef: null,
    dataClass: 'internal',
    lastConfirmedAt: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    deletedAt: null,
    deletedById: null,
    ...over,
  };
}

describe('TaskSolutionsService — list', () => {
  let tsFindMany: ReturnType<typeof vi.fn>;
  let tsCount: ReturnType<typeof vi.fn>;
  let tsGroupBy: ReturnType<typeof vi.fn>;
  let personFindMany: ReturnType<typeof vi.fn>;
  let svc: TaskSolutionsService;

  beforeEach(() => {
    tsFindMany = vi.fn();
    tsCount = vi.fn();
    tsGroupBy = vi.fn().mockResolvedValue([]);
    personFindMany = vi.fn().mockResolvedValue([]);

    const prisma = {
      taskSolution: { findMany: tsFindMany, count: tsCount, groupBy: tsGroupBy },
      person: { findMany: personFindMany },
    } as unknown as PrismaService;
    svc = new TaskSolutionsService(prisma);
  });

  it('q → OR contains по title/taskDescription/solutionMd', async () => {
    tsFindMany.mockResolvedValue([]);
    tsCount.mockResolvedValue(0);

    const query = ListTaskSolutionsQuerySchema.parse({ q: 'онбординг' });
    await svc.list({ tenantId: 't-1', query });

    expect(tsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't-1',
          deletedAt: null,
          OR: [
            { title: { contains: 'онбординг', mode: 'insensitive' } },
            { taskDescription: { contains: 'онбординг', mode: 'insensitive' } },
            { solutionMd: { contains: 'онбординг', mode: 'insensitive' } },
          ],
        }),
      }),
    );
  });

  it('skill → skillTags has', async () => {
    tsFindMany.mockResolvedValue([]);
    tsCount.mockResolvedValue(0);

    const query = ListTaskSolutionsQuerySchema.parse({ skill: 'onboarding' });
    await svc.list({ tenantId: 't-1', query });

    expect(tsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ skillTags: { has: 'onboarding' } }),
      }),
    );
  });

  it('пагинация → total/page/limit/totalPages + skip/take', async () => {
    tsFindMany.mockResolvedValue([makeTaskSolution()]);
    tsCount.mockResolvedValue(120);

    const query = ListTaskSolutionsQuerySchema.parse({ page: '2', limit: '50' });
    const res = await svc.list({ tenantId: 't-1', query });

    expect(res.total).toBe(120);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(50);
    expect(res.totalPages).toBe(3);
    expect(tsFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 50 }));
  });

  it('ownerName резолвится из person.findMany', async () => {
    tsFindMany.mockResolvedValue([makeTaskSolution({ ownerPersonId: 'p-9' })]);
    tsCount.mockResolvedValue(1);
    personFindMany.mockResolvedValue([{ id: 'p-9', name: 'Игорь' }]);

    const query = ListTaskSolutionsQuerySchema.parse({});
    const res = await svc.list({ tenantId: 't-1', query });

    expect(res.items[0]?.ownerName).toBe('Игорь');
  });

  it('repeatGroupSize из groupBy проставляется', async () => {
    tsFindMany.mockResolvedValue([makeTaskSolution({ repeatGroupKey: 'grp-a' })]);
    tsCount.mockResolvedValue(1);
    tsGroupBy.mockResolvedValue([{ repeatGroupKey: 'grp-a', _count: { _all: 3 } }]);

    const query = ListTaskSolutionsQuerySchema.parse({});
    const res = await svc.list({ tenantId: 't-1', query });

    expect(res.items[0]?.repeatGroupSize).toBe(3);
    expect(tsGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['repeatGroupKey'],
        where: expect.objectContaining({ repeatGroupKey: { in: ['grp-a'] } }),
      }),
    );
  });

  it('taskDescription в list обрезается до 280 символов', async () => {
    const long = 'а'.repeat(500);
    tsFindMany.mockResolvedValue([makeTaskSolution({ taskDescription: long })]);
    tsCount.mockResolvedValue(1);

    const query = ListTaskSolutionsQuerySchema.parse({});
    const res = await svc.list({ tenantId: 't-1', query });

    expect(res.items[0]?.taskDescription.length).toBe(280);
  });
});

describe('TaskSolutionsService — getById', () => {
  let tsFindFirst: ReturnType<typeof vi.fn>;
  let tsGroupBy: ReturnType<typeof vi.fn>;
  let personFindMany: ReturnType<typeof vi.fn>;
  let issueFindFirst: ReturnType<typeof vi.fn>;
  let svc: TaskSolutionsService;

  beforeEach(() => {
    tsFindFirst = vi.fn();
    tsGroupBy = vi.fn().mockResolvedValue([]);
    personFindMany = vi.fn().mockResolvedValue([]);
    issueFindFirst = vi.fn().mockResolvedValue(null);

    const prisma = {
      taskSolution: { findFirst: tsFindFirst, groupBy: tsGroupBy },
      person: { findMany: personFindMany },
      issue: { findFirst: issueFindFirst },
    } as unknown as PrismaService;
    svc = new TaskSolutionsService(prisma);
  });

  it('нет записи → NotFoundException (task_solution_not_found)', async () => {
    tsFindFirst.mockResolvedValue(null);

    await expect(svc.getById({ tenantId: 't-1', id: 'nope' })).rejects.toMatchObject({
      response: { error: { code: 'task_solution_not_found' } },
    });
  });

  it('есть запись → detail с полным solutionMd + sourceIssueIdentifier/Title', async () => {
    tsFindFirst.mockResolvedValue(makeTaskSolution({ solutionMd: '# Полное решение' }));
    issueFindFirst.mockResolvedValue({ identifier: 'ENG-42', title: 'Онбординг' });

    const res = await svc.getById({ tenantId: 't-1', id: 'ts-1' });

    expect(res.solutionMd).toBe('# Полное решение');
    expect(res.sourceIssueIdentifier).toBe('ENG-42');
    expect(res.sourceIssueTitle).toBe('Онбординг');
    expect(res.version).toBe(1);
    expect(res.dataClass).toBe('internal');
  });
});

describe('TaskSolutionsService — confirm', () => {
  let tsFindFirst: ReturnType<typeof vi.fn>;
  let tsUpdate: ReturnType<typeof vi.fn>;
  let svc: TaskSolutionsService;

  beforeEach(() => {
    tsFindFirst = vi.fn();
    tsUpdate = vi.fn().mockResolvedValue({ id: 'ts-1' });

    const prisma = {
      taskSolution: { findFirst: tsFindFirst, update: tsUpdate },
    } as unknown as PrismaService;
    svc = new TaskSolutionsService(prisma);
  });

  it('обновляет lastConfirmedAt', async () => {
    tsFindFirst.mockResolvedValue({ id: 'ts-1' });

    const res = await svc.confirm({ tenantId: 't-1', id: 'ts-1' });

    expect(res.ok).toBe(true);
    expect(typeof res.lastConfirmedAt).toBe('string');
    expect(tsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ts-1' },
        data: { lastConfirmedAt: expect.any(Date) },
      }),
    );
  });

  it('нет записи → NotFound, update не зван', async () => {
    tsFindFirst.mockResolvedValue(null);

    await expect(svc.confirm({ tenantId: 't-1', id: 'ts-1' })).rejects.toThrow();
    expect(tsUpdate).not.toHaveBeenCalled();
  });
});

describe('TaskSolutionsService — softDelete / restore', () => {
  let tsFindFirst: ReturnType<typeof vi.fn>;
  let tsUpdate: ReturnType<typeof vi.fn>;
  let auditLog: ReturnType<typeof vi.fn>;
  let svc: TaskSolutionsService;

  beforeEach(() => {
    tsFindFirst = vi.fn();
    tsUpdate = vi.fn().mockResolvedValue({ id: 'ts-1' });
    auditLog = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      taskSolution: { findFirst: tsFindFirst, update: tsUpdate },
    } as unknown as PrismaService;
    const audit = { log: auditLog } as unknown as AuditLogService;
    svc = new TaskSolutionsService(prisma, null, audit);
  });

  it('softDelete: проставляет deletedAt/deletedById + audit TASK_SOLUTION_DELETE', async () => {
    tsFindFirst.mockResolvedValue({ id: 'ts-1' });

    const res = await svc.softDelete({ tenantId: 't-1', id: 'ts-1', actorUserId: 'u-1' });

    expect(res).toEqual({ ok: true });
    expect(tsUpdate).toHaveBeenCalledWith({
      where: { id: 'ts-1' },
      data: { deletedAt: expect.any(Date), deletedById: 'u-1' },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'task_solution.delete',
        userId: 'u-1',
        resourceId: 'ts-1',
      }),
    );
  });

  it('softDelete: нет активной записи → NotFound, update не зван', async () => {
    tsFindFirst.mockResolvedValue(null);

    await expect(
      svc.softDelete({ tenantId: 't-1', id: 'ts-1', actorUserId: 'u-1' }),
    ).rejects.toThrow();
    expect(tsUpdate).not.toHaveBeenCalled();
  });

  it('restore: deletedAt===null → ранний return (update/audit НЕ зван)', async () => {
    tsFindFirst.mockResolvedValue({ id: 'ts-1', deletedAt: null });

    const res = await svc.restore({ tenantId: 't-1', id: 'ts-1', actorUserId: 'u-1' });

    expect(res).toEqual({ ok: true });
    expect(tsUpdate).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('restore: удалённую → восстанавливает + audit TASK_SOLUTION_RESTORE', async () => {
    tsFindFirst.mockResolvedValue({ id: 'ts-1', deletedAt: FIXED_DATE });

    const res = await svc.restore({ tenantId: 't-1', id: 'ts-1', actorUserId: 'u-1' });

    expect(res).toEqual({ ok: true });
    expect(tsUpdate).toHaveBeenCalledWith({
      where: { id: 'ts-1' },
      data: { deletedAt: null, deletedById: null },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task_solution.restore', resourceId: 'ts-1' }),
    );
  });

  it('restore: lookup НЕ фильтрует deletedAt', async () => {
    tsFindFirst.mockResolvedValue({ id: 'ts-1', deletedAt: FIXED_DATE });

    await svc.restore({ tenantId: 't-1', id: 'ts-1', actorUserId: 'u-1' });

    const call = tsFindFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where).not.toHaveProperty('deletedAt');
  });
});

describe('TaskSolutionsService — getSummary', () => {
  it('считает total/candidates/weekDelta с tenant-фильтром', async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3);

    const prisma = { taskSolution: { count } } as unknown as PrismaService;
    const svc = new TaskSolutionsService(prisma);

    const res = await svc.getSummary('t-1');

    expect(res).toEqual({ total: 12, candidates: 4, weekDelta: 3 });
    expect(count).toHaveBeenNthCalledWith(1, { where: { tenantId: 't-1', deletedAt: null } });
    expect(count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't-1',
          deletedAt: null,
          candidateInstruction: true,
          promotedToInstructionId: null,
        }),
      }),
    );
    expect(count).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });
});
