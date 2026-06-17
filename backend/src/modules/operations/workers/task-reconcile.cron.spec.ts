import { describe, expect, it, vi } from 'vitest';

import { TaskReconcileCron } from './task-reconcile.cron';

/**
 * TZ task-dedup (2026-06-16, Ф3) — TaskReconcileCron unit-тесты.
 *
 * Acceptance §10 Ф3:
 *   - kill-switch OFF → крон НЕ трогает БД (org.findMany не вызван);
 *   - повторный прогон = no-op (идемпотентность на уровне агрегации счётчиков).
 */
describe('TaskReconcileCron', () => {
  function build(overrides: {
    enabled?: boolean;
    orgs?: Array<{ id: string }>;
    reconcileResult?: {
      expired: number;
      acceptedTotal: number;
      reopened: number;
      reopenRate: number;
      reEmitted: number;
    };
  }) {
    const orgFindMany = vi
      .fn()
      .mockResolvedValue(overrides.orgs ?? [{ id: 'org-1' }]);
    const prisma = { org: { findMany: orgFindMany } };
    const cfg = {
      getDynamic: vi.fn().mockResolvedValue(overrides.enabled ?? true),
    };
    const reconcileForTenant = vi.fn().mockResolvedValue(
      overrides.reconcileResult ?? {
        expired: 2,
        acceptedTotal: 5,
        reopened: 1,
        reopenRate: 0.2,
        reEmitted: 0,
      },
    );
    const svc = { reconcileForTenant };

    const cron = new TaskReconcileCron(
      prisma as never,
      cfg as never,
      svc as never,
    );
    return { cron, orgFindMany, reconcileForTenant, cfg };
  }

  it('kill-switch OFF → БД не трогается (org.findMany НЕ вызван)', async () => {
    const { cron, orgFindMany, reconcileForTenant } = build({ enabled: false });
    await cron.run();
    expect(orgFindMany).not.toHaveBeenCalled();
    expect(reconcileForTenant).not.toHaveBeenCalled();
  });

  it('kill-switch ON → проходит по Org и зовёт reconcileForTenant', async () => {
    const { cron, orgFindMany, reconcileForTenant } = build({
      enabled: true,
      orgs: [{ id: 'org-1' }, { id: 'org-2' }],
    });
    const stats = await cron.runOnce(new Date('2026-06-17T03:00:00Z'));
    expect(orgFindMany).toHaveBeenCalledTimes(1);
    expect(reconcileForTenant).toHaveBeenCalledTimes(2);
    expect(stats.orgsProcessed).toBe(2);
    expect(stats.expired).toBe(4); // 2 на Org × 2 Org
    expect(stats.reopened).toBe(2);
    expect(stats.errors).toBe(0);
  });

  it('падение одной Org не валит проход (errors++)', async () => {
    // подменяем reconcileForTenant на падающий для первой Org
    const svc = {
      reconcileForTenant: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({
          expired: 1,
          acceptedTotal: 0,
          reopened: 0,
          reopenRate: 0,
          reEmitted: 0,
        }),
    };
    const prisma = {
      org: {
        findMany: vi.fn().mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]),
      },
    };
    const cfg = { getDynamic: vi.fn().mockResolvedValue(true) };
    const cron2 = new TaskReconcileCron(
      prisma as never,
      cfg as never,
      svc as never,
    );
    const stats = await cron2.runOnce(new Date());
    expect(stats.errors).toBe(1);
    expect(stats.expired).toBe(1); // вторая Org прошла
  });

  it('повторный прогон с тем же now = тот же результат (идемпотентность)', async () => {
    const { cron } = build({
      orgs: [{ id: 'org-1' }],
      reconcileResult: {
        expired: 0,
        acceptedTotal: 3,
        reopened: 0,
        reopenRate: 0,
        reEmitted: 0,
      },
    });
    const now = new Date('2026-06-17T03:00:00Z');
    const a = await cron.runOnce(now);
    const b = await cron.runOnce(now);
    expect(a).toEqual(b);
  });
});
