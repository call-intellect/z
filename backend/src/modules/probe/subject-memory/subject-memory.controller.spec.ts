import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';

import type { ListSubjectMemoryQuery } from './dto/subject-memory.dto';
import { SubjectMemoryController } from './subject-memory.controller';

const user = { id: 'user-1' } as CurrentUserPayload;
const query: ListSubjectMemoryQuery = { page: 1, limit: 50 };

function makeController(args: {
  canView: boolean;
  findMany?: unknown[];
  count?: number;
  grouped?: Array<{ status: string; _count: { _all: number } }>;
}): {
  controller: SubjectMemoryController;
  findMany: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(args.findMany ?? []);
  const count = vi.fn().mockResolvedValue(args.count ?? 0);
  const groupBy = vi.fn().mockResolvedValue(args.grouped ?? []);
  const prisma = {
    subjectMemory: { findMany, count, groupBy },
  } as unknown as PrismaService;
  const rbac = {
    canViewOperationsDashboard: vi.fn().mockResolvedValue(args.canView),
  } as unknown as RbacService;
  return { controller: new SubjectMemoryController(prisma, rbac), findMany, groupBy };
}

describe('SubjectMemoryController.list', () => {
  it('бросает ForbiddenException, если нет прав operations-dashboard', async () => {
    const { controller } = makeController({ canView: false });
    await expect(controller.list(query, user, 'org-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('бросает BadRequestException (tenant_required), если tenantId не задан', async () => {
    const { controller } = makeController({ canView: true });
    await expect(controller.list(query, user, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('возвращает правила: confidence как number, ISO-даты, countsByStatus', async () => {
    const occurredAt = new Date('2026-06-20T10:00:00.000Z');
    const lastAppliedAt = new Date('2026-06-22T08:30:00.000Z');
    const createdAt = new Date('2026-06-19T09:00:00.000Z');
    const { controller } = makeController({
      canView: true,
      count: 2,
      grouped: [{ status: 'active', _count: { _all: 2 } }],
      findMany: [
        {
          id: 'sm-1',
          kind: 'term',
          contextText: 'КП',
          ruleText: 'коммерческое предложение',
          status: 'active',
          confidence: 0.83,
          confirmCount: 3,
          refuteCount: 0,
          sourceProbeIds: ['p-1'],
          appliedCount: 5,
          occurredAt,
          lastAppliedAt,
          createdAt,
        },
      ],
    });

    const res = await controller.list(query, user, 'org-1');

    expect(res.total).toBe(2);
    expect(res.countsByStatus.active).toBe(2);
    expect(res.items[0]).toEqual(
      expect.objectContaining({
        id: 'sm-1',
        confidence: 0.83,
        occurredAt: occurredAt.toISOString(),
        lastAppliedAt: lastAppliedAt.toISOString(),
        createdAt: createdAt.toISOString(),
      }),
    );
    expect(typeof res.items[0]!.confidence).toBe('number');
  });
});
