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
