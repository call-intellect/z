import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import type { RbacService } from '../rbac/rbac.service';

import { ListIdeasQuerySchema } from './dto/ideas.dto';
import { IdeasController } from './ideas.controller';
import type { IdeasService } from './services/ideas.service';

const userA: CurrentUserPayload = { id: 'u-1', email: 'u@x', role: 'user' };

function build(opts: { canRead?: boolean } = {}) {
  const svc = {
    list: vi.fn(async () => ({ items: [], total: 0 }) as never),
    getById: vi.fn(async () => ({ id: 'i-1' }) as never),
  } as unknown as IdeasService;
  const rbac = {
    canRead: vi.fn(async () => opts.canRead ?? true),
    canWrite: vi.fn(async () => true),
  } as unknown as RbacService;
  return { ctrl: new IdeasController(svc, rbac), svc, rbac };
}

describe('IdeasController (IDOR fence)', () => {
  it('BadRequest tenant_required без X-Org-Id', async () => {
    const { ctrl } = build();
    const q = ListIdeasQuerySchema.parse({});
    await expect(ctrl.list(q, userA, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('403 forbidden cross-tenant (canRead=false)', async () => {
    const { ctrl } = build({ canRead: false });
    const q = ListIdeasQuerySchema.parse({});
    await expect(ctrl.list(q, userA, 'org-B')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('happy list: tenantId из @CurrentOrg передаётся в сервис', async () => {
    const { ctrl, svc } = build();
    const q = ListIdeasQuerySchema.parse({});
    await ctrl.list(q, userA, 'org-A');
    expect(svc.list).toHaveBeenCalledWith({ tenantId: 'org-A', userId: 'u-1', query: q });
  });

  it('byId 403 cross-tenant', async () => {
    const { ctrl } = build({ canRead: false });
    await expect(ctrl.byId('i-foreign', userA, 'org-B')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
