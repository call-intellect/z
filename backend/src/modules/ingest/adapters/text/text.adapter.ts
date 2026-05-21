import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Source } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type DumpCreatedJobData,
} from '../../../core-queue/queues';
import { IngestService } from '../../ingest.service';

/**
 * `TextIngestAdapter` (Фаза 0b knowledge-core).
 *
 * BullMQ-consumer очереди `core.dump-created`. Принимает уже готовый текст
 * (Document.kind='text', status='parsed') и без парсинга:
 *
 *   1. Идентифицирует Document по id (skip — если не найден).
 *   2. lazy-upsert дефолтного Source `(type='web_form', name='Дамп мысли')` —
 *      переиспользуем тот же Source, что и legacy /ingest/dump.
 *   3. Создаёт RawEvent через `IngestService.ingest(...)` с
 *      `sourceExternalId = doc:<documentId>`. IngestService сам публикует
 *      `core.raw-events` для дальнейшего knowledge-core pipeline.
 *
 * NB: дублирование с legacy `DumpService.createDump` (он тоже публикует
 * `core.raw-events` через `IngestService.ingest`) намеренно не делаем —
 * `DumpService` теперь не дёргает `IngestService` сам, а просто публикует
 * `dump.created` и доверяет этому воркеру (см. dump.service.ts).
 */
@Injectable()
export class TextIngestAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TextIngestAdapter.name);
  private worker: Worker<DumpCreatedJobData> | null = null;

  /** Канонический name Source'а для дампов (как у legacy DumpService). */
  static readonly DUMP_SOURCE_NAME = 'Дамп мысли';

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DumpCreatedJobData>(
      CORE_QUEUE_NAMES.DUMP_CREATED,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        // Дампы лёгкие — текст уже в payload, парсинга нет, единственный
        // тяжёлый шаг — INSERT RawEvent. 4 одновременно — с запасом.
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        {
          jobId: job?.id,
          documentId: (job?.data as DumpCreatedJobData | undefined)?.documentId,
          err: err.message,
        },
        'dump-created: job failed',
      );
    });
    this.logger.log(
      `TextIngestAdapter worker started (${CORE_QUEUE_NAMES.DUMP_CREATED})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async process(job: Job<DumpCreatedJobData>): Promise<void> {
    const { documentId, tenantId, content, uploaderPersonId } = job.data;

    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) {
      this.logger.warn(
        { documentId, jobId: job.id },
        'dump-created: Document не найден — skip',
      );
      return;
    }
    if (doc.tenantId !== tenantId) {
      this.logger.warn(
        { documentId, jobTenantId: tenantId, docTenantId: doc.tenantId },
        'dump-created: tenant mismatch — skip',
      );
      return;
    }

    const source = await this.upsertDumpSource(tenantId);
    const result = await this.ingest.ingest({
      tenantId,
      sourceId: source.id,
      sourceExternalId: `doc:${doc.id}`,
      occurredAt: doc.createdAt,
      payload: {
        documentId: doc.id,
        kind: doc.kind,
        name: doc.name,
        uploaderId: uploaderPersonId,
        parsedText: content,
      },
      dataClass: source.dataClass,
    });
    this.logger.log(
      {
        documentId,
        rawEventId: result.rawEvent.id,
        idempotent: result.idempotent,
        textLength: content.length,
      },
      'dump-created: RawEvent создан',
    );
  }

  /**
   * lazy-upsert Source(type='web_form', name='Дамп мысли') — единый для
   * legacy /ingest/dump и нового /api/v1/documents/text (через text.adapter).
   */
  private async upsertDumpSource(tenantId: string): Promise<Source> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'web_form',
          name: TextIngestAdapter.DUMP_SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'web_form',
          name: TextIngestAdapter.DUMP_SOURCE_NAME,
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
            name: TextIngestAdapter.DUMP_SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw new Error(
        'TextIngestAdapter: не удалось upsert web_form Source',
      );
    }
  }
}
