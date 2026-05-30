/**
 * Commercial-reliability pack (2026-05-29) — unit-тесты для
 * `ConversationalFreeNoteBridge`.
 *
 * Покрывает:
 *   - подписка на 'free_note' в `onModuleInit`,
 *   - корректный вызов `ingestFreeNote` с tenantId/userId/text/metadata,
 *   - игнор сообщений другого type (defensive guard),
 *   - подавление exception'а из `ingestFreeNote` (не валим pipeline).
 */

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
  const conversational = {
    subscribeInbound: vi.fn(
      (type: InboundMessage['type'], handler: InboundHandler) => {
        const list = registered.get(type) ?? [];
        list.push(handler);
        registered.set(type, list);
      },
    ),
  } as unknown as ConversationalService;

  const ingest = {
    ingestFreeNote: vi.fn().mockResolvedValue(makeRawEvent()),
  } as unknown as ConversationalIngestAdapter;

  const bridge = new ConversationalFreeNoteBridge(conversational, ingest);
  return { bridge, conversational, ingest, registered };
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
    const call = (
      ingest.ingestFreeNote as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]![0] as {
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
    // Подаём msg другого type (могло бы случиться, если бы registry'ы перепутались).
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
    // Не должно бросать наружу — ConversationalService.dispatchInbound сам ловит
    // exceptions, но bridge тоже не пускает их выше для чистого лога.
    await expect(
      handler({
        type: 'free_note',
        userId: 'user-1',
        tenantId: 'org-1',
        text: 'тест',
      }),
    ).resolves.toBeUndefined();
  });
});
