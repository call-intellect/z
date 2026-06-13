import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';

import { CurationItemLifecycleCron } from './curation-item-lifecycle.cron';

/**
 * Action Center B5 «оживление expiresAt» (2026-06-02) — юнит-тесты
 * CurationItemLifecycleCron (закрытие просроченных pending → expired).
 *
 * Покрытие:
 *   - pending с expiresAt в прошлом → updateMany expired + метрики;
 *   - pending с expiresAt в будущем НЕ трогается (фильтр lt:now);
 *   - decided/expired НЕ трогаются (status='pending' в where);
 *   - нет просроченных → нет уведомления owner/admin;
 *   - per-Org итерация переживает ошибку одной Org.
 */
describe('CurationItemLifecycleCron (B5)', () => {
  let prisma: PrismaService;
  let metrics: BusinessMetricsService;
  let conversational: ConversationalService;
  let cron: CurationItemLifecycleCron;

  let orgFindManyMock: ReturnType<typeof vi.fn>;
  let itemFindManyMock: ReturnType<typeof vi.fn>;
  let itemUpdateManyMock: ReturnType<typeof vi.fn>;
  let conflictUpdateManyMock: ReturnType<typeof vi.fn>;
  let intakeUpdateManyMock: ReturnType<typeof vi.fn>;
  let membershipFindManyMock: ReturnType<typeof vi.fn>;
  let incExpiredMock: ReturnType<typeof vi.fn>;
  let incItemMock: ReturnType<typeof vi.fn>;
  let observeAgeMock: ReturnType<typeof vi.fn>;
  let sendNotificationMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    orgFindManyMock = vi.fn();
    itemFindManyMock = vi.fn();
    itemUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 });
    conflictUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 });
    intakeUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 });
    membershipFindManyMock = vi.fn().mockResolvedValue([]);
    incExpiredMock = vi.fn();
    incItemMock = vi.fn();
    observeAgeMock = vi.fn();
    sendNotificationMock = vi.fn().mockResolvedValue(undefined);

    prisma = {
      org: { findMany: orgFindManyMock },
      curationItem: {
        findMany: itemFindManyMock,
        updateMany: itemUpdateManyMock,
      },
      conflictItem: { updateMany: conflictUpdateManyMock },
      intakeIssue: { updateMany: intakeUpdateManyMock },
      membership: { findMany: membershipFindManyMock },
    } as unknown as PrismaService;

    metrics = {
      incCurationItemExpired: incExpiredMock,
      incCurationItem: incItemMock,
      observeCurationItemAge: observeAgeMock,
    } as unknown as BusinessMetricsService;

    conversational = {
      sendNotification: sendNotificationMock,
    } as unknown as ConversationalService;

    cron = new CurationItemLifecycleCron(prisma, metrics, conversational);
  });

  it('pending с expiresAt в прошлом → updateMany expired + метрики', async () => {
    orgFindManyMock.mockResolvedValue([{ id: 'org-1' }]);
    const createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(Date.now() - 60_000);
    itemFindManyMock.mockResolvedValue([
      {
        id: 'ci-1',
        resourceType: 'regulation',
        level: 'light',
        createdAt,
        expiresAt,
      },
    ]);
    membershipFindManyMock.mockResolvedValue([{ userId: 'u-owner' }]);

    const summary = await cron.runForAllOrgs();

    expect(summary.expiredTotal).toBe(1);
    expect(itemUpdateManyMock).toHaveBeenCalledTimes(1);
    const upd = itemUpdateManyMock.mock.calls[0]![0];
    expect(upd.where.id).toEqual({ in: ['ci-1'] });
    expect(upd.where.status).toBe('pending');
    expect(upd.data.status).toBe('expired');

    expect(incExpiredMock).toHaveBeenCalledWith({ resourceType: 'regulation' });
    expect(incItemMock).toHaveBeenCalledWith({
      resourceType: 'regulation',
      level: 'light',
      status: 'expired',
    });
    expect(observeAgeMock).toHaveBeenCalledTimes(1);
    expect(observeAgeMock.mock.calls[0]![0].level).toBe('light');
    // уведомление owner отправлено
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const notif = sendNotificationMock.mock.calls[0]![0];
    expect(notif.recipientUserId).toBe('u-owner');
    expect(notif.payload.severity).toBe('warning');
    expect(summary.notificationsSent).toBe(1);
  });

  it('фильтр findMany: только status=pending и expiresAt lt:now', async () => {
    orgFindManyMock.mockResolvedValue([{ id: 'org-1' }]);
    itemFindManyMock.mockResolvedValue([]);

    await cron.runForAllOrgs();

    const where = itemFindManyMock.mock.calls[0]![0].where;
    expect(where.status).toBe('pending');
    expect(where.expiresAt.not).toBeNull();
    expect(where.expiresAt.lt).toBeInstanceOf(Date);
  });

  it('нет просроченных → updateMany и уведомление НЕ вызываются', async () => {
    orgFindManyMock.mockResolvedValue([{ id: 'org-1' }]);
    itemFindManyMock.mockResolvedValue([]);

    const summary = await cron.runForAllOrgs();

    expect(summary.expiredTotal).toBe(0);
    expect(itemUpdateManyMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(incExpiredMock).not.toHaveBeenCalled();
  });

  it('per-Org итерация переживает ошибку одной Org', async () => {
    orgFindManyMock.mockResolvedValue([{ id: 'org-bad' }, { id: 'org-ok' }]);
    const expiresAt = new Date(Date.now() - 60_000);
    itemFindManyMock
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([
        {
          id: 'ci-2',
          resourceType: 'process',
          level: 'deep',
          createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          expiresAt,
        },
      ]);

    const summary = await cron.runForAllOrgs();

    expect(summary.scannedOrgs).toBe(2);
    expect(summary.expiredTotal).toBe(1);
    expect(itemUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  it('ошибка уведомления не валит закрытие items', async () => {
    orgFindManyMock.mockResolvedValue([{ id: 'org-1' }]);
    itemFindManyMock.mockResolvedValue([
      {
        id: 'ci-3',
        resourceType: 'note',
        level: 'light',
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);
    membershipFindManyMock.mockResolvedValue([{ userId: 'u-owner' }]);
    sendNotificationMock.mockRejectedValue(new Error('notify fail'));

    const summary = await cron.runForAllOrgs();

    expect(summary.expiredTotal).toBe(1);
    expect(itemUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(summary.notificationsSent).toBe(0);
  });

  // ──────────────── Редизайн Ф4 — sweep конфликтов/intake ────────────────

  it('Ф4: протухшие ConflictItem(open) → dismissed, IntakeIssue(pending) → rejected', async () => {
    orgFindManyMock.mockResolvedValue([{ id: 'org-1' }]);
    itemFindManyMock.mockResolvedValue([]); // нет протухших curation-items
    conflictUpdateManyMock.mockResolvedValue({ count: 2 });
    intakeUpdateManyMock.mockResolvedValue({ count: 3 });

    const summary = await cron.runForAllOrgs();

    expect(summary.conflictsDismissed).toBe(2);
    expect(summary.intakesRejected).toBe(3);

    // ConflictItem: open + expiresAt<now → dismissed + reasoning + resolvedAt.
    const cWhere = conflictUpdateManyMock.mock.calls[0]![0].where;
    expect(cWhere.status).toBe('open');
    expect(cWhere.expiresAt.not).toBeNull();
    expect(cWhere.expiresAt.lt).toBeInstanceOf(Date);
    const cData = conflictUpdateManyMock.mock.calls[0]![0].data;
    expect(cData.status).toBe('dismissed');
    expect(cData.reasoning).toBe(CurationItemLifecycleCron.AUTO_EXPIRE_REASON);
    expect(cData.resolvedAt).toBeInstanceOf(Date);

    // IntakeIssue: pending + expiresAt<now → rejected + rejectedReason + triagedAt.
    const iWhere = intakeUpdateManyMock.mock.calls[0]![0].where;
    expect(iWhere.status).toBe('pending');
    expect(iWhere.expiresAt.not).toBeNull();
    const iData = intakeUpdateManyMock.mock.calls[0]![0].data;
    expect(iData.status).toBe('rejected');
    expect(iData.rejectedReason).toBe(
      CurationItemLifecycleCron.AUTO_EXPIRE_REASON,
    );
    expect(iData.triagedAt).toBeInstanceOf(Date);
  });

  it('Ф4: свежие (count=0) не трогаются — sweep вызван, но summary нули', async () => {
    orgFindManyMock.mockResolvedValue([{ id: 'org-1' }]);
    itemFindManyMock.mockResolvedValue([]);
    // updateMany по фильтру не находит свежих → count 0 (дефолт mock).

    const summary = await cron.runForAllOrgs();

    expect(conflictUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(intakeUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(summary.conflictsDismissed).toBe(0);
    expect(summary.intakesRejected).toBe(0);
  });

  it('Ф4: повторный прогон — no-op (updateMany по фильтру не находит уже закрытых)', async () => {
    orgFindManyMock.mockResolvedValue([{ id: 'org-1' }]);
    itemFindManyMock.mockResolvedValue([]);
    // Первый прогон закрыл 1 конфликт, второй — уже ничего (count=0).
    conflictUpdateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await cron.runForAllOrgs();
    const second = await cron.runForAllOrgs();

    expect(first.conflictsDismissed).toBe(1);
    expect(second.conflictsDismissed).toBe(0);
    // Идемпотентность: фильтр одинаковый, повторный прогон безопасен.
    expect(conflictUpdateManyMock).toHaveBeenCalledTimes(2);
  });
});
