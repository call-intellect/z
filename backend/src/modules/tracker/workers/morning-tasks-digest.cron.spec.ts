import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { MorningTasksDigestService, OpenIssueRow } from '../services/morning-tasks-digest.service';

import { MorningTasksDigestCron } from './morning-tasks-digest.cron';

const NOW_MSK_9 = new Date('2026-06-29T06:00:00Z');
const NOW_MSK_3 = new Date('2026-06-29T00:00:00Z');

const openRow: OpenIssueRow = {
  issueId: 'i1',
  identifier: 'KORA-1',
  title: 'Открытая задача',
  dueDate: null,
  priority: 'medium',
  stateCategory: 'started',
};

describe('MorningTasksDigestCron', () => {
  let prisma: PrismaService;
  let digest: MorningTasksDigestService;
  let conversational: ConversationalService;
  let cfg: TypedConfigService;
  let metrics: BusinessMetricsService;
  let cron: MorningTasksDigestCron;

  let orgFindMany: ReturnType<typeof vi.fn>;
  let notificationFindFirst: ReturnType<typeof vi.fn>;
  let listActiveMemberUserIds: ReturnType<typeof vi.fn>;
  let listOpenAssignedIssues: ReturnType<typeof vi.fn>;
  let sendNotification: ReturnType<typeof vi.fn>;
  let incMorningTasksDigest: ReturnType<typeof vi.fn>;

  let settings: Record<string, unknown>;

  beforeEach(() => {
    settings = {
      'tracker.morningDigest.enabled': true,
      'tracker.morningDigest.hourMsk': 9,
      'tracker.morningDigest.maxItemsTotal': 50,
      'tracker.morningDigest.sendWhenEmpty': true,
      'tracker.morningDigest.channels': ['in_app', 'email_smtp'],
    };

    orgFindMany = vi.fn().mockResolvedValue([{ id: 'org_1' }]);
    notificationFindFirst = vi.fn().mockResolvedValue(null);
    listActiveMemberUserIds = vi.fn().mockResolvedValue(['u1']);
    listOpenAssignedIssues = vi.fn().mockResolvedValue([{ userId: 'u1', ...openRow }]);
    sendNotification = vi.fn().mockResolvedValue(undefined);
    incMorningTasksDigest = vi.fn();

    prisma = {
      org: { findMany: orgFindMany },
      notification: { findFirst: notificationFindFirst },
    } as unknown as PrismaService;
    digest = {
      listActiveMemberUserIds,
      listOpenAssignedIssues,
    } as unknown as MorningTasksDigestService;
    conversational = { sendNotification } as unknown as ConversationalService;
    cfg = {
      getDynamic: vi.fn(async (key: string, _envKey: unknown, def: unknown) =>
        key in settings ? settings[key] : def,
      ),
    } as unknown as TypedConfigService;
    metrics = { incMorningTasksDigest } as unknown as BusinessMetricsService;

    cron = new MorningTasksDigestCron(prisma, digest, conversational, cfg, metrics);
  });

  it('гейт по часу: МСК-час != hourMsk → ничего не шлёт', async () => {
    await cron.run(NOW_MSK_3);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(orgFindMany).not.toHaveBeenCalled();
  });

  it('kill-switch: enabled=false → ничего не шлёт', async () => {
    settings['tracker.morningDigest.enabled'] = false;
    await cron.run(NOW_MSK_9);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(orgFindMany).not.toHaveBeenCalled();
  });

  it('happy path: шлёт tasks.daily_open с каналами из настроек + метрика', async () => {
    await cron.run(NOW_MSK_9);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'tasks.daily_open',
        tenantId: 'org_1',
        recipientUserId: 'u1',
        dataClass: 'internal',
        preferredChannelKinds: ['in_app', 'email_smtp'],
      }),
    );
    expect(incMorningTasksDigest).toHaveBeenCalledWith({ isEmpty: false });
  });

  it('дедуп: notification уже есть сегодня → skip', async () => {
    notificationFindFirst.mockResolvedValue({ id: 'x' });
    await cron.run(NOW_MSK_9);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(incMorningTasksDigest).not.toHaveBeenCalled();
  });

  it('пустой + sendWhenEmpty=false → не шлёт', async () => {
    listOpenAssignedIssues.mockResolvedValue([]);
    settings['tracker.morningDigest.sendWhenEmpty'] = false;
    await cron.run(NOW_MSK_9);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('пустой + sendWhenEmpty=true → шлёт payload.isEmpty=true', async () => {
    listOpenAssignedIssues.mockResolvedValue([]);
    settings['tracker.morningDigest.sendWhenEmpty'] = true;
    await cron.run(NOW_MSK_9);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const arg = sendNotification.mock.calls[0]![0];
    expect(arg.payload.isEmpty).toBe(true);
    expect(incMorningTasksDigest).toHaveBeenCalledWith({ isEmpty: true });
  });
});
