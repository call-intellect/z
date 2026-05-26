import { Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { RetentionExtrasCron } from './retention-extras.cron';
import { RetentionPolicyController } from './retention-policy.controller';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionCron } from './retention.cron';
import { RetentionService } from './retention.service';

/**
 * Retention-модуль. Не глобальный — используется только своими cron'ами.
 * Зависимости (`PrismaService`, `S3Service`, `BusinessMetricsService`,
 * `TypedConfigService`) — все глобальные.
 *
 * Cron'ы:
 *   - `RetentionCron` — Recording.expiresAt (M2/recording) + Фаза 11
 *      processAll (RawEvent / IdeaBlock(archived) / ChatMessage / AuditLog).
 *   - `RetentionExtrasCron` — WebhookDelivery / Export / ShareView /
 *      ApiAccessLog / AuditLog / Meeting.deletedAt / User.deletedAt (M3c).
 *
 * Сервисы:
 *   - `RetentionService` — оркестратор processExpired() / processAll().
 *   - `RetentionPolicyService` — getOrInit/update для `OrgRetentionPolicy`.
 */
@Module({
  controllers: [RetentionPolicyController],
  providers: [
    RetentionService,
    RetentionPolicyService,
    RetentionCron,
    RetentionExtrasCron,
    S3Service,
  ],
  exports: [RetentionService, RetentionPolicyService],
})
export class RetentionModule {}
