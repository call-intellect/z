import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { RedisService } from '../../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational.service';

import { TelegramDigestCron } from './telegram-digest.cron';
import type { TelegramTaskParserService } from './telegram-task-parser.service';

interface PrismaMock {
  channelBinding: { findMany: ReturnType<typeof vi.fn> };
  issue: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  person: { findMany: ReturnType<typeof vi.fn> };
  cycle: { findUnique: ReturnType<typeof vi.fn> };
  sprintHint: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): PrismaMock {
  return {
    channelBinding: { findMany: vi.fn().mockResolvedValue([]) },
    issue: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    person: { findMany: vi.fn().mockResolvedValue([]) },
    cycle: { findUnique: vi.fn().mockResolvedValue(null) },
    sprintHint: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

function makeRedis(setResult: 'OK' | null = 'OK'): RedisService {
  return {
    client: {
      set: vi.fn().mockResolvedValue(setResult),
    },
  } as unknown as RedisService;
}

function makeMetrics(): BusinessMetricsService {
  return {
    incTelegramDigestSent: vi.fn(),
  } as unknown as BusinessMetricsService;
}

function makeParser(): TelegramTaskParserService {
  return {
    formulateDigest: vi.fn(),
  } as unknown as TelegramTaskParserService;
}

function makeConv(): ConversationalService {
  return {
    sendNotification: vi.fn().mockResolvedValue({}),
  } as unknown as ConversationalService;
}

function makeCfg(): TypedConfigService {
  return {} as unknown as TypedConfigService;
}

function makeCron(
  deps: {
    prisma?: PrismaMock;
    redis?: RedisService;
    metrics?: BusinessMetricsService;
    parser?: TelegramTaskParserService;
    conv?: ConversationalService;
  } = {},
): {
  cron: TelegramDigestCron;
  prisma: PrismaMock;
  redis: RedisService;
  metrics: BusinessMetricsService;
  parser: TelegramTaskParserService;
  conv: ConversationalService;
} {
  const prisma = deps.prisma ?? makePrisma();
  const redis = deps.redis ?? makeRedis();
  const metrics = deps.metrics ?? makeMetrics();
  const parser = deps.parser ?? makeParser();
  const conv = deps.conv ?? makeConv();
  const cron = new TelegramDigestCron(
    prisma as unknown as PrismaService,
    redis,
    metrics,
    parser,
    conv,
    makeCfg(),
  );
  return { cron, prisma, redis, metrics, parser, conv };
}

const makeBindingRow = (userId: string, tenantId: string) => ({
  id: `binding-${userId}`,
  userId,
  channelId: 'channel-1',
  externalId: 'tg-1',
  verifiedAt: new Date(),
  channel: {
    id: 'channel-1',
    tenantId,
    kind: 'telegram_bot',
    status: 'active',
  },
});

const NOW_AT_MSK_9 = new Date(Date.UTC(2026, 4, 24, 6, 0, 0));

const NOW_AT_YEKB_9 = new Date(Date.UTC(2026, 4, 24, 4, 0, 0));

describe('TelegramDigestCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("нет binding'ов → candidates=0", async () => {
    const { cron } = makeCron();
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.candidates).toBe(0);
  });

  it('dedup: SET NX вернул null → result=dedup_skip, без LLM', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    const redis = makeRedis(null);
    const { cron, metrics, parser } = makeCron({ prisma, redis });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.deduped).toBe(1);
    expect(stats.sent).toBe(0);
    expect(parser.formulateDigest).not.toHaveBeenCalled();
    expect(metrics.incTelegramDigestSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'dedup_skip',
    });
  });

  it('skip-empty: все 3 секции пустые → result=empty', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    const { cron, metrics, parser, conv } = makeCron({ prisma });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.empty).toBe(1);
    expect(stats.sent).toBe(0);
    expect(parser.formulateDigest).not.toHaveBeenCalled();
    expect(conv.sendNotification).not.toHaveBeenCalled();
    expect(metrics.incTelegramDigestSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'empty',
    });
  });

  it('sent: есть issue + LLM ОК → sendNotification с preferredChannelKinds=[telegram_bot]', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'Срочная',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const parser = makeParser();
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>Утро!</b> KORA-1');
    const { cron, conv, metrics } = makeCron({ prisma, parser });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.sent).toBe(1);
    expect(conv.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        recipientUserId: 'user-1',
        eventType: 'system.message',
        preferredChannelKinds: ['telegram_bot'],
      }),
    );
    expect(metrics.incTelegramDigestSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'sent',
    });
  });

  it('LLM вернул null → result=empty (без sendNotification)', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'X',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const parser = makeParser();
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce(null);
    const { cron, conv } = makeCron({ prisma, parser });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.empty).toBe(1);
    expect(conv.sendNotification).not.toHaveBeenCalled();
  });

  it('per-user TZ: Europe/Moscow user, now=06:00 UTC (=09:00 MSK) → отправка', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'Срочная',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const parser = makeParser();
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>хей</b>');
    const { cron, conv } = makeCron({ prisma, parser });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.sent).toBe(1);
    expect(stats.skippedHour).toBe(0);
    expect(conv.sendNotification).toHaveBeenCalled();
  });

  it('per-user TZ: Asia/Yekaterinburg user, now=06:00 UTC (=11:00 YEKB) → skippedHour', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Asia/Yekaterinburg' },
    ]);
    const { cron, parser, conv, redis } = makeCron({ prisma });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.skippedHour).toBe(1);
    expect(stats.sent).toBe(0);
    expect(parser.formulateDigest).not.toHaveBeenCalled();
    expect(conv.sendNotification).not.toHaveBeenCalled();
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it('per-user TZ: Asia/Yekaterinburg user, now=04:00 UTC (=09:00 YEKB) → отправка', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Asia/Yekaterinburg' },
    ]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'Срочная Екб',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const parser = makeParser();
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>Екб!</b>');
    const { cron, conv } = makeCron({ prisma, parser });
    const stats = await cron.run(NOW_AT_YEKB_9);
    expect(stats.sent).toBe(1);
    expect(stats.skippedHour).toBe(0);
    expect(conv.sendNotification).toHaveBeenCalled();
  });

  it('per-user TZ: нет Person → default Europe/Moscow, now=06:00 UTC → отправка', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'Срочная',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const parser = makeParser();
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>x</b>');
    const { cron, conv } = makeCron({ prisma, parser });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.sent).toBe(1);
    expect(conv.sendNotification).toHaveBeenCalled();
  });

  it('per-user TZ: Person.timezone = null → default Europe/Moscow, now=06:00 UTC → отправка', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: null },
    ]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'Без TZ',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const parser = makeParser();
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>y</b>');
    const { cron } = makeCron({ prisma, parser });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.sent).toBe(1);
  });

  it('per-user TZ: dedup key — по локальной дате (повторный run в тот же local-date → deduped)', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    const redis = makeRedis(null);
    const { cron, parser, conv } = makeCron({ prisma, redis });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.deduped).toBe(1);
    expect(stats.sent).toBe(0);
    expect(parser.formulateDigest).not.toHaveBeenCalled();
    expect(conv.sendNotification).not.toHaveBeenCalled();
    const setCall = vi.mocked(redis.client.set).mock.calls[0];
    expect(setCall?.[0]).toContain('telegram_digest:user-1:org-1:2026-05-24');
  });

  it('ENV TELEGRAM_DIGEST_HOUR_LOCAL=11 → user MSK, now 08:00 UTC (=11:00 MSK) → отправка', async () => {
    const prev = process.env.TELEGRAM_DIGEST_HOUR_LOCAL;
    process.env.TELEGRAM_DIGEST_HOUR_LOCAL = '11';
    try {
      const prisma = makePrisma();
      prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
      prisma.person.findMany.mockResolvedValueOnce([
        { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
      ]);
      prisma.issue.findMany
        .mockResolvedValueOnce([
          {
            id: 'i-1',
            identifier: 'KORA-1',
            title: 'X',
            dueDate: new Date(),
            state: { category: 'unstarted' },
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const parser = makeParser();
      vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>11h</b>');
      const { cron, conv } = makeCron({ prisma, parser });
      const NOW_AT_MSK_11 = new Date(Date.UTC(2026, 4, 24, 8, 0, 0));
      const stats = await cron.run(NOW_AT_MSK_11);
      expect(stats.sent).toBe(1);
      expect(conv.sendNotification).toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_DIGEST_HOUR_LOCAL;
      else process.env.TELEGRAM_DIGEST_HOUR_LOCAL = prev;
    }
  });

  it('ENV TELEGRAM_DIGEST_HOUR_LOCAL невалиден → fallback 9', async () => {
    const prev = process.env.TELEGRAM_DIGEST_HOUR_LOCAL;
    process.env.TELEGRAM_DIGEST_HOUR_LOCAL = 'not-a-number';
    try {
      const prisma = makePrisma();
      prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
      prisma.person.findMany.mockResolvedValueOnce([
        { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
      ]);
      prisma.issue.findMany
        .mockResolvedValueOnce([
          {
            id: 'i-1',
            identifier: 'KORA-1',
            title: 'X',
            dueDate: new Date(),
            state: { category: 'unstarted' },
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const parser = makeParser();
      vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>fallback</b>');
      const { cron, conv } = makeCron({ prisma, parser });
      const stats = await cron.run(NOW_AT_MSK_9);
      expect(stats.sent).toBe(1);
      expect(conv.sendNotification).toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_DIGEST_HOUR_LOCAL;
      else process.env.TELEGRAM_DIGEST_HOUR_LOCAL = prev;
    }
  });

  it('sprint: user с active cycle + SprintHints + closed Issue → payload.sprint собран', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'Срочная',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cycleId: 'cycle-1' }, { cycleId: 'cycle-1' }]);
    prisma.cycle.findUnique.mockResolvedValueOnce({
      id: 'cycle-1',
      name: 'Неделя 23',
      description: 'Гипотеза: ускоряем onboarding на 30%',
      completedAt: null,
    });
    prisma.sprintHint.findMany.mockResolvedValueOnce([
      { id: 'h-1', title: 'KORA-10 «AB-тест» — срок в пятницу, риск', kind: 'due_date_at_risk' },
      {
        id: 'h-2',
        title: 'KORA-7 «Дизайн» — переходит из 2 спринтов подряд',
        kind: 'recurring_carry_over',
      },
    ]);
    prisma.sprintHint.findFirst.mockResolvedValueOnce({
      id: 'h-3',
      title: 'KORA-11 «Прод-релиз» — без исполнителя',
    });
    prisma.issue.findFirst.mockResolvedValueOnce({
      identifier: 'KORA-5',
      title: 'Закрыта',
    });
    prisma.issue.count.mockResolvedValueOnce(2);

    const parser = makeParser();
    let capturedPayload: unknown = null;
    vi.mocked(parser.formulateDigest).mockImplementationOnce((args) => {
      capturedPayload = args.issuesPayload;
      return Promise.resolve('<b>ok</b>');
    });
    const { cron } = makeCron({ prisma, parser });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.sent).toBe(1);
    expect(capturedPayload).toBeTruthy();
    const sprint = (capturedPayload as { sprint?: unknown }).sprint as {
      cycleName: string;
      hypothesisText: string | null;
      signals: string[];
      win: string | null;
      nextAction: string | null;
    };
    expect(sprint).toBeDefined();
    expect(sprint.cycleName).toBe('Неделя 23');
    expect(sprint.hypothesisText).toContain('Гипотеза');
    expect(sprint.signals.length).toBe(3);
    expect(sprint.signals[2]).toContain('без активности');
    expect(sprint.win).toBe('KORA-5 «Закрыта»');
    expect(sprint.nextAction).toBe('KORA-11 «Прод-релиз» — без исполнителя');
  });

  it('sprint: user без active cycle → payload.sprint undefined', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.person.findMany.mockResolvedValueOnce([
      { userId: 'user-1', tenantId: 'org-1', timezone: 'Europe/Moscow' },
    ]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'Срочная',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const parser = makeParser();
    let capturedPayload: unknown = null;
    vi.mocked(parser.formulateDigest).mockImplementationOnce((args) => {
      capturedPayload = args.issuesPayload;
      return Promise.resolve('<b>ok</b>');
    });
    const { cron } = makeCron({ prisma, parser });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.sent).toBe(1);
    expect(capturedPayload).toBeTruthy();
    expect((capturedPayload as { sprint?: unknown }).sprint).toBeUndefined();
    expect(prisma.cycle.findUnique).not.toHaveBeenCalled();
  });

  it('sendNotification упал → result=error в метрике, но не throw', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([makeBindingRow('user-1', 'org-1')]);
    prisma.issue.findMany
      .mockResolvedValueOnce([
        {
          id: 'i-1',
          identifier: 'KORA-1',
          title: 'X',
          dueDate: new Date(),
          state: { category: 'unstarted' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const parser = makeParser();
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>x</b>');
    const conv = makeConv();
    vi.mocked(conv.sendNotification).mockRejectedValueOnce(new Error('boom'));
    const { cron, metrics } = makeCron({ prisma, parser, conv });
    const stats = await cron.run(NOW_AT_MSK_9);
    expect(stats.errors).toBe(1);
    expect(metrics.incTelegramDigestSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'error',
    });
  });
});
