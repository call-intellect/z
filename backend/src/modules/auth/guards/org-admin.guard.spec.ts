import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import type { RbacService } from '../../rbac/rbac.service';

import { OrgAdminGuard } from './org-admin.guard';

interface ReqStub {
  user?: { id?: string } | null;
  tenantId?: string;
}

function makeContext(opts: ReqStub): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => opts, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

function makeRbacWithContext(
  ctx:
    | { role: 'owner' | 'admin' | 'manager'; isSuperAdmin: boolean }
    | null,
): RbacService {
  return {
    loadContext: vi.fn(async () => ctx),
  } as unknown as RbacService;
}

describe('OrgAdminGuard', () => {
  it('пропускает super_admin', async () => {
    const guard = new OrgAdminGuard(
      makeRbacWithContext({ role: 'manager', isSuperAdmin: true }),
    );
    const ctx = makeContext({ user: { id: 'u' }, tenantId: 'org-1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('пропускает owner', async () => {
    const guard = new OrgAdminGuard(
      makeRbacWithContext({ role: 'owner', isSuperAdmin: false }),
    );
    const ctx = makeContext({ user: { id: 'u' }, tenantId: 'org-1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('пропускает admin', async () => {
    const guard = new OrgAdminGuard(
      makeRbacWithContext({ role: 'admin', isSuperAdmin: false }),
    );
    const ctx = makeContext({ user: { id: 'u' }, tenantId: 'org-1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('блокирует manager', async () => {
    const guard = new OrgAdminGuard(
      makeRbacWithContext({ role: 'manager', isSuperAdmin: false }),
    );
    const ctx = makeContext({ user: { id: 'u' }, tenantId: 'org-1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('блокирует, если у пользователя нет membership', async () => {
    const guard = new OrgAdminGuard(makeRbacWithContext(null));
    const ctx = makeContext({ user: { id: 'u' }, tenantId: 'org-1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('блокирует, если tenantId не определён (TenantGuard не отработал)', async () => {
    const guard = new OrgAdminGuard(
      makeRbacWithContext({ role: 'owner', isSuperAdmin: false }),
    );
    const ctx = makeContext({ user: { id: 'u' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotAuthorizedError);
  });
});
