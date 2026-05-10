import { Global, Module } from '@nestjs/common';

import { CoreQueueService } from './core-queue.service';

/**
 * Глобальный модуль knowledge-core очередей.
 *
 *   - `CoreQueueService` — диспетчер для `core.raw-events` (используется
 *     `IngestService`).
 *
 * Воркеры (`block-ingest.worker`, Фаза 2) — отдельный `WorkersModule` /
 * процесс. На Фазе 1 нет ни одного консумера.
 *
 * RedisModule — глобальный, не нужно импортировать.
 */
@Global()
@Module({
  providers: [CoreQueueService],
  exports: [CoreQueueService],
})
export class CoreQueueModule {}
