import { describe, expect, it, vi } from 'vitest';

import type { AdminSettingsService } from '../../settings/admin-settings.service';

import { LimitsAdminService } from './limits-admin.service';

function buildService() {
  const listMock = vi.fn(async () => [
    {
      key: 'limits.max_meetings_per_day',
      value: 100,
      category: 'platform',
      section: 'limits',
      severity: 'medium',
      schemaId: null,
      description: null,
      updatedBy: null,
      updatedAt: new Date(),
      comment: null,
    },
  ]);
  const setMock = vi.fn(async () => undefined);
  const settings = {
    list: listMock,
    set: setMock,
  } as unknown as AdminSettingsService;
  const svc = new LimitsAdminService(settings);
  return { svc, listMock, setMock };
}

describe('LimitsAdminService', () => {
  it('list(): фильтрует AdminSetting по platform/limits', async () => {
    const { svc, listMock } = buildService();
    const rows = await svc.list();
    expect(rows.length).toBe(1);
    expect(listMock).toHaveBeenCalledWith({
      category: 'platform',
      section: 'limits',
    });
  });

  it('update(): зовёт AdminSettings.set с userId и reason', async () => {
    const { svc, setMock } = buildService();
    await svc.update({
      key: 'limits.max_meetings_per_day',
      value: 200,
      userId: 'super-1',
      reason: 'увеличиваем для энтерпрайз',
    });
    expect(setMock).toHaveBeenCalledWith(
      'limits.max_meetings_per_day',
      200,
      expect.objectContaining({
        userId: 'super-1',
        reason: 'увеличиваем для энтерпрайз',
      }),
    );
  });
});
