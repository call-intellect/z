import { Global, Module } from '@nestjs/common';

import { AiQueueService } from './ai-queue.service';
import { AiUsageLogService } from './services/ai-usage-log.service';
import { RetryService } from './services/retry.service';

/**
 * Глобальный AI-модуль для HTTP-процесса.
 *
 *   - `AiQueueService` — диспетчер очередей (вызывается из webhook handler
 *     и `RetryService`).
 *   - `AiUsageLogService` — пишет AiUsageLog (нужен в HTTP-сценариях
 *     для admin-страниц / экспорта).
 *   - `RetryService` — endpoint `POST /api/v1/meetings/:id/retry-ai`.
 *
 * Воркеры (transcribe/merge/analyze/notify) живут в отдельном `WorkersModule`,
 * запускаются процессом `bun run worker:dev` (`workers/main.ts`). Это разделение
 * критично: HTTP-процесс может scale'ить горизонтально и не должен брать на
 * себя тяжёлые AI-jobs.
 */
@Global()
@Module({
  providers: [AiQueueService, AiUsageLogService, RetryService],
  exports: [AiQueueService, AiUsageLogService, RetryService],
})
export class AiModule {}
