import type { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { SupportAccessGuard } from './guards/support-access.guard';
import type { SupportAccessService } from './services/support-access.service';

interface RequestUserStub {
  id?: string;
}

function makeContext(user: RequestUserStub | null | undefined): {
  ctx: ExecutionContext;
  req: { user: RequestUserStub | null | undefined; tenantId?: string };
} {
  const req: { user: RequestUserStub | null | undefined; tenantId?: string } = {
    user,
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function makeAccess(args: {
  isAgent: boolean;
  vendorOrgId?: string | null;
}): SupportAccessService {
  return {
    isAgent: vi.fn(async () => args.isAgent),
    getVendorOrgId: vi.fn(async () => args.vendorOrgId ?? 'vendor-org-1'),
  } as unknown as SupportAccessService;
}

describe('SupportAccessGuard', () => {
  it('пропускает сотрудника (isAgent=true) и выставляет req.tenantId=vendorOrg', async () => {
    const guard = new SupportAccessGuard(
      makeAccess({ isAgent: true, vendorOrgId: 'vendor-org-1' }),
    );
    const { ctx, req } = makeContext({ id: 'u-1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenantId).toBe('vendor-org-1');
  });

  it('бросает SUPPORT_NOT_AGENT, если isAgent=false', async () => {
    const guard = new SupportAccessGuard(makeAccess({ isAgent: false }));
    const { ctx } = makeContext({ id: 'u-2' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: { code: 'SUPPORT_NOT_AGENT' } },
    } as Partial<ForbiddenException>);
  });

  it('бросает no_user, если user отсутствует', async () => {
    const guard = new SupportAccessGuard(makeAccess({ isAgent: true }));
    const { ctx } = makeContext(null);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: { code: 'no_user' } },
    } as Partial<ForbiddenException>);
  });
});
