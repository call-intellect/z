import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ActivityRecorderService } from './activity-recorder.service';
import { CyclesService } from './cycles.service';
import type { IssuesService } from './issues.service';
import type { ProjectsService } from './projects.service';
import type { TrackerEventsService } from './tracker-events.service';
import type { WebhookDispatcher } from './webhook-dispatcher.service';

type Fn = ReturnType<typeof vi.fn>;

function cycleRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'c-1',
    tenantId: 't-1',
    projectId: 'p-1',
    name: 'Спринт 1',
    startDate: now,
    endDate: now,
    ownedById: null,
    description: null,
    progressSnapshot: null,
    version: 1,
    timezone: 'UTC',
    primaryGoalId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

interface PrismaStub {
  cycle: { findFirst: Fn; update: Fn };
  goal: { findFirst: Fn };
}

function makeService(prismaStub: PrismaStub): CyclesService {
  return new CyclesService(
    prismaStub as unknown as PrismaService,
    {} as unknown as ActivityRecorderService,
    {} as unknown as ProjectsService,
    {} as unknown as IssuesService,
    {} as unknown as TrackerEventsService,
    {} as unknown as WebhookDispatcher,
  );
}

describe('CyclesService.update — primaryGoalId (Goals OKR v2, Фаза 5)', () => {
  let prisma: PrismaStub;

  beforeEach(() => {
    prisma = {
      cycle: {
        findFirst: vi.fn(async () => cycleRow()),
        update: vi.fn(async () => cycleRow({ primaryGoalId: 'goal-1' })),
      },
      goal: { findFirst: vi.fn(async () => ({ id: 'goal-1' })) },
    };
  });

  it('валидная цель того же tenant → primaryGoalId в data + в ответе', async () => {
    const svc = makeService(prisma);
    const res = await svc.update('c-1', { primaryGoalId: 'goal-1' }, 't-1', 'u-1');
    expect(prisma.goal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'goal-1', tenantId: 't-1' } }),
    );
    expect(prisma.cycle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ primaryGoalId: 'goal-1' }),
      }),
    );
    expect(res.primaryGoalId).toBe('goal-1');
  });

  it('чужой/несуществующий goal → BadRequest, update не вызван', async () => {
    prisma.goal.findFirst = vi.fn(async () => null);
    const svc = makeService(prisma);
    await expect(
      svc.update('c-1', { primaryGoalId: 'foreign' }, 't-1', 'u-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cycle.update).not.toHaveBeenCalled();
  });

  it('primaryGoalId=null → отвязка без проверки goal', async () => {
    prisma.cycle.update = vi.fn(async () => cycleRow({ primaryGoalId: null }));
    const svc = makeService(prisma);
    const res = await svc.update('c-1', { primaryGoalId: null }, 't-1', 'u-1');
    expect(prisma.goal.findFirst).not.toHaveBeenCalled();
    expect(prisma.cycle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ primaryGoalId: null }),
      }),
    );
    expect(res.primaryGoalId).toBeNull();
  });
});
