/**
 * Probe-система Фаза 3 (2026-06-11) — ProbeDigestCron.
 *
 * Сценарий R7: несколько `queued_digest` probe одного получателя → ОДНО
 * уведомление `probe.digest` с N пунктами; вошедшие probe → `dispatched`;
 * повторный прогон по уже отправленным = no-op (идемпотентность).
 *
 * Детерминизм: Prisma/Conversational/Cfg/Metrics мокированы, без сети/БД.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ConversationalService } from '../conversational/conversational.service';

import { ProbeDigestCron } from './probe-digest.cron';

interface Row {
  id: string;
  tenantId: string;
  reason: string;
  priority: number;
  selectedRecipientId: string | null;
  recipientCandidates: string[];
  payload: Record<string, unknown>;
}

function makeRow(over: Partial<Row> & { id: string }): Row {
  return {
    tenantId: 'org-1',
    reason: 'idea.status_unclear',
    priority: 40,
    selectedRecipientId: null,
    recipientCandidates: ['user-1'],
    payload: { suggestedQuestion: `Вопрос ${over.id}?` },
    ...over,
  };
}

function makeCron(args: {
  rowsByCall: Row[][];
  sendOk?: boolean;
}): {
  cron: ProbeDigestCron;
  sendNotification: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
} {
  let call = 0;
  const findMany = vi.fn().mockImplementation(async () => {
    const rows = args.rowsByCall[call] ?? [];
    call += 1;
    return rows;
  });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    probeEvent: { findMany, updateMany },
  } as unknown as PrismaService;

  const sendNotification = vi.fn().mockImplementation(async () => {
    if (args.sendOk === false) throw new Error('send failed');
    return { id: 'notif-digest-1' };
  });
  const conversational = {
    sendNotification,
  } as unknown as ConversationalService;

  const cfg = {
    getDynamic: vi.fn().mockImplementation(async (key: string, _e, def: unknown) => def),
  } as unknown as TypedConfigService;

  const metrics = {
    incProbeEvent: vi.fn(),
    incProbeDispatched: vi.fn(),
  } as unknown as BusinessMetricsService;

  return {
    cron: new ProbeDigestCron(prisma, conversational, cfg, metrics),
    sendNotification,
    updateMany,
  };
}

describe('ProbeDigestCron.collectAndSend', () => {
  let env: ReturnType<typeof makeCron>;

  beforeEach(() => {
    env = makeCron({
      rowsByCall: [
        [
          makeRow({ id: 'p1', priority: 80 }),
          makeRow({ id: 'p2', priority: 50 }),
          makeRow({ id: 'p3', priority: 30 }),
        ],
        [], // второй прогон — пусто (всё уже dispatched)
      ],
    });
  });

  it('собирает 3 queued_digest одного получателя → 1 уведомление probe.digest с 3 items', async () => {
    await env.cron.collectAndSend();

    expect(env.sendNotification).toHaveBeenCalledTimes(1);
    const arg = env.sendNotification.mock.calls[0]![0] as {
      eventType: string;
      recipientUserId: string;
      tenantId: string;
      payload: { items: unknown[]; total: number; summary?: string };
    };
    expect(arg.eventType).toBe('probe.digest');
    expect(arg.recipientUserId).toBe('user-1');
    expect(arg.tenantId).toBe('org-1');
    expect(arg.payload.items).toHaveLength(3);
    expect(arg.payload.total).toBe(3);
    expect(typeof arg.payload.summary).toBe('string');

    // Вошедшие probe помечаются dispatched атомарно с фильтром по обоим
    // digest-статусам (W2: queued_digest + routed_to_digest).
    expect(env.updateMany).toHaveBeenCalledTimes(1);
    const upd = env.updateMany.mock.calls[0]![0] as {
      where: { id: { in: string[] }; status: { in: string[] } };
      data: { status: string };
    };
    expect(upd.where.status).toEqual({
      in: ['queued_digest', 'routed_to_digest'],
    });
    expect(upd.where.id.in.sort()).toEqual(['p1', 'p2', 'p3']);
    expect(upd.data.status).toBe('dispatched');
  });

  it('W2: выборка дайджеста включает routed_to_digest (NUDGE) вместе с queued_digest', async () => {
    const e = makeCron({
      rowsByCall: [
        [
          makeRow({ id: 'q1', reason: 'idea.status_unclear' }),
          makeRow({ id: 'n1', reason: 'commitment.followup', priority: 60 }),
        ],
      ],
    });
    await e.cron.collectAndSend();

    // findMany вызван с status IN (queued_digest, routed_to_digest).
    const findManyMock = (
      e.cron as unknown as {
        prisma: { probeEvent: { findMany: ReturnType<typeof vi.fn> } };
      }
    ).prisma.probeEvent.findMany;
    const findArg = findManyMock.mock.calls[0]![0] as {
      where: { status: { in: string[] } };
    };
    expect(findArg.where.status).toEqual({
      in: ['queued_digest', 'routed_to_digest'],
    });

    // Оба пункта (включая NUDGE-routed) вошли в один дайджест получателя.
    const arg = e.sendNotification.mock.calls[0]![0] as {
      payload: { items: Array<{ probeEventId: string }> };
    };
    expect(arg.payload.items.map((it) => it.probeEventId).sort()).toEqual([
      'n1',
      'q1',
    ]);
  });

  it('повторный прогон по уже отправленным = no-op (нет уведомлений)', async () => {
    await env.cron.collectAndSend(); // первый — отправил
    env.sendNotification.mockClear();
    await env.cron.collectAndSend(); // второй — findMany вернёт []
    expect(env.sendNotification).not.toHaveBeenCalled();
  });

  it('два получателя → два отдельных дайджеста', async () => {
    const e = makeCron({
      rowsByCall: [
        [
          makeRow({ id: 'a1', recipientCandidates: ['user-A'] }),
          makeRow({ id: 'b1', recipientCandidates: ['user-B'] }),
        ],
      ],
    });
    await e.cron.collectAndSend();
    expect(e.sendNotification).toHaveBeenCalledTimes(2);
  });

  it('касание-кап ограничивает число пунктов в одном дайджесте', async () => {
    const e = makeCron({
      rowsByCall: [
        Array.from({ length: 8 }, (_v, i) =>
          makeRow({ id: `c${i}`, priority: 100 - i }),
        ),
      ],
    });
    // touchCap из getDynamic-мока = default (5).
    await e.cron.collectAndSend();
    const arg = e.sendNotification.mock.calls[0]![0] as {
      payload: { items: unknown[]; total: number };
    };
    expect(arg.payload.items).toHaveLength(5);
    expect(arg.payload.total).toBe(8); // total — все queued, не урезанные
    // dispatched помечаются только вошедшие (5).
    expect((e.updateMany.mock.calls[0]![0] as { where: { id: { in: string[] } } }).where.id.in).toHaveLength(5);
  });

  it('sendNotification упал → probe остаются queued_digest (updateMany не вызван)', async () => {
    const e = makeCron({
      rowsByCall: [[makeRow({ id: 'x1' })]],
      sendOk: false,
    });
    await e.cron.collectAndSend();
    expect(e.updateMany).not.toHaveBeenCalled();
  });
});
