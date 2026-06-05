/**
 * Unit-тесты `WeeklyPerPersonController` (ТЗ-D Фаза 4).
 *
 * Проверяют коды ошибок гвардов-хелперов (мок svc + rbac):
 *   - нет user в req → 403 no_user;
 *   - нет tenant → 400 tenant_required;
 *   - rbac.canViewOperationsDashboard=false → 403 forbidden_role;
 *   - happy path → делегирует в svc.compute с параметрами query.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RbacService } from '../../rbac/rbac.service';
import type { WeeklyPerPersonQuery } from '../dto/weekly-per-person.dto';
import type { WeeklyPerPersonService } from '../services/weekly-per-person.service';

import { WeeklyPerPersonController } from './weekly-per-person.controller';

const QUERY: WeeklyPerPersonQuery = {
  weekStart: '2026-06-01',
  limit: 5,
  offset: 0,
  sort: 'reliability',
};

function buildController(opts: {
  canView?: boolean;
} = {}): {
  controller: WeeklyPerPersonController;
  compute: ReturnType<typeof vi.fn>;
  canViewOperationsDashboard: ReturnType<typeof vi.fn>;
} {
  const compute = vi.fn(async () => ({
    weekStart: '2026-06-01',
    weekEnd: '2026-06-07',
    generatedAt: new Date().toISOString(),
    total: 0,
    topReliable: [],
    topRisk: [],
    rows: [],
  }));
  const svc = { compute } as unknown as WeeklyPerPersonService;

  const canViewOperationsDashboard = vi.fn(async () => opts.canView ?? true);
  const rbac = { canViewOperationsDashboard } as unknown as RbacService;

  const controller = new WeeklyPerPersonController(svc, rbac);
  return { controller, compute, canViewOperationsDashboard };
}

function reqWithUser(userId: string | undefined): Request {
  return { user: userId ? { id: userId } : undefined } as unknown as Request;
}

describe('WeeklyPerPersonController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('нет user → ForbiddenException(no_user)', async () => {
    const { controller } = buildController();
    await expect(
      controller.get('t-1', reqWithUser(undefined), QUERY),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('нет tenant → BadRequestException(tenant_required)', async () => {
    const { controller } = buildController();
    await expect(
      controller.get(undefined, reqWithUser('u-1'), QUERY),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rbac.canViewOperationsDashboard=false → ForbiddenException(forbidden_role)', async () => {
    const { controller } = buildController({ canView: false });
    await expect(
      controller.get('t-1', reqWithUser('u-1'), QUERY),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('happy path → делегирует в svc.compute с параметрами query', async () => {
    const { controller, compute } = buildController({ canView: true });
    await controller.get('t-1', reqWithUser('u-1'), QUERY);
    expect(compute).toHaveBeenCalledTimes(1);
    const arg = compute.mock.calls[0]![0];
    expect(arg).toMatchObject({
      tenantId: 't-1',
      weekStart: '2026-06-01',
      limit: 5,
      offset: 0,
      sort: 'reliability',
    });
  });
});
