import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { TourProgressService } from '../tour-progress.service';

import { TourProgressController } from './tour-progress.controller';

const sampleUser: CurrentUserPayload = {
  id: 'u-1',
  email: 'employee@z.test',
  role: 'user',
};

function build() {
  const svc = {
    get: vi.fn(async () => ({ welcome: { completedAt: '2026-05-27T10:00:00.000Z' } })),
    update: vi.fn(async () => ({
      welcome: { completedAt: '2026-05-27T10:00:00.000Z' },
    })),
    reset: vi.fn(async () => ({ ok: true as const })),
  };
  const controller = new TourProgressController(svc as unknown as TourProgressService);
  return { controller, svc };
}

describe('TourProgressController', () => {
  it('GET → svc.get(userId)', async () => {
    const { controller, svc } = build();
    const result = await controller.get(sampleUser);
    expect(svc.get).toHaveBeenCalledWith('u-1');
    expect(result).toEqual({ welcome: { completedAt: '2026-05-27T10:00:00.000Z' } });
  });

  it('PATCH → svc.update(userId, tenantId, body) — с заголовком X-Org-Id', async () => {
    const { controller, svc } = build();
    const body = {
      tourId: 'welcome' as const,
      completedAt: '2026-05-27T10:00:00.000Z',
    };
    await controller.update(body, sampleUser, 'org-42');
    expect(svc.update).toHaveBeenCalledWith('u-1', 'org-42', body);
  });

  it('PATCH без X-Org-Id → tenantId=null', async () => {
    const { controller, svc } = build();
    const body = { tourId: 'project' as const, skipped: true };
    await controller.update(body, sampleUser, undefined);
    expect(svc.update).toHaveBeenCalledWith('u-1', null, body);
  });

  it('PATCH с пустым X-Org-Id → tenantId=null', async () => {
    const { controller, svc } = build();
    const body = { tourId: 'meeting' as const, skipped: true };
    await controller.update(body, sampleUser, '   ');
    expect(svc.update).toHaveBeenCalledWith('u-1', null, body);
  });

  it('POST /reset → svc.reset(userId)', async () => {
    const { controller, svc } = build();
    const result = await controller.reset(sampleUser);
    expect(svc.reset).toHaveBeenCalledWith('u-1');
    expect(result).toEqual({ ok: true });
  });
});
