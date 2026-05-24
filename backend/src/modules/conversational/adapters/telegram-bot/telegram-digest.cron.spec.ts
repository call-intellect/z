import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { RedisService } from '../../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational.service';

import { TelegramDigestCron } from './telegram-digest.cron';
import type { TelegramTaskParserService } from './telegram-task-parser.service';

/**
 * Unit-тесты `TelegramDigestCron`:
 *   - dedup: повторный run в тот же день → результат deduped (SET NX returns null).
 *   - skip-empty: если все 3 секции пустые → result=empty, без LLM, без sendNotification.
 *   - sent: hash есть, payload не пустой, LLM ОК → sendNotification вызван
 *     с preferredChannelKinds=['telegram_bot'].
 *   - error: LLM/sendNotification упал → result=error в метрике, без throw.
 */

interface PrismaMock {
  channelBinding: { findMany: ReturnType<typeof vi.fn> };
  issue: { findMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): PrismaMock {
  return {
    channelBinding: { findMany: vi.fn().mockResolvedValue([]) },
    issue: { findMany: vi.fn().mockResolvedValue([]) },
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

function makeCron(deps: {
  prisma?: PrismaMock;
  redis?: RedisService;
  metrics?: BusinessMetricsService;
  parser?: TelegramTaskParserService;
  conv?: ConversationalService;
} = {}): {
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

describe('TelegramDigestCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('нет binding\'ов → candidates=0', async () => {
    const { cron } = makeCron();
    const stats = await cron.run();
    expect(stats.candidates).toBe(0);
  });

  it('dedup: SET NX вернул null → result=dedup_skip, без LLM', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
    ]);
    const redis = makeRedis(null); // dedup hit
    const { cron, metrics, parser } = makeCron({ prisma, redis });
    const stats = await cron.run();
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
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
    ]);
    // По умолчанию issue.findMany возвращает [] — все 3 секции пустые.
    const { cron, metrics, parser, conv } = makeCron({ prisma });
    const stats = await cron.run();
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
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
    ]);
    // Первый findMany — urgent today (1 task); остальные — пустые.
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
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce(
      '<b>Утро!</b> KORA-1',
    );
    const { cron, conv, metrics } = makeCron({ prisma, parser });
    const stats = await cron.run();
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
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
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
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce(null);
    const { cron, conv } = makeCron({ prisma, parser });
    const stats = await cron.run();
    expect(stats.empty).toBe(1);
    expect(conv.sendNotification).not.toHaveBeenCalled();
  });

  it('sendNotification упал → result=error в метрике, но не throw', async () => {
    const prisma = makePrisma();
    prisma.channelBinding.findMany.mockResolvedValueOnce([
      makeBindingRow('user-1', 'org-1'),
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
    vi.mocked(parser.formulateDigest).mockResolvedValueOnce('<b>x</b>');
    const conv = makeConv();
    vi.mocked(conv.sendNotification).mockRejectedValueOnce(new Error('boom'));
    const { cron, metrics } = makeCron({ prisma, parser, conv });
    const stats = await cron.run();
    expect(stats.errors).toBe(1);
    expect(metrics.incTelegramDigestSent).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      result: 'error',
    });
  });
});
