import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass, Source } from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { AuditLogService } from '../../../audit/audit-log.service';
import { AUDIT } from '../../../audit/audit.types';
import { CoreQueueService } from '../../../core-queue/core-queue.service';
import { PersonsService } from '../../../persons/services/persons.service';
import { QuotaService } from '../../../quotas/quota.service';
import { IngestService } from '../../ingest.service';

@Injectable()
export class DumpService {
  private readonly logger = new Logger(DumpService.name);

  static readonly SOURCE_NAME = 'Дамп мысли';

  private static readonly QUOTA_NAME = 'dump_per_day_per_user';
  private static readonly QUOTA_MAX = 30;
  private static readonly QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(QuotaService) private readonly quota: QuotaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(PersonsService) private readonly persons: PersonsService,
  ) {}

  async shortTextToIdeaThreshold(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'documents.short_text_to_idea_threshold',
      undefined,
      200,
    );
  }

  async createDump(input: {
    tenantId: string;
    userId: string;
    userName: string | null;
    text: string;
    occurredAt?: Date;
    dataClass?: DataClass;
    nonce?: string;
    asIdea?: boolean;
  }): Promise<{ rawEventId: string; idempotent: boolean; documentId?: string }> {
    await this.quota.checkAndIncrement({
      userId: input.userId,
      quotaName: DumpService.QUOTA_NAME,
      max: DumpService.QUOTA_MAX,
      windowMs: DumpService.QUOTA_WINDOW_MS,
    });

    const source = await this.upsertWebFormSource(input.tenantId);

    const nonce = input.nonce ?? randomUUID();
    const sourceExternalId = `web:${input.userId}:${nonce}`;
    const occurredAt = input.occurredAt ?? new Date();
    const dataClass = input.dataClass ?? source.dataClass;

    const person = await this.resolvePersonOrNull(input.tenantId, input.userId);

    if (person && !input.asIdea) {
      const documentId = await this.createTextDocumentAndPublish({
        tenantId: input.tenantId,
        uploaderPersonId: person.id,
        userId: input.userId,
        text: input.text,
        dataClass,
      });
      await this.audit.log({
        userId: input.userId,
        action: AUDIT.DUMP_CREATED,
        resourceId: documentId,
        metadata: { length: input.text.length, dataClass, via: 'document' },
      });
      this.logger.log(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          documentId,
        },
        'dump: создан Document (фаза 0b), text.adapter подхватит',
      );
      return { rawEventId: documentId, idempotent: false, documentId };
    }

    const payload = {
      text: input.text,
      authorUserId: input.userId,
      authorName: input.userName,
    };
    const result = await this.ingest.ingest({
      tenantId: input.tenantId,
      sourceId: source.id,
      sourceExternalId,
      occurredAt,
      payload,
      dataClass,
    });

    await this.audit.log({
      userId: input.userId,
      action: AUDIT.DUMP_CREATED,
      resourceId: result.rawEvent.id,
      metadata: { length: input.text.length, dataClass, via: 'raw_event' },
    });

    this.logger.log(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        rawEventId: result.rawEvent.id,
        idempotent: result.idempotent,
      },
      'dump: создан (legacy путь без Person)',
    );

    return { rawEventId: result.rawEvent.id, idempotent: result.idempotent };
  }

  private async resolvePersonOrNull(
    tenantId: string,
    userId: string,
  ): Promise<{ id: string } | null> {
    try {
      return await this.persons.ensurePersonForUser({ tenantId, userId });
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'dump: ensurePersonForUser не смог — fallback на legacy-путь',
      );
      return null;
    }
  }

  async createTextDocumentAndPublish(args: {
    tenantId: string;
    uploaderPersonId: string;
    userId: string;
    text: string;
    dataClass?: DataClass;
  }): Promise<string> {
    const timestamp = new Date();
    const inline = Buffer.from(args.text, 'utf-8');
    const inlineBytes = Uint8Array.from(inline);
    const doc = await this.prisma.document.create({
      data: {
        tenantId: args.tenantId,
        uploaderId: args.uploaderPersonId,
        kind: 'text',
        name: deriveTextNoteName(args.text, timestamp),
        mimeType: 'text/plain; charset=utf-8',
        inlineContent: inlineBytes,
        originalSize: inline.byteLength,
        parsedText: args.text,
        status: 'parsed',
      },
    });
    await this.coreQueue.enqueueDumpCreated({
      tenantId: args.tenantId,
      documentId: doc.id,
      uploaderPersonId: args.uploaderPersonId,
      content: args.text,
    });
    return doc.id;
  }

  private async upsertWebFormSource(tenantId: string): Promise<Source> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'web_form',
          name: DumpService.SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'web_form',
          name: DumpService.SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        },
      });
    } catch {
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'web_form',
            name: DumpService.SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw new Error('DumpService: не удалось upsert web_form Source');
    }
  }
}

const TEXT_NOTE_NAME_MAX_LENGTH = 80;

export function deriveTextNoteName(text: string, d: Date): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) {
    return firstLine.length > TEXT_NOTE_NAME_MAX_LENGTH
      ? `${firstLine.slice(0, TEXT_NOTE_NAME_MAX_LENGTH - 1).trimEnd()}…`
      : firstLine;
  }
  return `Текстовая заметка от ${formatNoteDate(d)}`;
}

function formatNoteDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}
