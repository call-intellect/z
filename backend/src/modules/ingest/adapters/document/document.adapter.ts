import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Document, type Source } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';
import { CoreQueueService } from '../../../core-queue/core-queue.service';
import {
  CORE_QUEUE_NAMES,
  type DocumentUploadedJobData,
} from '../../../core-queue/queues';
import { S3Service } from '../../../recordings/s3.service';
import { IngestService } from '../../ingest.service';
import {
  DocumentParseFailedError,
  ParseSizeError,
  ParseTimeoutError,
} from '../../parsers/document-parser.errors';
import { DocumentParserService } from '../../parsers/document-parser.service';

/**
 * `DocumentIngestAdapter` (Фаза 0b knowledge-core).
 *
 * BullMQ-consumer очереди `core.document-uploaded`. Реализация по ТЗ 0b.1 §4:
 *
 *   1. Находит `Document` по `documentId` (skip — если уже не `uploaded`).
 *   2. Переводит `status: uploaded → parsing`.
 *   3. Достаёт байты: `inlineContent` (если ≤ inlineThreshold) или S3-объект.
 *   4. Парсит через `DocumentParserService.parse(...)`.
 *   5. На успех:
 *      - `Document.parsedText` заполняется, `status='parsed'`.
 *      - lazy-upsert дефолтного `Source(type='external', name='Документы')`.
 *      - `RawEvent` создаётся через `IngestService.ingest(...)` (он сам
 *        enqueue'ит `core.raw-events` для дальнейшего knowledge-core pipeline).
 *   6. На фейл — `status='failed'`, `parseError=err.message`.
 *
 * Sourcing: `SourceType` пока не содержит значения `document` — используем
 * `external` как наиболее близкое по смыслу (см. отчёт по фазе 0b.1). Когда
 * enum будет расширен — миграция: смена `Source.type` для существующих
 * `Источник "Документы"` записей.
 *
 * Идемпотентность: jobId фиксируется в `CoreQueueService.enqueueDocumentUploaded`
 * (`doc_<documentId>`). При повторном retry'е воркер сам убедится через статус,
 * что Document не «в processing» одновременно — переход `uploaded → parsing`
 * через `updateMany({ status: 'uploaded' })` использует statusCheck-fence.
 */
