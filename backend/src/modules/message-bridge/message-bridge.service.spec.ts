import type { RawEvent, Source } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { IngestService } from '../ingest/ingest.service';

import { MessageBridgeService } from './message-bridge.service';

function makeSource(): Source {
  return {
    id: 'src-chat-1',
    tenantId: 'org-1',
    type: 'chat',
    name: 'Внешние чаты (мост)',
    config: {},
    dataClass: 'sensitive',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Source;
}

function makeRawEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: 'raw-1',
    tenantId: 'org-1',
    sourceId: 'src-chat-1',
    sourceType: 'chat',
    sourceExternalId: null,
    idempotencyKey: 'idem-1',
    occurredAt: new Date(),
    receivedAt: new Date(),
    payloadStorage: 'inline',
    payload: null,
    payloadS3Key: null,
    payloadChecksum: 'sha',
    payloadSizeBytes: 100,
    dataClass: 'sensitive',
    processingStatus: 'received',
    processingError: null,
    processedAt: null,
    ...overrides,
  } as unknown as RawEvent;
}

function makeService(opts: { enabled?: boolean } = {}) {
  const prisma = {
    source: {
      upsert: vi.fn().mockResolvedValue(makeSource()),
    },
  } as unknown as PrismaService;

  const ingest = {
    ingest: vi.fn().mockResolvedValue({ rawEvent: makeRawEvent(), idempotent: false }),
  } as unknown as IngestService;

  const cfg = {
    knowledgeCore: { messageBridgeEnabled: opts.enabled ?? true },
  } as unknown as TypedConfigService;

  const service = new MessageBridgeService(prisma, ingest, cfg);
  return { service, prisma, ingest, cfg };
}

function ingestCall(ingest: IngestService, idx = 0) {
  return (ingest.ingest as unknown as { mock: { calls: unknown[][] } }).mock.calls[idx]![0] as {
    tenantId: string;
    sourceId: string;
    sourceExternalId: string | null;
    payload: Record<string, unknown>;
    dataClass: string;
  };
}

