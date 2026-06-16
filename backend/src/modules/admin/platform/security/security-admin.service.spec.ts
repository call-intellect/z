import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSettingsService } from '../../settings/admin-settings.service';

import { SecurityAdminService } from './security-admin.service';

function buildService() {
  const listMock = vi.fn(async () => [
    {
      key: 'security.argon_memory_kb',
      value: 65536,
      category: 'platform',
      section: 'security',
      severity: 'high',
      schemaId: null,
      description: null,
      updatedBy: null,
      updatedAt: new Date(),
      comment: null,
    },
    {
      key: 'security.unknown_key',
      value: 1,
      category: 'platform',
      section: 'security',
      severity: 'low',
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
  const svc = new SecurityAdminService(settings);
  return { svc, listMock, setMock };
}

describe('SecurityAdminService', () => {
  it('list(): фильтрует whitelist и не отдает посторонние ключи', async () => {
    const { svc } = buildService();
    const rows = await svc.list();
    expect(rows.map((r) => r.key)).toContain('security.argon_memory_kb');
    expect(rows.map((r) => r.key)).not.toContain('security.unknown_key');
  });

  it('update(): зовёт AdminSettings.set с userId/reason', async () => {
    const { svc, setMock } = buildService();
    await svc.update({
      key: 'security.argon_memory_kb',
      value: 131072,
      userId: 'super-1',
      reason: 'Усиливаем безопасность для compliance',
    });
    expect(setMock).toHaveBeenCalledWith(
      'security.argon_memory_kb',
      131072,
      expect.objectContaining({
        userId: 'super-1',
        reason: 'Усиливаем безопасность для compliance',
      }),
    );
  });

  it('update(): кидает 400 при ключе вне whitelist', async () => {
    const { svc } = buildService();
    await expect(
      svc.update({
        key: 'security.unknown_key',
        value: 1,
        userId: 'super-1',
        reason: 'попытка обхода',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rotateIpSalt(): кидает 501 Not Implemented', () => {
    const { svc } = buildService();
    try {
      svc.rotateIpSalt();
      throw new Error('должно было выкинуть');
    } catch (err) {
      expect((err as { status?: number }).status).toBe(HttpStatus.NOT_IMPLEMENTED);
    }
  });
});
