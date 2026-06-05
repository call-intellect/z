/**
 * IDOR-fence spec для DirectorDashboardController (Phase F.7).
 *
 * Цель: убедиться, что cross-tenant запрос НЕ возвращает 200 с данными.
 * DirectorDashboard защищён `RbacService.canViewDirectorDashboard` —
 * проверяем, что false → ForbiddenException, true → делегирование в сервис
 * с правильным tenantId (он же используется для всех downstream-запросов).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { RbacService } from '../rbac/rbac.service';

import { DirectorDashboardController } from './director-dashboard.controller';
import { DirectorDashboardQuerySchema } from './dto/director-dashboard.dto';
import type { DirectorDashboardService } from './services/director-dashboard.service';
import type { TeamDetailService } from './services/team-detail.service';
import type { TeamHealthService } from './services/team-health.service';

function build(opts: { canView?: boolean } = {}) {
  const svc = {
    getDirectorView: vi.fn(async () => ({ tenantId: 't-1' }) as never),
  } as unknown as DirectorDashboardService;
  const rbac = {
    canViewDirectorDashboard: vi.fn(async () => opts.canView ?? true),
  } as unknown as RbacService;
  const teamHealthSvc = {
    getHealth: vi.fn(async () => ({ teams: [], totalDepartments: 0 }) as never),
  } as unknown as TeamHealthService;
  const teamDetailSvc = {
    getDetail: vi.fn(async () => ({ departmentId: 'd-1' }) as never),
  } as unknown as TeamDetailService;
  const pulsePatternsSvc = {
    getPulsePatterns: vi.fn(async () => ({}) as never),
  } as unknown as import('./services/pulse-patterns.service').PulsePatternsService;
  const peopleAtRiskSvc = {
    getAtRisk: vi.fn(async () => ({ items: [], totalAtRisk: 0, generatedAt: '' }) as never),
  } as unknown as import('./services/people-at-risk.service').PeopleAtRiskService;
  return {
    ctrl: new DirectorDashboardController(
      svc,
      rbac,
      teamHealthSvc,
      teamDetailSvc,
      pulsePatternsSvc,
      peopleAtRiskSvc,
    ),
    svc,
    rbac,
    teamHealthSvc,
    teamDetailSvc,
  };
}

function buildReq(userId?: string): { user?: { id: string } } {
  return userId ? { user: { id: userId } } : {};
}

describe('DirectorDashboardController (IDOR fence)', () => {
  it('happy: owner/admin Org → делегирует сервису с tenantId Org-A', async () => {
    const { ctrl, svc, rbac } = build({ canView: true });
    const q = DirectorDashboardQuerySchema.parse({});
    await ctrl.director('org-A', buildReq('u-1') as never, q);
    expect(rbac.canViewDirectorDashboard).toHaveBeenCalledWith('u-1', 'org-A');
    expect(svc.getDirectorView).toHaveBeenCalledWith({
      tenantId: 'org-A',
      period: q.period,
      userId: 'u-1',
    });
  });

  it('cross-tenant: user из Org-A с X-Org-Id=Org-B и canView=false → 403', async () => {
    const { ctrl, svc } = build({ canView: false });
    const q = DirectorDashboardQuerySchema.parse({});
    await expect(
      ctrl.director('org-B', buildReq('u-1') as never, q),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.getDirectorView).not.toHaveBeenCalled();
  });

  it('BadRequest если X-Org-Id не передан', async () => {
    const { ctrl } = build();
    const q = DirectorDashboardQuerySchema.parse({});
    await expect(
      ctrl.director(undefined, buildReq('u-1') as never, q),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('403 no_user если req.user отсутствует (CookieAuthGuard сбоит)', async () => {
    const { ctrl } = build();
    const q = DirectorDashboardQuerySchema.parse({});
    await expect(
      ctrl.director('org-A', buildReq(undefined) as never, q),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
