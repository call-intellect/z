import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { TableGraphSyncService } from '../services/table-graph-sync.service';

import { TableGraphsyncReconcileCronService } from './table-graphsync-reconcile.cron';

type Fn = ReturnType<typeof vi.fn>;

describe('TableGraphsyncReconcileCronService', () => {
  let prisma: { org: { findMany: Fn } };
  let graphSync: { isEnabled: Fn; reconcileTenant: Fn; expireDrafts: Fn };
  let svc: TableGraphsyncReconcileCronService;

  beforeEach(() => {
    prisma = { org: { findMany: vi.fn().mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]) } };
    graphSync = {
      isEnabled: vi.fn().mockResolvedValue(true),
      reconcileTenant: vi.fn().mockResolvedValue({ created: 1, updated: 0, skipped: 2 }),
      expireDrafts: vi.fn().mockResolvedValue(1),
    };
    svc = new TableGraphsyncReconcileCronService(
      prisma as unknown as PrismaService,
      graphSync as unknown as TableGraphSyncService,
    );
  });

  it('kill-switch выключен → Org не сканируются', async () => {
    graphSync.isEnabled.mockResolvedValue(false);
    const r = await svc.runForAllOrgs();
    expect(prisma.org.findMany).not.toHaveBeenCalled();
    expect(graphSync.reconcileTenant).not.toHaveBeenCalled();
    expect(r.scannedOrgs).toBe(0);
  });

  it('reconcile по каждому Org, агрегирует счётчики', async () => {
    const r = await svc.runForAllOrgs();
    expect(graphSync.reconcileTenant).toHaveBeenCalledTimes(2);
    expect(graphSync.expireDrafts).toHaveBeenCalledTimes(2);
    expect(r.scannedOrgs).toBe(2);
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(4);
    expect(r.expired).toBe(2);
  });

  it('ошибка на одном Org → продолжает остальные, errors++', async () => {
    graphSync.reconcileTenant.mockRejectedValueOnce(new Error('boom'));
    const r = await svc.runForAllOrgs();
    expect(graphSync.reconcileTenant).toHaveBeenCalledTimes(2);
    expect(r.errors).toBe(1);
    expect(r.scannedOrgs).toBe(1);
    expect(r.created).toBe(1);
  });
});
