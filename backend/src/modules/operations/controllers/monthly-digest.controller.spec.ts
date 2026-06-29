import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RbacService } from '../../rbac/rbac.service';
import type { MonthlyDigestQuery, MonthlyOperationsDigestDto } from '../dto/monthly-digest.dto';
import type { MonthlyDigestService } from '../services/monthly-digest.service';

import { MonthlyDigestController } from './monthly-digest.controller';

const QUERY: MonthlyDigestQuery = { period: '2026-05' };

const DTO: MonthlyOperationsDigestDto = {
  id: 'md1',
  tenantId: 't-1',
  periodYm: '2026-05',
  bodyMarkdown: 'текст',
  metrics: {
    weeksCount: 0,
    missingWeeks: [],
    avgGreenShare: 0,
    avgRedShare: 0,
    totalCheckIns: 0,
    goalsCompleted: 0,
    goalsFailed: 0,
    topBlockers: [],
    reliabilityPercent: null,
    tasksDone: 0,
    tasksPlanned: 0,
    tasksNotDone: 0,
  },
  sources: { weeklyDigestIds: [], goalIds: [] },
  llmTaskRouteId: 'deepseek',
  createdAt: '2026-06-01T03:00:00Z',
};

function buildController(opts: {
  canView?: boolean;
  stored?: MonthlyOperationsDigestDto | null;
  latest?: MonthlyOperationsDigestDto | null;
  role?: string;
  isSuperAdmin?: boolean;
}) {
  const getStored = vi.fn(async () => opts.stored ?? null);
  const getLatest = vi.fn(async () => opts.latest ?? null);
  const generate = vi.fn(async () => DTO);
  const svc = { getStored, getLatest, generate } as unknown as MonthlyDigestService;

  const canViewOperationsDashboard = vi.fn(async () => opts.canView ?? true);
  const loadContext = vi.fn(async () => ({
    role: opts.role ?? 'owner',
    isSuperAdmin: opts.isSuperAdmin ?? false,
  }));
  const rbac = { canViewOperationsDashboard, loadContext } as unknown as RbacService;

  const controller = new MonthlyDigestController(svc, rbac);
  return { controller, getStored, getLatest, generate, canViewOperationsDashboard };
}

function reqWithUser(userId: string | undefined): Request {
  return { user: userId ? { id: userId } : undefined } as unknown as Request;
}

describe('MonthlyDigestController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('get: доступ есть и сводка найдена → возвращает dto', async () => {
    const { controller, getStored } = buildController({ canView: true, stored: DTO });
    const out = await controller.get('t-1', reqWithUser('u-1'), QUERY);
    expect(out).toEqual(DTO);
    expect(getStored).toHaveBeenCalledWith({ tenantId: 't-1', periodYm: '2026-05' });
  });

  it('get: rbac.canViewOperationsDashboard=false → ForbiddenException', async () => {
    const { controller } = buildController({ canView: false, stored: DTO });
    await expect(controller.get('t-1', reqWithUser('u-1'), QUERY)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('get: сводки нет → NotFoundException(digest_not_found)', async () => {
    const { controller } = buildController({ canView: true, stored: null });
    await expect(controller.get('t-1', reqWithUser('u-1'), QUERY)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('latest: доступ есть и есть последняя → dto', async () => {
    const { controller, getLatest } = buildController({ canView: true, latest: DTO });
    const out = await controller.getLatest('t-1', reqWithUser('u-1'));
    expect(out).toEqual(DTO);
    expect(getLatest).toHaveBeenCalledWith({ tenantId: 't-1' });
  });

  it('generate: role member → ForbiddenException', async () => {
    const { controller, generate } = buildController({ role: 'member' });
    await expect(controller.generate('t-1', reqWithUser('u-1'), QUERY)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('generate: role owner → svc.generate вызван', async () => {
    const { controller, generate } = buildController({ role: 'owner' });
    const out = await controller.generate('t-1', reqWithUser('u-1'), QUERY);
    expect(out).toEqual(DTO);
    expect(generate).toHaveBeenCalledWith({ tenantId: 't-1', periodYm: '2026-05' });
  });
});
