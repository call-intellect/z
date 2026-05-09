import { Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { RetentionExtrasCron } from './retention-extras.cron';
import { RetentionCron } from './retention.cron';
import { RetentionService } from './retention.service';

/**
 * Retention-модуль. Не глобальный — используется только своими cron'ами.
 * Зависимости (`PrismaService`, `S3Service`, `BusinessMetricsService`,
 * `TypedConfigService`) — все глобальные.
 *
 * Cron'ы:
 *   - `RetentionCron` — Recording.expiresAt (M2/recording).
 *   - `RetentionExtrasCron` — WebhookDelivery / Export / ShareView /
 *      ApiAccessLog / AuditLog / Meeting.deletedAt / User.deletedAt (M3c).
 */
@Module({
  providers: [RetentionService, RetentionCron, RetentionExtrasCron, S3Service],
  exports: [RetentionService],
})
export class RetentionModule {}
