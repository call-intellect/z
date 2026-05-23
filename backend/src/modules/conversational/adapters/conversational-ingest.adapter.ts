import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass, RawEvent } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { IngestService } from '../../ingest/ingest.service';
import type { ConversationalJson } from '../types/channel.types';

/**
 * Адаптер ingest'а для свободных заметок (`free_note`), которые приходят
 * через ConversationalModule из любого канала (in_app/email/telegram/...).
 *
 * Создаёт ровно один `Source(type=conversational, name='Свободные заметки')`
 * на Org (lazy-upsert) и вызывает `IngestService.ingest(...)` с
 * `sourceExternalId = sha256(userId|tenantId|occurredAt|firstBytes)`,
 * чтобы дать идемпотентность по дубликатам без дополнительного клиентского
 * id. Каноничный payload — { kind: 'free_note', userId, text, metadata }.
 *
 * `sha256` посчитан в IngestService через payloadChecksum как fallback,
 * поэтому здесь мы передаём `sourceExternalId = null` — пусть
 * `IngestService` сам уйдёт на дедуп по checksum.
 */
@Injectable()
export class ConversationalIngestAdapter {
  private readonly logger = new Logger(ConversationalIngestAdapter.name);

  /** Канонический name source'а для conversational free-notes. */
  static readonly DEFAULT_SOURCE_NAME = 'Свободные заметки';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  /**
   * Главная точка входа: входящая свободная заметка из любого канала.
   * Возвращает созданный/найденный `RawEvent`.
   */
  async ingestFreeNote(args: {
    tenantId: string;
    userId: string;
    text: string;
    occurredAt?: Date;
    metadata?: ConversationalJson;
    dataClass?: DataClass;
  }): Promise<RawEvent> {
    const source = await this.ensureSource(args.tenantId);
    const occurredAt = args.occurredAt ?? new Date();

    const payload = {
      kind: 'free_note' as const,
      userId: args.userId,
      text: args.text,
      metadata: args.metadata ?? null,
    };

    const result = await this.ingest.ingest({
      tenantId: args.tenantId,
      sourceId: source.id,
      sourceExternalId: null,
      occurredAt,
      payload,
      dataClass: args.dataClass ?? 'internal',
    });

    this.logger.debug(
      `ingestFreeNote tenantId=${args.tenantId} userId=${args.userId} rawEventId=${result.rawEvent.id} idempotent=${result.idempotent}`,
    );
    return result.rawEvent;
  }

  /**
   * SBA β-5 closing-loop — записывает ответ пользователя на probe-уведомление
   * как `RawEvent` (kind='notification_response') и явно связывает его с
   * исходной `Notification` через `payload.respondsToNotificationId` (это
   * наш «metaJson.respondsToNotificationId» — у RawEvent отдельного metaJson
   * поля нет, используем тот же payload-канал, как для free_note).
   *
   * `sourceExternalId = notificationId` гарантирует идемпотентность: повторный
   * вызов с тем же `notificationId` (+ той же `occurredAt`) вернёт ранее
   * созданный `RawEvent`. Если по probe приходит два разных ответа подряд
   * (см. ТЗ §3.4 idempotency), вызывающая сторона обязана передать разные
   * `occurredAt` — иначе второй вызов будет дедуплицирован.
   */
  async ingestNotificationResponse(args: {
    tenantId: string;
    userId: string;
    notificationId: string;
    eventType: string;
    payload: ConversationalJson;
    occurredAt?: Date;
    dataClass?: DataClass;
    sourceChannelKind?: string | null;
    contextBlockId?: string | null;
    contextCardId?: string | null;
  }): Promise<RawEvent> {
    const source = await this.ensureSource(args.tenantId);
    const occurredAt = args.occurredAt ?? new Date();

    const rawPayload = {
      kind: 'notification_response' as const,
      userId: args.userId,
      respondsToNotificationId: args.notificationId,
      eventType: args.eventType,
      sourceChannelKind: args.sourceChannelKind ?? null,
      contextBlockId: args.contextBlockId ?? null,
      contextCardId: args.contextCardId ?? null,
      response: args.payload,
    };

    const result = await this.ingest.ingest({
      tenantId: args.tenantId,
      sourceId: source.id,
      // sourceExternalId = `resp:<notificationId>` — детерминированная связка
      // 1-к-1; повторный ingest того же ответа вернёт идемпотентный RawEvent.
      sourceExternalId: `resp:${args.notificationId}`,
      occurredAt,
      payload: rawPayload,
      dataClass: args.dataClass ?? 'internal',
    });

    this.logger.debug(
      `ingestNotificationResponse tenantId=${args.tenantId} userId=${args.userId} notificationId=${args.notificationId} rawEventId=${result.rawEvent.id} idempotent=${result.idempotent}`,
    );
    return result.rawEvent;
  }

  private async ensureSource(tenantId: string) {
    // Уникальность гарантирована @@unique([tenantId, type, name]) в Source.
    return this.prisma.source.upsert({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'conversational',
          name: ConversationalIngestAdapter.DEFAULT_SOURCE_NAME,
        },
      },
      update: {},
      create: {
        tenantId,
        type: 'conversational',
        name: ConversationalIngestAdapter.DEFAULT_SOURCE_NAME,
        dataClass: 'internal',
        isActive: true,
        config: {},
      },
    });
  }
}
