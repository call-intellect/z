import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type DocumentImportJobData,
} from '../core-queue/queues';

import { DocumentImportService } from './document-import.service';

/**
 * `DocumentImportWorker` (ТЗ-4 Ф7 — массовый импорт ZIP).
 *
 * BullMQ-consumer очереди `core.document-import`. По `{ importId }` делегирует
 * в `DocumentImportService.processImport`, который распаковывает ZIP и создаёт
 * Document'ы. Идемпотентность — status-guard внутри `processImport`
 * (`pending → processing`), так что повторный job того же `docimport_<id>`
 * после первого прогона — no-op.
 *
 * Регистрируется как provider в `WorkersModule` (in-process воркеры), Worker
 * создаётся в `onModuleInit`. concurrency=1: распаковка + per-file create —
 * IO-heavy, но один батч за раз держит память под контролем (весь архив в RAM).
 */
@Injectable()
export class DocumentImportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentImportWorker.name);
  private worker: Worker<DocumentImportJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(DocumentImportService)
    private readonly importer: DocumentImportService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DocumentImportJobData>(
      CORE_QUEUE_NAMES.DOCUMENT_IMPORT,
      async (job: Job<DocumentImportJobData>) => {
        await this.importer.processImport(job.data.importId);
      },
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `core.document-import job ${job?.id ?? '?'} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    this.logger.log(
      `DocumentImportWorker запущен (${CORE_QUEUE_NAMES.DOCUMENT_IMPORT})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
