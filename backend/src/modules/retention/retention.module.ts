import { Module } from '@nestjs/common';

import { RetentionCron } from './retention.cron';
import { RetentionService } from './retention.service';

/**
 * Retention-модуль. Не глобальный — используется только своим cron'ом.
 * Зависимости (`PrismaService`, `S3Service`, `BusinessMetricsService`,
 * `TypedConfigService`) — все глобальные.
 */
@Module({
  providers: [RetentionService, RetentionCron],
  exports: [RetentionService],
})
export class RetentionModule {}
