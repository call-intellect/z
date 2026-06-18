import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Document, type SignalType, type Source } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';
import { CoreQueueService } from '../../../core-queue/core-queue.service';
import { CORE_QUEUE_NAMES, type DocumentUploadedJobData } from '../../../core-queue/queues';
import { DocumentAttributionService } from '../../../documents/document-attribution.service';
import { SIGNAL_TYPE_VALUES } from '../../../knowledge-core/prompts/block-ingest.prompt';
import { S3Service } from '../../../recordings/s3.service';
import { IngestService } from '../../ingest.service';
import {
  DocumentParseFailedError,
  ParseSizeError,
  ParseTimeoutError,
} from '../../parsers/document-parser.errors';
import { DocumentParserService } from '../../parsers/document-parser.service';

/**
 * Ф6 (knowledge-base-redesign) — детерминированный маппинг ручного `docType`
 * документа в `signalTypeHint` для block-ingest. Пользователь пометил тип при
 * загрузке → карточка нужного типа, не на усмотрение LLM. Возвращает undefined
 * для типов без прямого соответствия (job_description/other/null) — тогда тип
 * решает LLM, как раньше. Защита: только значения из SIGNAL_TYPE_VALUES.
 *
 * Маппинг идёт в РЕАЛЬНЫЙ Prisma enum `SignalType`, где орг-документов всего
 * два типа: `regulation` и `process_step` (оба роутятся в `3-1-regulations`,
 * см. router.service.ts:28). Финальный ТИП карточки (regulation / policy /
 * instruction) решает экстрактор по полю `kind` ВНУТРИ Specialist 3.1 — задача
 * hint'а лишь гарантировать, что документ дойдёт до этого специалиста, а не
 * будет классифицирован LLM как idea/decision и потерян для базы знаний:
 *   - docType 'regulation'  → 'regulation'    (kind=regulation/standard);
 *   - docType 'policy'      → 'regulation'    ('policy' НЕ отдельный signalType
 *       в enum — policy-блоки исторически идут через 'regulation';
 *       processRegulationBlock при draft.kind='policy' зовёт upsertPolicy →
 *       Policy-карточка; см. specialist-3-1-regulations.service.ts:150,193);
 *   - docType 'process'     → 'process_step'  (kind=process);
 *   - docType 'instruction' → 'process_step'  (kind=instruction по single-role);
 *   - job_description / other / null → undefined (тип решает LLM, как раньше).
 *
 * NB: `SIGNAL_TYPE_VALUES` (массив-валидатор) содержит лишний `'policy'`,
 * рассинхронизированный с enum `SignalType` (латентный баг вне scope ТЗ) —
 * поэтому таргет типизирован реальным `SignalType`, а guard
 * `includes(SIGNAL_TYPE_VALUES)` оставлен как доп. защита.
 */
export function docTypeToSignalTypeHint(
  docType: string | null | undefined,
): SignalType | undefined {
  if (!docType) return undefined;
  const map: Record<string, SignalType> = {
    regulation: 'regulation',
    policy: 'regulation',
    process: 'process_step',
    instruction: 'process_step',
  };
  const hint = map[docType];
  if (!hint) return undefined;
  return (SIGNAL_TYPE_VALUES as readonly string[]).includes(hint)
    ? hint
    : undefined;
}

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

  static readonly DEFAULT_SOURCE_NAME = 'Документы';

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(DocumentParserService)
    private readonly parser: DocumentParserService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(DocumentAttributionService)
    private readonly attribution: DocumentAttributionService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DocumentUploadedJobData>(
      CORE_QUEUE_NAMES.DOCUMENT_UPLOADED,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
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
    this.logger.log(`DocumentIngestAdapter worker started (${CORE_QUEUE_NAMES.DOCUMENT_UPLOADED})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

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

    const fence = await this.prisma.document.updateMany({
      where: { id: documentId, status: 'uploaded' },
      data: { status: 'parsing' },
    });
    if (fence.count === 0) {
      this.logger.debug({ documentId }, 'document-uploaded: lost status race — skip');
      return;
    }

    try {
      const buffer = await this.loadContent(doc);
      const parsed = await this.parser.parse({
        kind: doc.kind,
        content: buffer,
        mimeType: doc.mimeType,
      });

      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          parsedText: parsed.text,
          status: 'parsed',
        },
      });

      const source = await this.upsertDocumentSource(tenantId);

      const signalTypeHint = docTypeToSignalTypeHint(doc.docType);
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
          attachedThemeId: doc.attachedThemeId,
          docType: doc.docType,
          // Ф6 — block-ingest применит override типа карточки, если задано.
          ...(signalTypeHint ? { signalTypeHint } : {}),
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

      if (doc.docType === null && doc.attachedThemeId === null) {
        await this.attribution.suggestForDocument({ documentId, tenantId });
      }
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
      throw err;
    }
  }

  private async loadContent(doc: Document): Promise<Buffer> {
    if (doc.inlineContent) {
      return Buffer.from(doc.inlineContent);
    }
    if (doc.s3Key) {
      return this.s3.getObject(doc.s3Key);
    }
    throw new DocumentParseFailedError('Document не содержит ни inlineContent, ни s3Key');
  }

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
      throw new Error('DocumentIngestAdapter: не удалось upsert Source для документов');
    }
  }
}
