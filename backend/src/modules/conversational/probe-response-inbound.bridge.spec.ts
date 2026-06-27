import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import type { ConversationalService } from './conversational.service';
import {
  ProbeResponseInboundBridge,
  resolveDigestProbeEventId,
} from './probe-response-inbound.bridge';
import type { InboundMessage } from './types/channel.types';

describe('resolveDigestProbeEventId', () => {
  it('пустой массив → null', () => {
    expect(resolveDigestProbeEventId([], 'любой ответ')).toBeNull();
  });

  it('один item → его probeEventId', () => {
    expect(
      resolveDigestProbeEventId([{ probeEventId: 'p-1', question: 'вопрос про дедлайн' }], 'неважно'),
    ).toBe('p-1');
  });

  it('3 items, ответ с ключевыми словами одного → его probeEventId', () => {
    const items = [
      { probeEventId: 'p-1', question: 'Кто принял решение по миграции?' },
      { probeEventId: 'p-2', question: 'Какой дедлайн у лендинга?' },
      { probeEventId: 'p-3', question: 'Какая выручка эксперимента?' },
    ];
    expect(resolveDigestProbeEventId(items, 'дедлайн лендинга в пятницу')).toBe('p-2');
  });

  it('неоднозначный ответ без совпадений ≥4 букв → null', () => {
    const items = [
      { probeEventId: 'p-1', question: 'Кто принял решение по миграции?' },
      { probeEventId: 'p-2', question: 'Какой дедлайн у лендинга?' },
    ];
    expect(resolveDigestProbeEventId(items, 'ну да ок')).toBeNull();
  });

  it('ничья (ответ матчит два одинаково) → null', () => {
    const items = [
      { probeEventId: 'p-1', question: 'дедлайн лендинга' },
      { probeEventId: 'p-2', question: 'дедлайн отчёта' },
    ];
    expect(resolveDigestProbeEventId(items, 'дедлайн уже близко')).toBeNull();
  });
});

interface BridgeMocks {
  prisma: PrismaService;
  notificationFindUnique: ReturnType<typeof vi.fn>;
  conversational: ConversationalService;
  respondToProbe: ReturnType<typeof vi.fn>;
  subscribeInbound: ReturnType<typeof vi.fn>;
}

function makeBridge(): { bridge: ProbeResponseInboundBridge; mocks: BridgeMocks } {
  const notificationFindUnique = vi.fn().mockResolvedValue(null);
  const respondToProbe = vi.fn().mockResolvedValue({});
  const subscribeInbound = vi.fn();
  const prisma = {
    notification: { findUnique: notificationFindUnique },
  } as unknown as PrismaService;
  const conversational = {
    subscribeInbound,
    respondToProbe,
  } as unknown as ConversationalService;
  const bridge = new ProbeResponseInboundBridge(conversational, prisma);
  return {
    bridge,
    mocks: { prisma, notificationFindUnique, conversational, respondToProbe, subscribeInbound },
  };
}

async function dispatch(bridge: ProbeResponseInboundBridge, msg: InboundMessage): Promise<void> {
  await (bridge as unknown as { handleResponse: (m: InboundMessage) => Promise<void> }).handleResponse(
    msg,
  );
}

describe('ProbeResponseInboundBridge — handleResponse', () => {
  let ctx: ReturnType<typeof makeBridge>;

  beforeEach(() => {
    ctx = makeBridge();
  });

  it('probe.digest → respondToProbe с payload, содержащим probeEventId = резолв', async () => {
    ctx.mocks.notificationFindUnique.mockResolvedValueOnce({
      eventType: 'probe.digest',
      payload: {
        items: [
          { probeEventId: 'p-1', question: 'Кто принял решение по миграции?' },
          { probeEventId: 'p-2', question: 'Какой дедлайн у лендинга?' },
        ],
      },
    });

    await dispatch(ctx.bridge, {
      type: 'response',
      userId: 'user-1',
      tenantId: 'org-1',
      notificationId: 'digest-notif-1',
      payload: { text: 'дедлайн лендинга в пятницу' },
    });

    expect(ctx.mocks.respondToProbe).toHaveBeenCalledTimes(1);
    const arg = ctx.mocks.respondToProbe.mock.calls[0]![0] as {
      notificationId: string;
      userId: string;
      payload: Record<string, unknown>;
    };
    expect(arg.notificationId).toBe('digest-notif-1');
    expect(arg.userId).toBe('user-1');
    expect(arg.payload.probeEventId).toBe('p-2');
  });

  it('обычный probe.question → respondToProbe БЕЗ добавления probeEventId', async () => {
    ctx.mocks.notificationFindUnique.mockResolvedValueOnce({
      eventType: 'probe.question',
      payload: { question: 'один вопрос' },
    });

    await dispatch(ctx.bridge, {
      type: 'response',
      userId: 'user-1',
      tenantId: 'org-1',
      notificationId: 'q-notif-1',
      payload: { text: 'мой ответ' },
    });

    expect(ctx.mocks.respondToProbe).toHaveBeenCalledTimes(1);
    const arg = ctx.mocks.respondToProbe.mock.calls[0]![0] as {
      payload: Record<string, unknown>;
    };
    expect(arg.payload.probeEventId).toBeUndefined();
  });

  it("type !== 'response' → no-op (respondToProbe не вызван)", async () => {
    await dispatch(ctx.bridge, {
      type: 'free_note',
      userId: 'user-1',
      tenantId: 'org-1',
      text: 'заметка',
    });

    expect(ctx.mocks.respondToProbe).not.toHaveBeenCalled();
    expect(ctx.mocks.notificationFindUnique).not.toHaveBeenCalled();
  });

  it('onModuleInit подписывает обработчик на response', () => {
    ctx.bridge.onModuleInit();
    expect(ctx.mocks.subscribeInbound).toHaveBeenCalledWith('response', expect.any(Function));
  });
});
