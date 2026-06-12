import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { ProbeDigestCron } from './probe-digest.cron';
import { ProbeDispatcherWorker } from './probe-dispatcher.worker';
import { ProbePriorityCron } from './probe-priority.cron';
import { ProbeResponseHandler } from './probe-response.handler';
import { ProbeController } from './probe.controller';
import { ProbeService } from './probe.service';

/**
 * SBA β-5 — Layer 6 (Probe-Agent).
 *
 * Глобальный модуль (`@Global`), чтобы любой специалист Слоя 3 мог
 * инжектить `ProbeService.suggest(...)` без повторного импорта.
 *
 * Воркер (`ProbeDispatcherWorker`) поднимается IN-PROCESS (как
 * `ConversationalSendWorker` из α-1). `ProbePriorityCron` тоже здесь —
 * не в отдельном worker-процессе.
 *
 * Зависимости (через @Global):
 *   - PrismaService, RedisService, TypedConfigService, BusinessMetricsService.
 *   - LlmRouterService — из AiModule (@Global).
 *   - ConversationalService — из ConversationalModule (@Global).
 *   - CoreQueueService — из CoreQueueModule (@Global).
 *
 * Регистрировать в AppModule ПОСЛЕ ConversationalModule, AiModule,
 * CoreQueueModule, WorkersModule (engagement_rate cron читает Notification из БД).
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ProbeController],
  providers: [
    ProbeService,
    ProbeDispatcherWorker,
    ProbePriorityCron,
    ProbeDigestCron,
    ProbeResponseHandler,
  ],
  exports: [ProbeService],
})
export class ProbeModule {}
