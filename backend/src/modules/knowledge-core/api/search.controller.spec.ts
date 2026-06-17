import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';

import { SearchRequestSchema } from './dto/search.dto';
import { KnowledgeSearchController } from './search.controller';
import type { SearchService } from './search.service';

const userA: CurrentUserPayload = { id: 'u-A', email: 'a@x', role: 'user' };

function build(opts: { canRead?: boolean } = {}) {
  const svc = {
    search: vi.fn(async () => ({ results: [], tookMs: 1 })),
  } as unknown as SearchService;
  const rbac = {
    canRead: vi.fn(async () => opts.canRead ?? true),
  } as unknown as RbacService;
  const ctrl = new KnowledgeSearchController(svc, rbac);
  return { ctrl, svc, rbac };
}

describe('KnowledgeSearchController', () => {
  it('happy: делегирует SearchService.search с tenantId + телом', async () => {
    const { ctrl, svc } = build();
    const body = SearchRequestSchema.parse({ query: 'тест', limit: 5 });
    const res = await ctrl.search(body, userA, 't-A');
    expect(svc.search).toHaveBeenCalledWith({
      query: 'тест',
      limit: 5,
      tenantId: 't-A',
      userId: 'u-A',
    });
    expect(res.results).toEqual([]);
  });

  it('403 forbidden если canRead=false', async () => {
    const { ctrl } = build({ canRead: false });
    const body = SearchRequestSchema.parse({ query: 'x' });
    await expect(ctrl.search(body, userA, 't-A')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 tenant_required без X-Org-Id', async () => {
    const { ctrl } = build();
    const body = SearchRequestSchema.parse({ query: 'x' });
    await expect(ctrl.search(body, userA, undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Zod-400 на пустой query', () => {
    const r = SearchRequestSchema.safeParse({ query: '' });
    expect(r.success).toBe(false);
  });

  it('Zod-400 на limit > 50', () => {
    const r = SearchRequestSchema.safeParse({ query: 'x', limit: 9999 });
    expect(r.success).toBe(false);
  });

  it('Zod-400 на entityIds > 50', () => {
    const r = SearchRequestSchema.safeParse({
      query: 'x',
      entityIds: Array.from({ length: 51 }, (_, i) => `e-${i}`),
    });
    expect(r.success).toBe(false);
  });
});
