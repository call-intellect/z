import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { RbacService } from '../../rbac/rbac.service';
import type { AvailablePeriodsDto } from '../dto/available-periods.dto';
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

const PERIODS_DTO: AvailablePeriodsDto = {
  rhythm: 'month',
  periods: [{ period: '2026-05', stateHint: 'warn', title: 'Месяц сдвига' }],
  latest: '2026-05',
};

function buildController(opts: {
  canView?: boolean;
  stored?: MonthlyOperationsDigestDto | null;
  latest?: MonthlyOperationsDigestDto | null;
  role?: string;
  isSuperAdmin?: boolean;
  recentLimit?: number;
}) {
  const getStored = vi.fn(async () => opts.stored ?? null);
  const getLatest = vi.fn(async () => opts.latest ?? null);
  const generate = vi.fn(async () => DTO);
  const listAvailablePeriods = vi.fn(async () => PERIODS_DTO);
  const svc = {
    getStored,
    getLatest,
    generate,
    listAvailablePeriods,
  } as unknown as MonthlyDigestService;

  const canViewOperationsDashboard = vi.fn(async () => opts.canView ?? true);
  const loadContext = vi.fn(async () => ({
    role: opts.role ?? 'owner',
    isSuperAdmin: opts.isSuperAdmin ?? false,
  }));
  const rbac = { canViewOperationsDashboard, loadContext } as unknown as RbacService;

  const getDynamic = vi.fn(async () => opts.recentLimit ?? 12);
  const cfg = { getDynamic } as unknown as TypedConfigService;

  const controller = new MonthlyDigestController(svc, rbac, cfg);
  return {
    controller,
    getStored,
    getLatest,
    generate,
    listAvailablePeriods,
    canViewOperationsDashboard,
    getDynamic,
  };
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

  it('availablePeriods: доступ есть → dto, лимит из крутилки', async () => {
    const { controller, listAvailablePeriods, getDynamic } = buildController({ canView: true });
    const out = await controller.availablePeriods('t-1', reqWithUser('u-1'), {});
    expect(out).toEqual(PERIODS_DTO);
    expect(getDynamic).toHaveBeenCalledWith(
      'operations.report_archive.recent_limit',
      'REPORT_ARCHIVE_RECENT_LIMIT',
      12,
    );
    expect(listAvailablePeriods).toHaveBeenCalledWith({ tenantId: 't-1', limit: 12 });
  });

  it('availablePeriods: явный query.limit перекрывает крутилку', async () => {
    const { controller, listAvailablePeriods } = buildController({ canView: true });
    await controller.availablePeriods('t-1', reqWithUser('u-1'), { limit: 5 });
    expect(listAvailablePeriods).toHaveBeenCalledWith({ tenantId: 't-1', limit: 5 });
  });

  it('availablePeriods: rbac.canViewOperationsDashboard=false → ForbiddenException', async () => {
    const { controller, listAvailablePeriods } = buildController({ canView: false });
    await expect(
      controller.availablePeriods('t-1', reqWithUser('u-1'), {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(listAvailablePeriods).not.toHaveBeenCalled();
  });
});
