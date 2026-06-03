import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { PendingActionsService } from '../services/pending-actions.service';

import { PendingActionsReminderCron } from './pending-actions-reminder.cron';

/**
 * Unit-тесты `PendingActionsReminderCron` (Action Center B3):
 *   - гейт по слот-часам: вне слота → skip (без Redis/getCount/sendNotification);
 *   - total=0 → не шлёт (result=empty);
 *   - dedup: SET NX вернул null → result=dedup, без getCount;
 *   - quietHours / disabledUntil → skip;
 *   - total>0 в слот → sendNotification с preferredChannelKinds=['telegram_bot'].
 */

interface PrismaMock {
  channelBinding: { findMany: ReturnType<typeof vi.fn> };
  person: { findMany: ReturnType<typeof vi.fn> };
  membership: { findMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): PrismaMock {
  return {
    channelBinding: { findMany: vi.fn().mockResolvedValue([]) },
    person: { findMany: vi.fn().mockResolvedValue([]) },
    membership: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

function makeRedis(setResult: 'OK' | null = 'OK'): RedisService {
  return {
    client: { set: vi.fn().mockResolvedValue(setResult) },
  } as unknown as RedisService;
}

function makeMetrics(): BusinessMetricsService {
  return {
    incPendingReminderSent: vi.fn(),
  } as unknown as BusinessMetricsService;
}

function makeConv(): ConversationalService {
  return {
    sendNotification: vi.fn().mockResolvedValue({}),
  } as unknown as ConversationalService;
}

function makePending(
  count = { total: 0, bySource: { curation: 0, conflict: 0, intake: 0, probe: 0 } },
  items: Array<{ severity: 'normal' | 'urgent'; title: string }> = [],
): PendingActionsService {
  return {
    getCount: vi.fn().mockResolvedValue(count),
    getList: vi.fn().mockResolvedValue({ items }),
  } as unknown as PendingActionsService;
}

function makeCron(
  deps: {
    prisma?: PrismaMock;
    redis?: RedisService;
    metrics?: BusinessMetricsService;
    conv?: ConversationalService;
    pending?: PendingActionsService;
  } = {},
): {
  cron: PendingActionsReminderCron;
  prisma: PrismaMock;
  redis: RedisService;
  metrics: BusinessMetricsService;
  conv: ConversationalService;
  pending: PendingActionsService;
} {
  const prisma = deps.prisma ?? makePrisma();
  const redis = deps.redis ?? makeRedis();
  const metrics = deps.metrics ?? makeMetrics();
  const conv = deps.conv ?? makeConv();
  const pending = deps.pending ?? makePending();
  const cron = new PendingActionsReminderCron(
    prisma as unknown as PrismaService,
    redis,
    metrics,
    conv,
    pending,
  );
  return { cron, prisma, redis, metrics, conv, pending };
}

const makeBindingRow = (
  userId: string,
  tenantId: string | null,
  preferences: unknown = null,
) => ({
  id: `binding-${userId}`,
  userId,
  channelId: 'channel-1',
  externalId: 'tg-1',
  verifiedAt: new Date(),
  preferences,
  channel: {
    id: 'channel-1',
    tenantId,
    kind: 'telegram_bot',
    status: 'active',
  },
});

// 2026-05-24T06:00:00Z = 09:00 Europe/Moscow (слот-час 9).
const NOW_AT_MSK_9 = new Date(Date.UTC(2026, 4, 24, 6, 0, 0));
// 2026-05-24T07:00:00Z = 10:00 Europe/Moscow (НЕ слот-час).
const NOW_AT_MSK_10 = new Date(Date.UTC(2026, 4, 24, 7, 0, 0));

describe('PendingActionsReminderCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('слоты-часы = 9,12,15,18,21', () => {
    expect([...PendingActionsReminderCron.SLOT_HOURS]).toEqual([
      9, 12, 15, 18, 21,
    ]);
  });

  it('нет binding\'ов → candidates=0', async () => {
    const { cron } = makeCron();
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.candidates).toBe(0);
  });

