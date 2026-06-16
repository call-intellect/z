import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { MustChangePasswordGuard } from './must-change-password.guard';

describe('MustChangePasswordGuard (audit Б2)', () => {
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn> } };
  let metrics: { incMustChangePasswordBlock: ReturnType<typeof vi.fn> };
  let guard: MustChangePasswordGuard;

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn() } };
    metrics = { incMustChangePasswordBlock: vi.fn() };
    guard = new MustChangePasswordGuard(
      prisma as unknown as PrismaService,
      metrics as unknown as BusinessMetricsService,
    );
  });

  function ctx(req: {
    user?: { id: string } | null;
    method: string;
    path: string;
  }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  it('пропускает, если req.user == null (публичный роут)', async () => {
    await expect(
      guard.canActivate(ctx({ user: null, method: 'GET', path: '/api/v1/meetings' })),
    ).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('пропускает, если mustChangePassword=false', async () => {
    prisma.user.findUnique.mockResolvedValue({ mustChangePassword: false, deletedAt: null });
    await expect(
      guard.canActivate(ctx({ user: { id: 'u-1' }, method: 'GET', path: '/api/v1/meetings' })),
    ).resolves.toBe(true);
  });

  it('пропускает, если user не найден', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      guard.canActivate(ctx({ user: { id: 'u-1' }, method: 'GET', path: '/api/v1/meetings' })),
    ).resolves.toBe(true);
  });

  it('пропускает, если user soft-deleted', async () => {
    prisma.user.findUnique.mockResolvedValue({
      mustChangePassword: true,
      deletedAt: new Date(),
    });
    await expect(
      guard.canActivate(ctx({ user: { id: 'u-1' }, method: 'GET', path: '/api/v1/meetings' })),
    ).resolves.toBe(true);
    expect(metrics.incMustChangePasswordBlock).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/api/v1/me'],
    ['POST', '/api/v1/me/change-password'],
    ['POST', '/api/v1/me/set-initial-password'],
    ['GET', '/api/v1/me/onboarding/state'],
    ['POST', '/api/v1/me/onboarding/setup-complete'],
    ['PATCH', '/api/v1/me/onboarding/team'],
    ['POST', '/api/v1/auth/logout'],
    ['POST', '/api/v1/accounts/logout'],
    ['GET', '/api/v1/entitlements/me'],
  ])('пропускает whitelist %s %s', async (method, path) => {
    prisma.user.findUnique.mockResolvedValue({ mustChangePassword: true, deletedAt: null });
    await expect(guard.canActivate(ctx({ user: { id: 'u-1' }, method, path }))).resolves.toBe(true);
    expect(metrics.incMustChangePasswordBlock).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/api/v1/meetings'],
    ['POST', '/api/v1/orgs/abc/invitations'],
    ['DELETE', '/api/v1/me'],
    ['GET', '/api/v1/meet-out-of-whitelist/me'],
  ])('блокирует не-whitelist %s %s → 403 + метрика', async (method, path) => {
    prisma.user.findUnique.mockResolvedValue({ mustChangePassword: true, deletedAt: null });
    await expect(
      guard.canActivate(ctx({ user: { id: 'u-1' }, method, path })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(metrics.incMustChangePasswordBlock).toHaveBeenCalledWith({ path });
  });

  it('ForbiddenException несёт код must_change_password', async () => {
    prisma.user.findUnique.mockResolvedValue({ mustChangePassword: true, deletedAt: null });
    await expect(
      guard.canActivate(ctx({ user: { id: 'u-1' }, method: 'GET', path: '/api/v1/meetings' })),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        error: { code: 'must_change_password' },
      },
    });
  });
});
