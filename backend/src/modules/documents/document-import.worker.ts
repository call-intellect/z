import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';
import { CORE_QUEUE_NAMES, type DocumentImportJobData } from '../core-queue/queues';

import { DocumentImportService } from './document-import.service';

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
        const { importId, confluence } = job.data;
        if (confluence) {
          const apiToken = this.importer.decryptConfluenceToken(confluence.encryptedToken);
          await this.importer.processImport(importId, {
            baseUrl: confluence.baseUrl,
            email: confluence.email,
            spaceKey: confluence.spaceKey,
            apiToken,
          });
          return;
        }
        await this.importer.processImport(importId);
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
    this.logger.debug(`DocumentImportWorker запущен (${CORE_QUEUE_NAMES.DOCUMENT_IMPORT})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
