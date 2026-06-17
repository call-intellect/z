import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../../common/prisma/prisma.service';

import { MaintenanceAdminService } from './maintenance-admin.service';

function buildService(
  activeWindows: Array<{
    id: string;
    severity: string;
    body: string;
    startsAt: Date | null;
    endsAt: Date | null;
  }> = [],
) {
  const findMany = vi.fn(async () => activeWindows);
  const prisma = {
    systemMessage: { findMany },
  } as unknown as PrismaService;
  const svc = new MaintenanceAdminService(prisma);
  return { svc, findMany };
}

describe('MaintenanceAdminService', () => {
  it('getStatus(): пустой бэкап + активные maintenance windows', async () => {
    const { svc } = buildService([
      {
        id: 'win-1',
        severity: 'warning',
        body: 'Плановое обслуживание базы',
        startsAt: new Date('2026-05-25T01:00:00Z'),
        endsAt: new Date('2026-05-25T03:00:00Z'),
      },
    ]);
    const status = await svc.getStatus();
    expect(status.lastBackupAt).toBeNull();
    expect(status.maintenanceWindows.length).toBe(1);
    expect(status.maintenanceWindows[0]?.id).toBe('win-1');
    expect(status.maintenanceWindows[0]?.severity).toBe('warning');
  });

  it('backupNow()/reindexNow() кидают 501', () => {
    const { svc } = buildService();
    try {
      svc.backupNow();
      throw new Error('должно было выкинуть');
    } catch (err) {
      expect((err as { status?: number }).status).toBe(HttpStatus.NOT_IMPLEMENTED);
    }
    try {
      svc.reindexNow();
      throw new Error('должно было выкинуть');
    } catch (err) {
      expect((err as { status?: number }).status).toBe(HttpStatus.NOT_IMPLEMENTED);
    }
  });
});
