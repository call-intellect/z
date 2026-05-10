import { Global, Module } from '@nestjs/common';

import { CoreQueueService } from './core-queue.service';
import { WorkerOrgGate } from './worker-org-gate';

/**
 * Глобальный модуль knowledge-core очередей.
 *
 *   - `CoreQueueService` — диспетчер для `core.raw-events` (используется
 *     `IngestService`).
 *   - `WorkerOrgGate` (Фаза 7) — общий хелпер для воркеров: проверяет
 *     `Org.workersEnabled[workerName]` в начале каждого job'а.
 *
 * Воркеры (`block-ingest.worker`, Фаза 2+) — отдельный `WorkersModule`/процесс.
 *
 * RedisModule — глобальный, не нужно импортировать.
 */
@Global()
@Module({
  providers: [CoreQueueService, WorkerOrgGate],
  exports: [CoreQueueService, WorkerOrgGate],
})
export class CoreQueueModule {}