@Injectable()
export class DocumentIngestAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentIngestAdapter.name);
  private worker: Worker<DocumentUploadedJobData> | null = null;

  /** Канонический name дефолтного external-Source для документов в Org. */
  static readonly DEFAULT_SOURCE_NAME = 'Документы';

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(DocumentParserService)
    private readonly parser: DocumentParserService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DocumentUploadedJobData>(
      CORE_QUEUE_NAMES.DOCUMENT_UPLOADED,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        // Парсинг — IO-bound (S3) + CPU-bound (pdf-parse). 2 одновременно
        // достаточно, чтобы не упереться в pdf-parse single-thread.
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        {
          jobId: job?.id,
          documentId: (job?.data as DocumentUploadedJobData | undefined)?.documentId,
          err: err.message,
        },
        'document-uploaded: job failed',
      );
    });
    this.logger.log(
      `DocumentIngestAdapter worker started (${CORE_QUEUE_NAMES.DOCUMENT_UPLOADED})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── job handler ───────────────────────────────

  async process(job: Job<DocumentUploadedJobData>): Promise<void> {
    const { documentId, tenantId } = job.data;
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) {
      this.logger.warn(
        { documentId, jobId: job.id },
        'document-uploaded: Document не найден — skip',
      );
      return;
    }
    if (doc.tenantId !== tenantId) {
      // Подделанный job или баг — не трогаем чужой документ.
      this.logger.warn(
        { documentId, jobTenantId: tenantId, docTenantId: doc.tenantId },
        'document-uploaded: tenant mismatch — skip',
      );
      return;
    }
    if (doc.status !== 'uploaded') {
      this.logger.debug(
        { documentId, status: doc.status },
        'document-uploaded: status !== uploaded — skip (idempotent)',
      );
      return;
    }

    // Атомарный переход uploaded → parsing. updateMany с условием по status —
    // защита от двойного процесса (если два воркера случайно подхватили один
    // jobId до BullMQ-дедупа).
    const fence = await this.prisma.document.updateMany({
      where: { id: documentId, status: 'uploaded' },
      data: { status: 'parsing' },
    });
    if (fence.count === 0) {
      this.logger.debug(
        { documentId },
        'document-uploaded: lost status race — skip',
      );
      return;
    }

    try {
      const buffer = await this.loadContent(doc);
      const parsed = await this.parser.parse({
        kind: doc.kind,
        content: buffer,
        mimeType: doc.mimeType,
      });

      // 1. Обновляем Document.
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          parsedText: parsed.text,
          status: 'parsed',
        },
      });

      // 2. lazy-upsert дефолтного Source для документов в Org.
      const source = await this.upsertDocumentSource(tenantId);

      // 3. Создаём RawEvent (IngestService сам публикует core.raw-events).
      const result = await this.ingest.ingest({
        tenantId,
        sourceId: source.id,
        sourceExternalId: `doc:${doc.id}`,
        occurredAt: doc.createdAt,
        payload: {
          documentId: doc.id,
          kind: doc.kind,
          name: doc.name,
          mimeType: doc.mimeType,
          uploaderId: doc.uploaderId,
          attachedRoleId: doc.attachedRoleId,
          parsedText: parsed.text,
          metadata: parsed.metadata,
        },
        dataClass: source.dataClass,
      });

      this.logger.log(
        {
          documentId,
          rawEventId: result.rawEvent.id,
          idempotent: result.idempotent,
          textLength: parsed.text.length,
        },
        'document-uploaded: успешно распарсили и создали RawEvent',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isUserVisible =
        err instanceof ParseSizeError ||
        err instanceof ParseTimeoutError ||
        err instanceof DocumentParseFailedError;
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'failed',
          // Не раскрываем internal stacktrace пользователю — храним
          // только human-readable message парсера. Stack — в логах.
          parseError: isUserVisible
            ? message
            : 'Внутренняя ошибка при разборе документа. Обратитесь к админу.',
        },
      });
      this.logger.error(
        {
          documentId,
          tenantId,
          err: message,
          kind: doc.kind,
        },
        'document-uploaded: парсинг провалился',
      );
      // BullMQ retry имеет смысл только для transient'ов (S3 down). Для
      // ParseSize/ParseTimeout/Failed — повтор бесполезен. На фазе 0b.1
      // оставляем дефолтный retry (5 попыток); следующие фазы могут
      // прокинуть `removeOnFail`/`attempts: 1` для подкласса ошибок.
      throw err;
    }
  }

  // ─────────────────────────── private helpers ───────────────────────────

  /**
   * Достаёт байты документа: inline (если есть) или из S3 (по `s3Key`).
   * Если оба пустые — бросаем `DocumentParseFailedError`.
   */
  private async loadContent(doc: Document): Promise<Buffer> {
    if (doc.inlineContent) {
      // Prisma возвращает `Buffer` для Bytes-поля.
      return Buffer.from(doc.inlineContent);
    }
    if (doc.s3Key) {
      return this.s3.getObject(doc.s3Key);
    }
    throw new DocumentParseFailedError(
      'Document не содержит ни inlineContent, ни s3Key',
    );
  }

  /**
   * Создаёт (если нет) или возвращает дефолтный Source для документов в Org.
   *
   * Тип — `external`: семантически «внешний материал, загруженный в Z».
   * `SourceType` пока не содержит `document`; при добавлении значения в enum
   * (Фаза γ) нужно мигрировать существующие записи. См. отчёт по 0b.1.
   */
  private async upsertDocumentSource(tenantId: string): Promise<Source> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'external',
          name: DocumentIngestAdapter.DEFAULT_SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'external',
          name: DocumentIngestAdapter.DEFAULT_SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        },
      });
    } catch {
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'external',
            name: DocumentIngestAdapter.DEFAULT_SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw new Error(
        'DocumentIngestAdapter: не удалось upsert Source для документов',
      );
    }
  }
}
