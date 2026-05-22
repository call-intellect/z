import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { DataClass, Source } from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { AuditLogService } from '../../../audit/audit-log.service';
import { AUDIT } from '../../../audit/audit.types';
import { CoreQueueService } from '../../../core-queue/core-queue.service';
import { QuotaService } from '../../../quotas/quota.service';
import { IngestService } from '../../ingest.service';

/**
 * Сервис web-form адаптера (Фаза 10 knowledge-core, Шаг 7).
 *
 *   - lazy-upsert `Source(tenantId, type='web_form', name='Дамп мысли')`.
 *   - Применяет квоту `dump_per_day_per_user` (default 30/день).
 *   - sourceExternalId = `web:<userId>:<nonce>` (idempotency).
 *   - Audit `dump.created` с длиной текста и dataClass.
 */
@Injectable()
export class DumpService {
  private readonly logger = new Logger(DumpService.name);

  /** Канонический name дефолтного web_form-Source для Org. */
  static readonly SOURCE_NAME = 'Дамп мысли';

  /** Квота — в день (24 часа), 30 дампов на юзера. */
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
  ) {}

  async createDump(input: {
    tenantId: string;
    userId: string;
    userName: string | null;
    text: string;
    occurredAt?: Date;
    dataClass?: DataClass;
    nonce?: string;
  }): Promise<{ rawEventId: string; idempotent: boolean; documentId?: string }> {
    // 1. Квота.
    await this.quota.checkAndIncrement({
      userId: input.userId,
      quotaName: DumpService.QUOTA_NAME,
      max: DumpService.QUOTA_MAX,
      windowMs: DumpService.QUOTA_WINDOW_MS,
    });

    // 2. Source — lazy upsert (один на Org).
    const source = await this.upsertWebFormSource(input.tenantId);

    // 3. Идемпотентность через nonce — если фронт не сгенерил, делаем server-side
    //    UUID, тогда повторный вызов будет считаться новым событием (что
    //    приемлемо для server-issued nonce).
    const nonce = input.nonce ?? randomUUID();
    const sourceExternalId = `web:${input.userId}:${nonce}`;
    const occurredAt = input.occurredAt ?? new Date();
    const dataClass = input.dataClass ?? source.dataClass;

    // 4. Фаза 0b: если у текущего user'а есть привязанный Person — создаём
    //    Document {kind:'text', status:'parsed'} как контейнер дампа, чтобы
    //    /documents/:id и provenance в knowledge-core работали единообразно.
    //    Если Person нет (пользователь без membership.person или из старой
    //    Org до Phase 0a) — деградируем на legacy-путь: только RawEvent.
    const person = await this.prisma.person.findFirst({
      where: { tenantId: input.tenantId, userId: input.userId, deletedAt: null },
      select: { id: true },
    });

    if (person) {
      const documentId = await this.createTextDocumentAndPublish({
        tenantId: input.tenantId,
        uploaderPersonId: person.id,
        userId: input.userId,
        text: input.text,
        dataClass,
      });
      // Фаза 0b: text.adapter подхватит dump-created, создаст RawEvent и
      // продолжит knowledge-core pipeline. Возвращаем `rawEventId` как
      // sentinel — для legacy-клиентов /ingest/dump мы должны вернуть
      // что-то осмысленное; теперь это id Document'а (контракт расширен).
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

    // Legacy-путь — Person нет, создаём только RawEvent (как раньше).
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

  /**
   * Фаза 0b helper: создаёт Document {kind:'text', status:'parsed', inlineContent}
   * и публикует `core.dump-created` для text.adapter'а. Используется как из
   * legacy /ingest/dump (если у user'а есть Person), так и из нового
   * /api/v1/documents/text эндпоинта.
   */
  async createTextDocumentAndPublish(args: {
    tenantId: string;
    uploaderPersonId: string;
    userId: string;
    text: string;
    dataClass?: DataClass;
  }): Promise<string> {
    const timestamp = new Date();
    const inline = Buffer.from(args.text, 'utf-8');
    // Prisma 7 Bytes-поле ожидает Uint8Array<ArrayBuffer>.
    const inlineBytes = Uint8Array.from(inline);
    const doc = await this.prisma.document.create({
      data: {
        tenantId: args.tenantId,
        uploaderId: args.uploaderPersonId,
        kind: 'text',
        name: `Дамп от ${formatDumpName(timestamp)}`,
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

/**
 * Формат имени дампа: "21.05.2026 14:30" — единый для UI и Document.name.
 */
function formatDumpName(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}
