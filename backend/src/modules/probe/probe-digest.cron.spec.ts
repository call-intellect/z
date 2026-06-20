import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ConversationalService } from '../conversational/conversational.service';

import { ProbeDigestCron } from './probe-digest.cron';
import type { ProbeFormulationService } from './probe-formulation.service';

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
  formulateEnabled?: boolean;
  gateAsk?: boolean;
  formulationThrows?: boolean;
}): {
  cron: ProbeDigestCron;
  sendNotification: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  gate: ReturnType<typeof vi.fn>;
  formulate: ReturnType<typeof vi.fn>;
  judgeQuality: ReturnType<typeof vi.fn>;
} {
  let call = 0;
  const findMany = vi.fn().mockImplementation(async () => {
    const rows = args.rowsByCall[call] ?? [];
    call += 1;
    return rows;
  });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const update = vi.fn().mockResolvedValue({});
  const prisma = {
    probeEvent: { findMany, updateMany, update },
  } as unknown as PrismaService;

  const sendNotification = vi.fn().mockImplementation(async () => {
    if (args.sendOk === false) throw new Error('send failed');
    return { id: 'notif-digest-1' };
  });
  const conversational = {
    sendNotification,
  } as unknown as ConversationalService;

  const cfg = {
    getDynamic: vi.fn().mockImplementation(async (key: string, _e, def: unknown) => {
      if (key === 'probe.digestFormulateEnabled') {
        return args.formulateEnabled ?? false;
      }
      return def;
    }),
  } as unknown as TypedConfigService;

  const metrics = {
    incProbeEvent: vi.fn(),
    incProbeDispatched: vi.fn(),
    incProbeValueGate: vi.fn(),
  } as unknown as BusinessMetricsService;

  const gate = vi.fn().mockImplementation(async () => {
    if (args.formulationThrows) throw new Error('llm down');
    return { ask: args.gateAsk ?? true, reason: 'test' };
  });
  const formulate = vi.fn().mockResolvedValue({ question: 'LLM-вопрос?' });
  const judgeQuality = vi.fn().mockResolvedValue('LLM-вопрос?');
  const formulation = {
    gate,
    formulate,
    judgeQuality,
  } as unknown as ProbeFormulationService;

  return {
    cron: new ProbeDigestCron(prisma, conversational, cfg, metrics, formulation),
    sendNotification,
    updateMany,
    update,
    gate,
    formulate,
    judgeQuality,
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
        [],
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

    const findManyMock = (
      e.cron as unknown as {
        prisma: { probeEvent: { findMany: ReturnType<typeof vi.fn> } };
      }
    ).prisma.probeEvent.findMany;
    const findArg = findManyMock.mock.calls[0]![0] as {
      where: {
        status: { in: string[] };
        OR: Array<Record<string, unknown>>;
      };
    };
    expect(findArg.where.status).toEqual({
      in: ['queued_digest', 'routed_to_digest'],
    });
    expect(findArg.where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gte: expect.any(Date) } },
    ]);

    const arg = e.sendNotification.mock.calls[0]![0] as {
      payload: { items: Array<{ probeEventId: string }> };
    };
    expect(arg.payload.items.map((it) => it.probeEventId).sort()).toEqual(['n1', 'q1']);
  });

  it('повторный прогон по уже отправленным = no-op (нет уведомлений)', async () => {
    await env.cron.collectAndSend();
    env.sendNotification.mockClear();
    await env.cron.collectAndSend();
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
        Array.from({ length: 8 }, (_v, i) => makeRow({ id: `c${i}`, priority: 100 - i })),
      ],
    });
    await e.cron.collectAndSend();
    const arg = e.sendNotification.mock.calls[0]![0] as {
      payload: { items: unknown[]; total: number };
    };
    expect(arg.payload.items).toHaveLength(5);
    expect(arg.payload.total).toBe(8);
    expect(
      (e.updateMany.mock.calls[0]![0] as { where: { id: { in: string[] } } }).where.id.in,
    ).toHaveLength(5);
  });

  it('sendNotification упал → probe остаются queued_digest (updateMany не вызван)', async () => {
    const e = makeCron({
      rowsByCall: [[makeRow({ id: 'x1' })]],
      sendOk: false,
    });
    await e.cron.collectAndSend();
    expect(e.updateMany).not.toHaveBeenCalled();
  });

  it('Ф5: digestFormulateEnabled=false → детерминированный путь, LLM не зовётся', async () => {
    const e = makeCron({
      rowsByCall: [[makeRow({ id: 'd1' })]],
      formulateEnabled: false,
    });
    await e.cron.collectAndSend();
    expect(e.gate).not.toHaveBeenCalled();
    expect(e.formulate).not.toHaveBeenCalled();
    const arg = e.sendNotification.mock.calls[0]![0] as {
      payload: { items: Array<{ question: string }> };
    };
    expect(arg.payload.items[0]!.question).toBe('Вопрос d1?');
  });

  it('Ф5: digestFormulateEnabled=true → gate→formulate→judge, formulatedQuestion в payload', async () => {
    const e = makeCron({
      rowsByCall: [[makeRow({ id: 'd2' })]],
      formulateEnabled: true,
      gateAsk: true,
    });
    await e.cron.collectAndSend();
    expect(e.gate).toHaveBeenCalledTimes(1);
    expect(e.formulate).toHaveBeenCalledTimes(1);
    expect(e.judgeQuality).toHaveBeenCalledTimes(1);
    const arg = e.sendNotification.mock.calls[0]![0] as {
      payload: { items: Array<{ question: string }> };
    };
    expect(arg.payload.items[0]!.question).toBe('LLM-вопрос?');
    const persist = e.update.mock.calls.find(
      (c) => (c[0] as { data?: { payload?: unknown } }).data?.payload,
    );
    expect(persist).toBeDefined();
    expect(
      (persist![0] as { data: { payload: { formulatedQuestion: string } } }).data
        .payload.formulatedQuestion,
    ).toBe('LLM-вопрос?');
  });

  it('Ф5: gate ask=false → item исключён из дайджеста, probe помечен dropped_low_value', async () => {
    const e = makeCron({
      rowsByCall: [
        [makeRow({ id: 'k1' }), makeRow({ id: 'k2' })],
      ],
      formulateEnabled: true,
      gateAsk: false,
    });
    await e.cron.collectAndSend();
    expect(e.sendNotification).not.toHaveBeenCalled();
    const dropCall = e.update.mock.calls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'dropped_low_value',
    );
    expect(dropCall).toBeDefined();
  });

  it('Ф5: LLM упал по item → детерминированный фолбэк, дайджест отправлен', async () => {
    const e = makeCron({
      rowsByCall: [[makeRow({ id: 'f1' })]],
      formulateEnabled: true,
      formulationThrows: true,
    });
    await e.cron.collectAndSend();
    expect(e.sendNotification).toHaveBeenCalledTimes(1);
    const arg = e.sendNotification.mock.calls[0]![0] as {
      payload: { items: Array<{ question: string }> };
    };
    expect(arg.payload.items[0]!.question).toBe('Вопрос f1?');
  });
});
