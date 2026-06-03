import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { Specialist36Service } from '../../knowledge-core/services/specialist-3-6-ideas.service';

import { IdeasService } from './ideas.service';

/**
 * Goals OKR v2 (Фаза 5, мост к гипотезам) — unit-тесты `IdeasService.linkGoal`:
 *   - ставит goalId при валидной цели того же tenant;
 *   - чужой/несуществующий goal → BadRequest;
 *   - goalId=null отвязывает (update вызван с goalId:null).
 */

type Fn = ReturnType<typeof vi.fn>;

interface PrismaStub {
  idea: { findFirst: Fn; update: Fn };
  goal: { findFirst: Fn };
}

function makeService(prismaStub: PrismaStub): {
  svc: IdeasService;
  audit: { log: Fn };
} {
  const audit = { log: vi.fn(async () => undefined) };
  const svc = new IdeasService(
    prismaStub as unknown as PrismaService,
    {} as unknown as Specialist36Service,
    audit as unknown as AuditLogService,
  );
  return { svc, audit };
}

describe('IdeasService.linkGoal (Goals OKR v2, Фаза 5)', () => {
  let prisma: PrismaStub;

  beforeEach(() => {
    prisma = {
      idea: {
        findFirst: vi.fn(async () => ({ id: 'idea-1' })),
        update: vi.fn(async () => ({ id: 'idea-1' })),
      },
      goal: {
        findFirst: vi.fn(async () => ({ id: 'goal-1' })),
      },
    };
  });

  it('ставит goalId при валидной цели того же tenant', async () => {
    const { svc } = makeService(prisma);
    const res = await svc.linkGoal({
      tenantId: 't-1',
      ideaId: 'idea-1',
      goalId: 'goal-1',
      userId: 'u-1',
    });
    expect(res).toEqual({ ok: true, goalId: 'goal-1' });
    expect(prisma.idea.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idea-1' },
        data: { goalId: 'goal-1' },
      }),
    );
  });

  it('идея не найдена → NotFound', async () => {
    prisma.idea.findFirst = vi.fn(async () => null);
    const { svc } = makeService(prisma);
    await expect(
      svc.linkGoal({
        tenantId: 't-1',
        ideaId: 'nope',
        goalId: 'goal-1',
        userId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.idea.update).not.toHaveBeenCalled();
  });

  it('чужой/несуществующий goal → BadRequest (goal_not_found)', async () => {
    prisma.goal.findFirst = vi.fn(async () => null);
    const { svc } = makeService(prisma);
    await expect(
      svc.linkGoal({
        tenantId: 't-1',
        ideaId: 'idea-1',
        goalId: 'foreign-goal',
        userId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.idea.update).not.toHaveBeenCalled();
  });

  it('goalId=null отвязывает (update с goalId:null, goal не проверяется)', async () => {
    const { svc } = makeService(prisma);
    const res = await svc.linkGoal({
      tenantId: 't-1',
      ideaId: 'idea-1',
      goalId: null,
      userId: 'u-1',
    });
    expect(res).toEqual({ ok: true, goalId: null });
    expect(prisma.goal.findFirst).not.toHaveBeenCalled();
    expect(prisma.idea.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idea-1' },
        data: { goalId: null },
      }),
    );
  });
});
