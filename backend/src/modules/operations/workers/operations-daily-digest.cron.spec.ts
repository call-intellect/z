import { describe, expect, it, vi } from 'vitest';

import {
  OperationsDailyDigestCron,
  yesterdayInMoscow,
} from './operations-daily-digest.cron';

/**
 * SBA β-8.3 — OperationsDailyDigestCron unit-тесты.
 *
 *   - yesterdayInMoscow: вычисляет дату вчера в МСК.
 *   - runOnce: идемпотентность (повторный запуск не создаёт второй дайджест).
 *   - run: мастер-тумблер `operations.daily_digest.enabled=false` → no-op.
 *   - runOnce: deliverToTelegram=false → не шлёт уведомлений.
 *   - runOnce: deliverToTelegram=true → шлёт coo + owner, не admin.
 */
describe('OperationsDailyDigestCron', () => {
  function buildCron(overrides: {
    orgs: Array<{ id: string }>;
    existingDigest?: unknown;
    memberships?: Array<{ userId: string }>;
    dynamicEnabled?: boolean;
    dynamicDeliver?: boolean;
  }) {
    const prisma = {
      org: {
        findMany: vi.fn().mockResolvedValue(overrides.orgs),
      },
      membership: {
        findMany: vi.fn().mockResolvedValue(
          overrides.memberships ?? [
            { userId: 'u_coo' },
            { userId: 'u_owner' },
          ],
        ),
      },
    };
    const cfg = {
      getDynamic: vi.fn().mockImplementation((key: string) => {
        if (key === 'operations.daily_digest.enabled') {
          return Promise.resolve(overrides.dynamicEnabled ?? true);
        }
        if (key === 'operations.daily_digest.deliver_to_telegram') {
          return Promise.resolve(overrides.dynamicDeliver ?? false);
        }
        return Promise.resolve(undefined);
      }),
    };
    const digestService = {
      getStored: vi.fn().mockResolvedValue(overrides.existingDigest ?? null),
      getOrGenerate: vi.fn().mockResolvedValue({
        id: 'dd1',
        tenantId: 'org-1',
        dateLocal: '2026-05-24',
        bodyMarkdown: 'текст',
        shortSummary: 'короткая выжимка',
        metrics: {},
        sources: {},
        llmTaskRouteId: 'deepseek',
        deliveredAt: null,
        createdAt: '2026-05-25T01:00:00Z',
      }),
      markDelivered: vi.fn().mockResolvedValue(undefined),
    };
    const conversational = {
      sendNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
    };
    const metrics = {
      incCooDailyDigestGenerated: vi.fn(),
      incCooDailyDigestFailed: vi.fn(),
      incCooDailyDigestDelivered: vi.fn(),
      setCooDailyDigestAge: vi.fn(),
    };
    const cron = new OperationsDailyDigestCron(
      prisma as never,
      cfg as never,
      digestService as never,
      conversational as never,
      metrics as never,
    );
    return { cron, prisma, cfg, digestService, conversational, metrics };
  }

  it('yesterdayInMoscow: для 25 мая 01:00 МСК (= 24 мая 22:00 UTC) даёт 24 мая', () => {
    // cron срабатывает в 22:00 UTC 24 мая = 01:00 МСК 25 мая;
    // отчёт — за вчерашние сутки в МСК, т.е. за 24 мая.
    const now = new Date('2026-05-24T22:00:00Z');
    expect(yesterdayInMoscow(now)).toBe('2026-05-24');
  });

  it('runOnce: deliverToTelegram=false → дайджест генерируется, но не шлётся', async () => {
    const { cron, digestService, conversational } = buildCron({
      orgs: [{ id: 'org-1' }],
    });
    const now = new Date('2026-05-24T22:00:00Z');
    const stats = await cron.runOnce({ now, deliverToTelegram: false });
    expect(stats.digestsGenerated).toBe(1);
    expect(stats.notificationsSent).toBe(0);
    expect(digestService.getOrGenerate).toHaveBeenCalledOnce();
    expect(conversational.sendNotification).not.toHaveBeenCalled();
    expect(digestService.markDelivered).not.toHaveBeenCalled();
  });

  it('runOnce: deliverToTelegram=true → шлёт coo + owner и помечает delivered', async () => {
    const { cron, digestService, conversational } = buildCron({
      orgs: [{ id: 'org-1' }],
    });
    const now = new Date('2026-05-24T22:00:00Z');
    const stats = await cron.runOnce({ now, deliverToTelegram: true });
    expect(stats.digestsGenerated).toBe(1);
    // 2 нотификации (coo + owner).
    expect(conversational.sendNotification).toHaveBeenCalledTimes(2);
    expect(stats.notificationsSent).toBe(2);
    expect(digestService.markDelivered).toHaveBeenCalledOnce();
  });

  it('runOnce: фильтр membership ищет только owner + coo (без admin)', async () => {
    const { cron, prisma } = buildCron({
      orgs: [{ id: 'org-1' }],
    });
    const now = new Date('2026-05-24T22:00:00Z');
    await cron.runOnce({ now, deliverToTelegram: true });
    const call = prisma.membership.findMany.mock.calls[0]?.[0] as {
      where: { role: { in: string[] } };
    };
    expect(call.where.role.in).toEqual(['owner', 'coo']);
    expect(call.where.role.in).not.toContain('admin');
  });

  it('Идемпотентность: если дайджест за день уже есть — пропускает генерацию', async () => {
    const { cron, digestService } = buildCron({
      orgs: [{ id: 'org-1' }],
      existingDigest: {
        id: 'dd-exists',
        tenantId: 'org-1',
        dateLocal: '2026-05-24',
        bodyMarkdown: 'старый',
        shortSummary: null,
        metrics: {},
        sources: {},
        llmTaskRouteId: null,
        deliveredAt: '2026-05-25T01:30:00Z', // уже доставлен
        createdAt: '2026-05-25T01:00:00Z',
      },
    });
    const now = new Date('2026-05-24T22:00:00Z');
    const stats = await cron.runOnce({ now, deliverToTelegram: true });
    expect(stats.digestsSkippedAlreadyExists).toBe(1);
    expect(stats.digestsGenerated).toBe(0);
    expect(digestService.getOrGenerate).not.toHaveBeenCalled();
    // alreadyDelivered != null → повторно не шлём.
    expect(stats.notificationsSent).toBe(0);
  });

  it('run: мастер-тумблер enabled=false → no-op', async () => {
    const { cron, prisma } = buildCron({
      orgs: [{ id: 'org-1' }],
      dynamicEnabled: false,
    });
    await cron.run();
    expect(prisma.org.findMany).not.toHaveBeenCalled();
  });

  it('run: мастер-тумблер enabled=true проходит до runOnce', async () => {
    const { cron, prisma } = buildCron({
      orgs: [{ id: 'org-1' }],
      dynamicEnabled: true,
      dynamicDeliver: false,
    });
    await cron.run();
    expect(prisma.org.findMany).toHaveBeenCalledOnce();
  });
});