  it('вне слот-часа (10:00 MSK) → skippedSlot, без Redis/getCount/send', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
    ]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const { cron, redis, conv, pending } = makeCron({ prisma });
    const stats = await cron.run(NOW_AT_MSK_10);
    expect(stats.skippedSlot).toBe(1);
    expect(stats.sent).toBe(0);
    expect(redis.client.set).not.toHaveBeenCalled();
    expect(pending.getCount).not.toHaveBeenCalled();
    expect(conv.sendNotification).not.toHaveBeenCalled();
  });

  it('total=0 → result=empty, без sendNotification', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
    ]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const { cron, metrics, conv } = makeCron({ prisma });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.empty).toBe(1);
    expect(stats.sent).toBe(0);
    expect(conv.sendNotification).not.toHaveBeenCalled();
    expect(metrics.incPendingReminderSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'empty',
    });
  });

  it('dedup: SET NX вернул null → result=dedup, без getCount', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
    ]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const redis = makeRedis(null);
    const { cron, metrics, conv, pending } = makeCron({ prisma, redis });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.deduped).toBe(1);
    expect(stats.sent).toBe(0);
    expect(pending.getCount).not.toHaveBeenCalled();
    expect(conv.sendNotification).not.toHaveBeenCalled();
    expect(metrics.incPendingReminderSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'dedup',
    });
    // Ключ содержит локальную дату И слот-час.
    const setCall = vi.mocked(redis.client.set).mock.calls[0];
    expect(setCall?.[0]).toContain('pending_reminder:user-1:org-1:2026-05-24:9');
  });

  it('disabledUntil в будущем → skippedQuiet, без Redis/send', async () => {
    const prisma = makePrisma();
    const future = new Date(NOW_AT_MSK_9.getTime() + 3_600_000).toISOString();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1', { disabledUntil: future }),
    ]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const { cron, redis, conv } = makeCron({ prisma });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.skippedQuiet).toBe(1);
    expect(redis.client.set).not.toHaveBeenCalled();
    expect(conv.sendNotification).not.toHaveBeenCalled();
  });

  it('quietHours охватывает локальное время → skippedQuiet', async () => {
    const prisma = makePrisma();
    // 09:00 MSK попадает в окно 08:00-10:00.
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1', { quietHours: '08:00-10:00' }),
    ]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const { cron, redis, conv } = makeCron({ prisma });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.skippedQuiet).toBe(1);
    expect(redis.client.set).not.toHaveBeenCalled();
    expect(conv.sendNotification).not.toHaveBeenCalled();
  });

  it('total>0 в слот → sendNotification с preferredChannelKinds=[telegram_bot] + urgentCount', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
    ]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const pending = makePending(
      { total: 3, bySource: { curation: 2, conflict: 0, intake: 1, probe: 0 } },
      [
        { severity: 'urgent', title: 'Срочная карточка' },
        { severity: 'normal', title: 'Обычная задача' },
      ],
    );
    const { cron, conv, metrics } = makeCron({ prisma, pending });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.sent).toBe(1);
    expect(conv.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        recipientUserId: 'user-1',
        eventType: 'system.message',
        preferredChannelKinds: ['telegram_bot'],
        critical: false,
      }),
    );
    // Тело содержит total и срочный маркер.
    const payload = vi.mocked(conv.sendNotification).mock.calls[0]?.[0]
      .payload as { title: string; body: string };
    expect(payload.body).toContain('Ждёт вашего подтверждения: 3');
    expect(payload.body).toContain('🔴');
    expect(metrics.incPendingReminderSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'sent',
    });
  });

  it('глобальный канал (tenantId=null) → tenantId резолвится через membership', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', null),
    ]);
    prisma.membership.findMany.mockResolvedValueOnce([
      { userId: 'user-1', orgId: 'org-9' },
    ]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-9', timezone: 'Europe/Moscow' },
    ]);
    const pending = makePending(
      { total: 1, bySource: { curation: 1, conflict: 0, intake: 0, probe: 0 } },
      [{ severity: 'normal', title: 'X' }],
    );
    const { cron, conv } = makeCron({ prisma, pending });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.sent).toBe(1);
    expect(conv.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-9', recipientUserId: 'user-1' }),
    );
  });

  it('sendNotification упал → result=error, не throw', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
    ]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const pending = makePending(
      { total: 1, bySource: { curation: 1, conflict: 0, intake: 0, probe: 0 } },
      [{ severity: 'normal', title: 'X' }],
    );
    const conv = makeConv();
    vi.mocked(conv.sendNotification).mockRejectedValueOnce(new Error('boom'));
    const { cron, metrics } = makeCron({ prisma, pending, conv });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.errors).toBe(1);
    expect(metrics.incPendingReminderSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'error',
    });
  });
});
