/**
 * SBA β-5 closing-loop (sub-TZ 2026-05-23) — unit-тесты для
 * `ConversationalIngestAdapter.ingestNotificationResponse`.
 *
 * Покрывает:
 *   - корректный payload (kind='notification_response',
 *     respondsToNotificationId, eventType, sourceChannelKind),
 *   - детерминированный sourceExternalId (`resp:<notificationId>`),
 *   - upsert Source(type=conversational) перед ingest'ом,
 *   - идемпотентный повторный вызов (IngestService возвращает existing).
 */

import type { RawEvent, Source } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IngestService } from '../../ingest/ingest.service';

import { ConversationalIngestAdapter } from './conversational-ingest.adapter';

function makeSource(): Source {
  return {
    id: 'src-conv-1',
    tenantId: 'org-1',
    type: 'conversational',
    name: ConversationalIngestAdapter.DEFAULT_SOURCE_NAME,
    config: {},
    dataClass: 'internal',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Source;
}

function makeRawEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: 'raw-1',
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
    ...overrides,
  } as unknown as RawEvent;
}

function makeAdapter() {
  const source = makeSource();
  const prisma = {
    source: {
      upsert: vi.fn().mockResolvedValue(source),
    },
  } as unknown as PrismaService;

  const rawEvent = makeRawEvent();
  const ingest = {
    ingest: vi
      .fn()
      .mockResolvedValue({ rawEvent, idempotent: false }),
  } as unknown as IngestService;

  const adapter = new ConversationalIngestAdapter(prisma, ingest);
  return { adapter, prisma, ingest, rawEvent };
}

describe('ConversationalIngestAdapter.ingestNotificationResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('создаёт RawEvent с payload.kind="notification_response" и respondsToNotificationId', async () => {
    const { adapter, ingest } = makeAdapter();

    const result = await adapter.ingestNotificationResponse({
      tenantId: 'org-1',
      userId: 'user-1',
      notificationId: 'notif-42',
      eventType: 'probe.question',
      payload: { choice: 'Да', text: 'Подтверждаю' },
      sourceChannelKind: 'in_app',
      contextBlockId: 'block-1',
      contextCardId: null,
    });

    expect(result).toBeDefined();
    expect(ingest.ingest).toHaveBeenCalledTimes(1);

    const call = (ingest.ingest as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]![0] as {
      tenantId: string;
      sourceId: string;
      sourceExternalId: string | null;
      payload: Record<string, unknown>;
      dataClass: string;
    };

    expect(call.tenantId).toBe('org-1');
    expect(call.sourceId).toBe('src-conv-1');
    expect(call.sourceExternalId).toBe('resp:notif-42');
    expect(call.dataClass).toBe('internal');
    expect(call.payload).toMatchObject({
      kind: 'notification_response',
      userId: 'user-1',
      respondsToNotificationId: 'notif-42',
      eventType: 'probe.question',
      sourceChannelKind: 'in_app',
      contextBlockId: 'block-1',
      contextCardId: null,
      response: { choice: 'Да', text: 'Подтверждаю' },
    });
  });

  it('upsert-ит Source(type=conversational) с DEFAULT_SOURCE_NAME перед ingest', async () => {
    const { adapter, prisma } = makeAdapter();

    await adapter.ingestNotificationResponse({
      tenantId: 'org-2',
      userId: 'user-2',
      notificationId: 'notif-1',
      eventType: 'probe.question',
      payload: {},
    });

    const upsert = (
      prisma.source.upsert as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]![0] as {
      where: { tenantId_type_name: { tenantId: string; type: string; name: string } };
      create: { tenantId: string; type: string; name: string };
    };

    expect(upsert.where.tenantId_type_name).toEqual({
      tenantId: 'org-2',
      type: 'conversational',
      name: ConversationalIngestAdapter.DEFAULT_SOURCE_NAME,
    });
    expect(upsert.create.type).toBe('conversational');
  });

  it('идемпотентный повторный вызов возвращает existing RawEvent', async () => {
    const { adapter, ingest } = makeAdapter();

    // Замена mock: имитируем «уже было».
    const existing = makeRawEvent({ id: 'raw-existing' });
    (ingest.ingest as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ rawEvent: existing, idempotent: true });

    const result1 = await adapter.ingestNotificationResponse({
      tenantId: 'org-1',
      userId: 'user-1',
      notificationId: 'notif-99',
      eventType: 'probe.question',
      payload: { choice: 'Нет' },
    });
    const result2 = await adapter.ingestNotificationResponse({
      tenantId: 'org-1',
      userId: 'user-1',
      notificationId: 'notif-99',
      eventType: 'probe.question',
      payload: { choice: 'Нет' },
    });

    expect(result1.id).toBe('raw-existing');
    expect(result2.id).toBe('raw-existing');
    expect(ingest.ingest).toHaveBeenCalledTimes(2);
    // Оба вызова идут с одним sourceExternalId — IngestService дедуплицирует.
    const call1 = (ingest.ingest as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]![0] as { sourceExternalId: string };
    const call2 = (ingest.ingest as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[1]![0] as { sourceExternalId: string };
    expect(call1.sourceExternalId).toBe('resp:notif-99');
    expect(call2.sourceExternalId).toBe('resp:notif-99');
  });

  it('по умолчанию dataClass=internal, при явном sensitive — пробрасывается', async () => {
    const { adapter, ingest } = makeAdapter();

    await adapter.ingestNotificationResponse({
      tenantId: 'org-1',
      userId: 'user-1',
      notificationId: 'notif-1',
      eventType: 'probe.question',
      payload: {},
      dataClass: 'sensitive',
    });

    const call = (ingest.ingest as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]![0] as { dataClass: string };
    expect(call.dataClass).toBe('sensitive');
  });
});
