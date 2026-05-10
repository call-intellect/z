import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { SuperAdminGuard } from './super-admin.guard';

interface RequestUserStub {
  id?: string;
  isSuperAdmin?: boolean;
}

function makeContext(user: RequestUserStub | null | undefined): ExecutionContext {
  const req = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

function makePrismaWithFindUnique(returnValue: unknown): PrismaService {
  return {
    user: { findUnique: vi.fn(async () => returnValue) },
  } as unknown as PrismaService;
}

describe('SuperAdminGuard', () => {
  it('пропускает super_admin (флаг закэширован в req.user)', async () => {
    const guard = new SuperAdminGuard(
      makePrismaWithFindUnique({ isSuperAdmin: true }),
    );
    const ctx = makeContext({ id: 'u-1', isSuperAdmin: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('подтверждает через БД, если флаг не закэширован', async () => {
    const guard = new SuperAdminGuard(
      makePrismaWithFindUnique({ isSuperAdmin: true }),
    );
    const ctx = makeContext({ id: 'u-1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('бросает NotAuthorizedError, если user отсутствует', async () => {
    const guard = new SuperAdminGuard(
      makePrismaWithFindUnique({ isSuperAdmin: true }),
    );
    const ctx = makeContext(null);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('бросает NotAuthorizedError, если в БД user.isSuperAdmin=false', async () => {
    const guard = new SuperAdminGuard(
      makePrismaWithFindUnique({ isSuperAdmin: false }),
    );
    const ctx = makeContext({ id: 'u-1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('бросает NotAuthorizedError, если user не найден в БД', async () => {
    const guard = new SuperAdminGuard(makePrismaWithFindUnique(null));
    const ctx = makeContext({ id: 'u-1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotAuthorizedError);
  });
});
