import type { RawEvent } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationalIngestAdapter } from './adapters/conversational-ingest.adapter';
import type { ConversationalService, InboundHandler } from './conversational.service';
import { ConversationalFreeNoteBridge } from './conversational.module';
import type { InboundMessage } from './types/channel.types';

function makeRawEvent(): RawEvent {
  return {
    id: 'raw-free-1',
    tenantId: 'org-1',
    sourceId: 'src-conv-1',
    sourceType: 'conversational',
    sourceExternalId: null,
    idempotencyKey: 'idem-1',
    occurredAt: new Date(),
    receivedAt: new Date(),
    payloadStorage: 'inline',
    payload: null,
    payloadS3Key: null,
    payloadChecksum: 'sha',
    payloadSizeBytes: 100,
    dataClass: 'internal',
    processingStatus: 'received',
    processingError: null,
    processedAt: null,
  } as unknown as RawEvent;
}

function makeBridge() {
  const registered = new Map<InboundMessage['type'], InboundHandler[]>();
  const subscribeInbound = vi.fn((type: InboundMessage['type'], handler: InboundHandler) => {
    const list = registered.get(type) ?? [];
    list.push(handler);
    registered.set(type, list);
  });
  const resolveOriginChannelKinds = vi.fn().mockResolvedValue([]);
  const sendNotification = vi.fn().mockResolvedValue({ id: 'notif-1' });
  const conversational = {
    subscribeInbound,
    resolveOriginChannelKinds,
    sendNotification,
  } as unknown as ConversationalService;

  const ingest = {
    ingestFreeNote: vi.fn().mockResolvedValue(makeRawEvent()),
  } as unknown as ConversationalIngestAdapter;

  const bridge = new ConversationalFreeNoteBridge(conversational, ingest);
  return {
    bridge,
    conversational,
    ingest,
    registered,
    resolveOriginChannelKinds,
    sendNotification,
  };
}

describe('ConversationalFreeNoteBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('подписывает handler на free_note в onModuleInit', () => {
    const { bridge, conversational, registered } = makeBridge();
    bridge.onModuleInit();

    expect(conversational.subscribeInbound).toHaveBeenCalledTimes(1);
    expect(registered.get('free_note')?.length).toBe(1);
  });

  it('вызывает ingestFreeNote с tenantId/userId/text/metadata из inbound', async () => {
    const { bridge, ingest, registered } = makeBridge();
    bridge.onModuleInit();

    const handler = registered.get('free_note')![0]!;
    await handler({
      type: 'free_note',
      userId: 'user-1',
      tenantId: 'org-1',
      text: 'Идея: внедрить cache-friendly промпты',
      metadata: { source: 'telegram_bot' },
    });

    expect(ingest.ingestFreeNote).toHaveBeenCalledTimes(1);
    const call = (ingest.ingestFreeNote as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as {
      tenantId: string;
      userId: string;
      text: string;
      metadata: Record<string, unknown> | null | undefined;
    };
    expect(call.tenantId).toBe('org-1');
    expect(call.userId).toBe('user-1');
    expect(call.text).toBe('Идея: внедрить cache-friendly промпты');
    expect(call.metadata).toEqual({ source: 'telegram_bot' });
  });

  it('игнорирует сообщения другого type (defensive guard)', async () => {
    const { bridge, ingest, registered } = makeBridge();
    bridge.onModuleInit();

    const handler = registered.get('free_note')![0]!;
    await handler({
      type: 'chat_query',
      userId: 'user-1',
      tenantId: 'org-1',
      question: 'Какой план на сегодня?',
    });

    expect(ingest.ingestFreeNote).not.toHaveBeenCalled();
  });

  it('не пробрасывает exception из ingestFreeNote дальше', async () => {
    const { bridge, ingest, registered } = makeBridge();
    bridge.onModuleInit();

    (
      ingest.ingestFreeNote as unknown as {
        mockRejectedValue: (e: unknown) => void;
      }
    ).mockRejectedValue(new Error('DB down'));

    const handler = registered.get('free_note')![0]!;
    await expect(
      handler({
        type: 'free_note',
        userId: 'user-1',
        tenantId: 'org-1',
        text: 'тест',
      }),
    ).resolves.toBeUndefined();
  });

  it('happy-path: после успешного ingest шлёт note.ack с непустым text', async () => {
    const { bridge, ingest, registered, resolveOriginChannelKinds, sendNotification } =
      makeBridge();
    bridge.onModuleInit();
    resolveOriginChannelKinds.mockResolvedValue(['telegram_bot']);

    const handler = registered.get('free_note')![0]!;
    await handler({
      type: 'free_note',
      userId: 'user-1',
      tenantId: 'org-1',
      text: 'Идея: cache-friendly промпты',
      originChannelBindingId: 'binding-tg-1',
    });

    expect(ingest.ingestFreeNote).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        recipientUserId: 'user-1',
        eventType: 'note.ack',
        dataClass: 'internal',
        preferredChannelKinds: ['telegram_bot'],
      }),
    );
    const payload = sendNotification.mock.calls[0]![0].payload as {
      text: string;
    };
    expect(typeof payload.text).toBe('string');
    expect(payload.text.length).toBeGreaterThan(0);
  });

  it('без originChannelBindingId: ack уходит без preferredChannelKinds (policy in_app)', async () => {
    const { bridge, registered, resolveOriginChannelKinds, sendNotification } = makeBridge();
    bridge.onModuleInit();
    resolveOriginChannelKinds.mockResolvedValue([]);

    const handler = registered.get('free_note')![0]!;
    await handler({
      type: 'free_note',
      userId: 'user-1',
      tenantId: 'org-1',
      text: 'заметка из кабинета',
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const args = sendNotification.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.eventType).toBe('note.ack');
    expect('preferredChannelKinds' in args).toBe(false);
  });

  it('ingest упал → note.ack НЕ шлётся, handler не бросает', async () => {
    const { bridge, ingest, registered, sendNotification } = makeBridge();
    bridge.onModuleInit();

    (
      ingest.ingestFreeNote as unknown as {
        mockRejectedValue: (e: unknown) => void;
      }
    ).mockRejectedValue(new Error('DB down'));

    const handler = registered.get('free_note')![0]!;
    await expect(
      handler({
        type: 'free_note',
        userId: 'user-1',
        tenantId: 'org-1',
        text: 'тест',
        originChannelBindingId: 'binding-tg-1',
      }),
    ).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('ack упал → ошибка проглочена (ingest уже прошёл), handler не бросает', async () => {
    const { bridge, ingest, registered, sendNotification } = makeBridge();
    bridge.onModuleInit();
    sendNotification.mockRejectedValue(new Error('канал недоступен'));

    const handler = registered.get('free_note')![0]!;
    await expect(
      handler({
        type: 'free_note',
        userId: 'user-1',
        tenantId: 'org-1',
        text: 'тест',
        originChannelBindingId: 'binding-tg-1',
      }),
    ).resolves.toBeUndefined();
    expect(ingest.ingestFreeNote).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});
