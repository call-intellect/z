import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import type { RbacService } from '../rbac/rbac.service';

import { DecisionsController } from './decisions.controller';
import { ListDecisionsQuerySchema } from './dto/decisions.dto';
import type { DecisionsService } from './services/decisions.service';

const userA: CurrentUserPayload = { id: 'u-1', email: 'u@x', role: 'user' };

function build(opts: { canRead?: boolean; canWrite?: boolean } = {}) {
  const svc = {
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 20 }) as never),
    getById: vi.fn(async () => ({ id: 'd-1' }) as never),
    softDelete: vi.fn(async () => ({ ok: true }) as never),
    restore: vi.fn(async () => ({ ok: true }) as never),
  } as unknown as DecisionsService;
  const rbac = {
    canRead: vi.fn(async () => opts.canRead ?? true),
    canWrite: vi.fn(async () => opts.canWrite ?? true),
  } as unknown as RbacService;
  return { ctrl: new DecisionsController(svc, rbac), svc, rbac };
}

describe('DecisionsController (IDOR fence)', () => {
  it('BadRequest tenant_required если X-Org-Id не передан', async () => {
    const { ctrl } = build();
    const q = ListDecisionsQuerySchema.parse({});
    await expect(ctrl.list(q, userA, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('403 forbidden если canRead=false (cross-tenant access)', async () => {
    const { ctrl } = build({ canRead: false });
    const q = ListDecisionsQuerySchema.parse({});
    await expect(ctrl.list(q, userA, 'org-other')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('happy: list делегирует сервису с tenantId из @CurrentOrg', async () => {
    const { ctrl, svc } = build({ canRead: true });
    const q = ListDecisionsQuerySchema.parse({});
    await ctrl.list(q, userA, 'org-A');
    expect(svc.list).toHaveBeenCalledWith({
      tenantId: 'org-A',
      userId: 'u-1',
      query: q,
    });
  });

  it('byId 403 если cross-tenant (canRead=false)', async () => {
    const { ctrl } = build({ canRead: false });
    await expect(ctrl.byId('d-foreign', userA, 'org-B')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('byId happy: делегирует с tenantId', async () => {
    const { ctrl, svc } = build({ canRead: true });
    await ctrl.byId('d-1', userA, 'org-A');
    expect(svc.getById).toHaveBeenCalledWith({ tenantId: 'org-A', id: 'd-1' });
  });

  it('remove (soft-delete) happy: делегирует softDelete с tenantId/actorUserId', async () => {
    const { ctrl, svc } = build({ canWrite: true });
    await ctrl.remove('d-1', userA, 'org-A');
    expect(svc.softDelete).toHaveBeenCalledWith({
      tenantId: 'org-A',
      id: 'd-1',
      actorUserId: 'u-1',
    });
  });

  it('remove 403 если canWrite=false', async () => {
    const { ctrl, svc } = build({ canWrite: false });
    await expect(ctrl.remove('d-1', userA, 'org-A')).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.softDelete).not.toHaveBeenCalled();
  });

  it('remove BadRequest tenant_required без X-Org-Id', async () => {
    const { ctrl } = build({ canWrite: true });
    await expect(ctrl.remove('d-1', userA, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('restore happy: делегирует restore с tenantId/actorUserId', async () => {
    const { ctrl, svc } = build({ canWrite: true });
    const res = await ctrl.restore('d-1', userA, 'org-A');
    expect(res).toEqual({ ok: true });
    expect(svc.restore).toHaveBeenCalledWith({
      tenantId: 'org-A',
      id: 'd-1',
      actorUserId: 'u-1',
    });
  });

  it('restore 403 если canWrite=false', async () => {
    const { ctrl, svc } = build({ canWrite: false });
    await expect(ctrl.restore('d-1', userA, 'org-A')).rejects.toBeInstanceOf(ForbiddenException);
    expect(svc.restore).not.toHaveBeenCalled();
  });
});
