import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass, RawEvent } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { IngestService } from '../../ingest/ingest.service';
import type { ConversationalJson } from '../types/channel.types';

@Injectable()
export class ConversationalIngestAdapter {
  private readonly logger = new Logger(ConversationalIngestAdapter.name);

  static readonly DEFAULT_SOURCE_NAME = 'Свободные заметки';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  async ingestFreeNote(args: {
    tenantId: string;
    userId: string;
    text: string;
    occurredAt?: Date;
    metadata?: ConversationalJson;
    dataClass?: DataClass;
    sourceExternalId?: string | null;
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
      sourceExternalId: args.sourceExternalId ?? null,
      occurredAt,
      payload,
      dataClass: args.dataClass ?? 'internal',
    });

    this.logger.debug(
      `ingestFreeNote tenantId=${args.tenantId} userId=${args.userId} rawEventId=${result.rawEvent.id} idempotent=${result.idempotent}`,
    );
    return result.rawEvent;
  }

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
    questionText?: string | null;
    signalTypeHint?: string;
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
      questionText: args.questionText ?? null,
      response: args.payload,
      ...(args.signalTypeHint ? { signalTypeHint: args.signalTypeHint } : {}),
    };

    const result = await this.ingest.ingest({
      tenantId: args.tenantId,
      sourceId: source.id,
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