describe('MessageBridgeService.ingestChatMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chat_message → ingest.ingest с payload.kind="chat_message" и правильным sourceExternalId', async () => {
    const { service, ingest } = makeService();

    const result = await service.ingestChatMessage({
      tenantId: 'org-1',
      channel: 'telegram_export',
      threadExternalId: 'chat-777',
      threadTitle: 'Команда',
      messageExternalId: 'msg-42',
      externalAuthorId: 'tg-9',
      authorName: 'Иван',
      text: 'Привет, как продажи?',
      occurredAt: new Date('2026-06-01T10:00:00Z'),
    });

    expect('rawEvent' in result).toBe(true);
    expect(ingest.ingest).toHaveBeenCalledTimes(1);

    const call = ingestCall(ingest);
    expect(call.tenantId).toBe('org-1');
    expect(call.sourceId).toBe('src-chat-1');
    expect(call.sourceExternalId).toBe('telegram_export:chat-777:msg-42');
    expect(call.dataClass).toBe('sensitive');
    expect(call.payload).toMatchObject({
      kind: 'chat_message',
      channel: 'telegram_export',
      threadExternalId: 'chat-777',
      threadTitle: 'Команда',
      externalAuthorId: 'tg-9',
      authorName: 'Иван',
      text: 'Привет, как продажи?',
    });
  });

  it('metadata попадает в payload только если задан', async () => {
    const { service, ingest } = makeService();
    await service.ingestChatMessage({
      tenantId: 'org-1',
      channel: 'bitrix',
      threadExternalId: 'd-1',
      messageExternalId: 'm-1',
      text: 'есть мета',
      occurredAt: new Date(),
      metadata: { reaction: '👍' },
    });
    const call = ingestCall(ingest);
    expect(call.payload['metadata']).toEqual({ reaction: '👍' });

    await service.ingestChatMessage({
      tenantId: 'org-1',
      channel: 'bitrix',
      threadExternalId: 'd-1',
      messageExternalId: 'm-2',
      text: 'без меты',
      occurredAt: new Date(),
    });
    const call2 = ingestCall(ingest, 1);
    expect(Object.prototype.hasOwnProperty.call(call2.payload, 'metadata')).toBe(false);
  });

  it('идемпотентность: повтор с тем же messageExternalId → стабильный sourceExternalId', async () => {
    const { service, ingest } = makeService();
    const args = {
      tenantId: 'org-1',
      channel: 'telegram_export' as const,
      threadExternalId: 'chat-1',
      messageExternalId: 'msg-99',
      text: 'дубль',
      occurredAt: new Date('2026-06-01T10:00:00Z'),
    };

    (ingest.ingest as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(
      { rawEvent: makeRawEvent({ id: 'raw-a' }), idempotent: false },
    );
    (ingest.ingest as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(
      { rawEvent: makeRawEvent({ id: 'raw-a' }), idempotent: true },
    );

    await service.ingestChatMessage(args);
    await service.ingestChatMessage(args);

    expect(ingestCall(ingest, 0).sourceExternalId).toBe('telegram_export:chat-1:msg-99');
    expect(ingestCall(ingest, 1).sourceExternalId).toBe('telegram_export:chat-1:msg-99');
  });

  it('MESSAGE_BRIDGE_ENABLED=false → {skipped:true}, ingest НЕ вызван', async () => {
    const { service, ingest, prisma } = makeService({ enabled: false });

    const result = await service.ingestChatMessage({
      tenantId: 'org-1',
      channel: 'telegram_export',
      threadExternalId: 'c-1',
      messageExternalId: 'm-1',
      text: 'не должно записаться',
      occurredAt: new Date(),
    });

    expect(result).toEqual({ skipped: true });
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(prisma.source.upsert).not.toHaveBeenCalled();
  });

  it('пустой text → {skipped:true}, ingest НЕ вызван', async () => {
    const { service, ingest } = makeService();

    const result = await service.ingestChatMessage({
      tenantId: 'org-1',
      channel: 'bitrix',
      threadExternalId: 'c-1',
      messageExternalId: 'm-1',
      text: '   ',
      occurredAt: new Date(),
    });

    expect(result).toEqual({ skipped: true });
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('Bitrix-образное сообщение (channel="bitrix") → тоже chat_message (R1)', async () => {
    const { service, ingest } = makeService();

    await service.ingestChatMessage({
      tenantId: 'org-1',
      channel: 'bitrix',
      threadExternalId: 'dialog-55',
      messageExternalId: 'bx-7',
      externalAuthorId: '101',
      authorName: 'Менеджер',
      text: 'Клиент просит скидку',
      occurredAt: new Date('2026-06-02T09:00:00Z'),
    });

    const call = ingestCall(ingest);
    expect(call.sourceExternalId).toBe('bitrix:dialog-55:bx-7');
    expect(call.payload).toMatchObject({ kind: 'chat_message', channel: 'bitrix' });
  });

  it('ensureChatSource upsert-ит Source(type=chat, name="Внешние чаты (мост)", sensitive)', async () => {
    const { service, prisma } = makeService();

    await service.ingestChatMessage({
      tenantId: 'org-9',
      channel: 'telegram_export',
      threadExternalId: 'c-1',
      messageExternalId: 'm-1',
      text: 'привет',
      occurredAt: new Date(),
    });

    const upsert = (prisma.source.upsert as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as {
      where: { tenantId_type_name: { tenantId: string; type: string; name: string } };
      create: { type: string; name: string; dataClass: string };
    };
    expect(upsert.where.tenantId_type_name).toEqual({
      tenantId: 'org-9',
      type: 'chat',
      name: 'Внешние чаты (мост)',
    });
    expect(upsert.create.dataClass).toBe('sensitive');
  });
});
