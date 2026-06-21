import type { RawEvent } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { DialogTurn } from '../../ai/services/prompts/common';
import type { EntityResolutionService } from '../../knowledge-core/services/entity-resolution.service';
import type { S3Service } from '../../recordings/s3.service';

import { DaySignalExtractorService } from './day-signal-extractor.service';

const TENANT = 'tenant-1';
const OCCURRED_AT = new Date('2026-06-21T08:00:00.000Z');

function makeEvent(partial: Partial<RawEvent> & { sourceType: string; payload: unknown }): RawEvent {
  return {
    id: 'raw-1',
    tenantId: TENANT,
    sourceId: 'src-1',
    sourceType: partial.sourceType,
    sourceExternalId: 'ext-1',
    occurredAt: OCCURRED_AT,
    payload: partial.payload as never,
    payloadStorage: partial.payloadStorage ?? 'inline',
    payloadS3Key: partial.payloadS3Key ?? null,
    dataClass: 'internal',
    createdAt: OCCURRED_AT,
  } as unknown as RawEvent;
}

describe('DaySignalExtractorService', () => {
  let s3: { getJson: ReturnType<typeof vi.fn> };
  let entities: { resolveSubjectPersonId: ReturnType<typeof vi.fn> };
  let metrics: { incDaySignalDroppedNoPerson: ReturnType<typeof vi.fn> };
  let service: DaySignalExtractorService;

  beforeEach(() => {
    s3 = { getJson: vi.fn() };
    entities = { resolveSubjectPersonId: vi.fn() };
    metrics = { incDaySignalDroppedNoPerson: vi.fn() };
    service = new DaySignalExtractorService(
      s3 as unknown as S3Service,
      entities as unknown as EntityResolutionService,
      metrics as unknown as BusinessMetricsService,
    );
  });

  it('bitrix — 2 валидных turn + 1 без автора → 2 сообщения, дроп-метрика 1 раз', async () => {
    const event = makeEvent({
      sourceType: 'bitrix',
      payload: {
        kind: 'bitrix_dialog_session',
        transcript: {
          turns: [
            { text: 'сделал отчёт', authorPersonId: 'p1' },
            { text: 'звонок клиенту', authorPersonId: 'p2' },
            { text: 'без автора', authorPersonId: null },
          ],
        },
      },
    });

    const result = await service.extractFromRawEvent(event);

    expect(result).toEqual([
      { personId: 'p1', text: 'сделал отчёт', source: 'bitrix', occurredAt: OCCURRED_AT },
      { personId: 'p2', text: 'звонок клиенту', source: 'bitrix', occurredAt: OCCURRED_AT },
    ]);
    expect(metrics.incDaySignalDroppedNoPerson).toHaveBeenCalledTimes(1);
    expect(metrics.incDaySignalDroppedNoPerson).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'bitrix' }),
    );
    expect(entities.resolveSubjectPersonId).not.toHaveBeenCalled();
  });

  it('chatbox — реплика менеджера + реплика клиента (без автора) → 1 сообщение, дроп 1 раз', async () => {
    const event = makeEvent({
      sourceType: 'chatbox',
      payload: {
        kind: 'chatbox_chat_session',
        transcript: {
          turns: [
            { text: 'ответил клиенту', authorPersonId: 'mgr1' },
            { text: 'когда будет готово?', authorPersonId: null },
          ],
        },
      },
    });

    const result = await service.extractFromRawEvent(event);

    expect(result).toEqual([
      { personId: 'mgr1', text: 'ответил клиенту', source: 'chatbox', occurredAt: OCCURRED_AT },
    ]);
    expect(metrics.incDaySignalDroppedNoPerson).toHaveBeenCalledTimes(1);
    expect(metrics.incDaySignalDroppedNoPerson).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'chatbox' }),
    );
  });

  it('email — резолв по адресу → 1 сообщение source=email', async () => {
    entities.resolveSubjectPersonId.mockResolvedValue('pe');
    const event = makeEvent({
      sourceType: 'email',
      payload: {
        from: { name: 'Алиса', address: 'a@b.ru' },
        subject: 'Тема',
        text: 'короткий',
        fullText: 'полный текст письма',
      },
    });

    const result = await service.extractFromRawEvent(event);

    expect(result).toEqual([
      { personId: 'pe', text: 'полный текст письма', source: 'email', occurredAt: OCCURRED_AT },
    ]);
    expect(entities.resolveSubjectPersonId).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ authorEmail: 'a@b.ru' }),
    );
    expect(metrics.incDaySignalDroppedNoPerson).not.toHaveBeenCalled();
  });

  it('email — автор не резолвится → 0 сообщений + дроп', async () => {
    entities.resolveSubjectPersonId.mockResolvedValue(null);
    const event = makeEvent({
      sourceType: 'email',
      payload: {
        from: { name: 'Чужой', address: 'x@y.ru' },
        subject: 'Тема',
        text: null,
        fullText: 'есть текст',
      },
    });

    const result = await service.extractFromRawEvent(event);

    expect(result).toEqual([]);
    expect(metrics.incDaySignalDroppedNoPerson).toHaveBeenCalledTimes(1);
    expect(metrics.incDaySignalDroppedNoPerson).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'email' }),
    );
  });

  it('conversational free_note — резолв по userId → 1 сообщение source=self_initiated', async () => {
    entities.resolveSubjectPersonId.mockResolvedValue('pf');
    const event = makeEvent({
      sourceType: 'conversational',
      payload: { kind: 'free_note', userId: 'u1', text: 'план', metadata: null },
    });

    const result = await service.extractFromRawEvent(event);

    expect(result).toEqual([
      { personId: 'pf', text: 'план', source: 'self_initiated', occurredAt: OCCURRED_AT },
    ]);
    expect(entities.resolveSubjectPersonId).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ authorUserId: 'u1' }),
    );
  });

  it('conversational notification_response → 0 сообщений, resolve не вызван', async () => {
    const event = makeEvent({
      sourceType: 'conversational',
      payload: { kind: 'notification_response', userId: 'u1', text: 'да' },
    });

    const result = await service.extractFromRawEvent(event);

    expect(result).toEqual([]);
    expect(entities.resolveSubjectPersonId).not.toHaveBeenCalled();
    expect(metrics.incDaySignalDroppedNoPerson).not.toHaveBeenCalled();
  });

  it('phone_call → 0 сообщений, метрика не вызвана', async () => {
    const event = makeEvent({
      sourceType: 'phone_call',
      payload: { fullText: 'разговор без атрибуции' },
    });

    const result = await service.extractFromRawEvent(event);

    expect(result).toEqual([]);
    expect(metrics.incDaySignalDroppedNoPerson).not.toHaveBeenCalled();
    expect(entities.resolveSubjectPersonId).not.toHaveBeenCalled();
  });

  it('extractFromMeeting — turn со спикером + turn без спикера → 1 сообщение, дроп meeting', async () => {
    entities.resolveSubjectPersonId.mockResolvedValue('pm');
    const turns: DialogTurn[] = [
      { speaker: 'Иван', text: 'закрыл задачу', startSec: 0, endSec: 1, speakerParticipantId: 'sp1' },
      { speaker: 'Без id', text: 'без спикера', startSec: 1, endSec: 2, speakerParticipantId: null },
    ];

    const result = await service.extractFromMeeting({ tenantId: TENANT, turns, occurredAt: OCCURRED_AT });

    expect(result).toEqual([
      { personId: 'pm', text: 'закрыл задачу', source: 'meeting', occurredAt: OCCURRED_AT },
    ]);
    expect(metrics.incDaySignalDroppedNoPerson).toHaveBeenCalledTimes(1);
    expect(metrics.incDaySignalDroppedNoPerson).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'meeting' }),
    );
    expect(entities.resolveSubjectPersonId).toHaveBeenCalledTimes(1);
  });

  it('extractFromMeeting — кэширует резолв по speakerParticipantId', async () => {
    entities.resolveSubjectPersonId.mockResolvedValue('pm');
    const turns: DialogTurn[] = [
      { speaker: 'Иван', text: 'первое', startSec: 0, endSec: 1, speakerParticipantId: 'sp1' },
      { speaker: 'Иван', text: 'второе', startSec: 1, endSec: 2, speakerParticipantId: 'sp1' },
    ];

    const result = await service.extractFromMeeting({ tenantId: TENANT, turns, occurredAt: OCCURRED_AT });

    expect(result).toHaveLength(2);
    expect(entities.resolveSubjectPersonId).toHaveBeenCalledTimes(1);
  });
});
