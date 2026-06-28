import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ChatIngestService } from './chat-ingest.service';
import { MessageRetentionService } from './message-retention.service';

interface MsgRow {
  id: string;
  conversationId: string;
}

function build(opts: {
  retentionDays: number;
  messages: MsgRow[];
  feedsGraph?: Record<string, boolean>;
  batchSize?: number;
}) {
  const calls: string[] = [];

  const remaining = [...opts.messages];
  const batchSize = opts.batchSize ?? 500;
  const findMany = vi.fn(async () => {
    const slice = remaining.slice(0, batchSize);
    return slice.map((m) => ({ id: m.id, conversationId: m.conversationId }));
  });
  const update = vi.fn(async ({ where }: { where: { id: string } }) => {
    calls.push(`update:${where.id}`);
    const idx = remaining.findIndex((m) => m.id === where.id);
    if (idx >= 0) remaining.splice(idx, 1);
    return {};
  });
  const convFindUnique = vi.fn(async ({ where }: { where: { id: string } }) => ({
    feedsGraph: opts.feedsGraph?.[where.id] ?? false,
  }));

  const prisma = {
    message: { findMany, update },
    conversation: { findUnique: convFindUnique },
  } as unknown as PrismaService;

  const ingestMessage = vi.fn(async (id: string) => {
    calls.push(`ingest:${id}`);
  });
  const chatIngest = { ingestMessage } as unknown as ChatIngestService;

  const metrics = {
    incCoreRetentionDeleted: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    getDynamic: vi.fn(async () => opts.retentionDays),
    retention: { sweepBatchSize: batchSize },
  } as unknown as TypedConfigService;

  const service = new MessageRetentionService(prisma, chatIngest, metrics, cfg);
  return { service, findMany, update, ingestMessage, calls, metrics };
}

describe('MessageRetentionService.sweepExpired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('N=0 → no-op (ничего не читает/не удаляет)', async () => {
    const { service, findMany, update, ingestMessage } = build({
      retentionDays: 0,
      messages: [{ id: 'm1', conversationId: 'c1' }],
    });

    const res = await service.sweepExpired();

    expect(res).toEqual({ ingested: 0, deleted: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it('R23: feedsGraph-сообщение → ingest вызван ПЕРЕД update(deletedAt)', async () => {
    const { service, calls } = build({
      retentionDays: 30,
      messages: [{ id: 'm1', conversationId: 'c1' }],
      feedsGraph: { c1: true },
    });

    const res = await service.sweepExpired();

    expect(res).toEqual({ ingested: 1, deleted: 1 });
    expect(calls).toEqual(['ingest:m1', 'update:m1']);
    expect(calls.indexOf('ingest:m1')).toBeLessThan(calls.indexOf('update:m1'));
  });

  it('soft-delete: помечает deletedAt=now, не hard-delete', async () => {
    const now = new Date('2026-06-28T12:00:00.000Z');
    const update = vi.fn(async () => ({}));
    const prisma = {
      message: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'm1', conversationId: 'c1' }])
          .mockResolvedValue([]),
        update,
      },
      conversation: { findUnique: vi.fn(async () => ({ feedsGraph: false })) },
    } as unknown as PrismaService;
    const service = new MessageRetentionService(
      prisma,
      { ingestMessage: vi.fn() } as unknown as ChatIngestService,
      { incCoreRetentionDeleted: vi.fn() } as unknown as BusinessMetricsService,
      {
        getDynamic: vi.fn(async () => 30),
        retention: { sweepBatchSize: 500 },
      } as unknown as TypedConfigService,
    );

    await service.sweepExpired(now);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { deletedAt: now },
    });
  });

  it('feedsGraph=false → ingest НЕ вызывается, но soft-delete есть', async () => {
    const { service, ingestMessage, update } = build({
      retentionDays: 30,
      messages: [{ id: 'm1', conversationId: 'c1' }],
      feedsGraph: { c1: false },
    });

    const res = await service.sweepExpired();

    expect(res).toEqual({ ingested: 0, deleted: 1 });
    expect(ingestMessage).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('идемпотентность: повторный проход без кандидатов → no-op', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const update = vi.fn();
    const prisma = {
      message: { findMany, update },
      conversation: { findUnique: vi.fn() },
    } as unknown as PrismaService;
    const service = new MessageRetentionService(
      prisma,
      { ingestMessage: vi.fn() } as unknown as ChatIngestService,
      { incCoreRetentionDeleted: vi.fn() } as unknown as BusinessMetricsService,
      {
        getDynamic: vi.fn(async () => 30),
        retention: { sweepBatchSize: 500 },
      } as unknown as TypedConfigService,
    );

    const res = await service.sweepExpired();

    expect(res).toEqual({ ingested: 0, deleted: 0 });
    expect(update).not.toHaveBeenCalled();
  });
});
