import { Global, Module } from '@nestjs/common';

import { QuotaService } from './quota.service';

/**
 * Глобальный модуль квот. Зависит от глобальных:
 *   - `RedisService` (атомарный INCR с TTL)
 *   - `PrismaService` (snapshot в `UserQuotaCounter`)
 *   - `AuditLogService` (запись `quota.exceeded`)
 *   - `BusinessMetricsService` (метрика `quota_exceeded_total`)
 */
@Global()
@Module({
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotasModule {}
