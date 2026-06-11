import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { QualityScoreController } from './quality-score.controller';
import { QualityScoreService } from './quality-score.service';

/**
 * Модуль HTTP-side для quality-score (Фаза C §7).
 *
 * Качество встречи считает ЕДИНЫЙ воркер `meeting-report-fast` (core-очередь)
 * и пишет в MeetingQualityScore. Здесь — только эндпоинты чтения / регенерации /
 * org-настроек / org-агрегата.
 *
 * Зависимости через @Global модули:
 *   - PrismaService / RedisService / BusinessMetricsService — auto-imported.
 *   - CoreQueueService — из @Global CoreQueueModule (enqueue регенерации
 *     meeting-report-fast).
 */
@Module({
  imports: [AuthModule],
  controllers: [QualityScoreController],
  providers: [QualityScoreService],
  exports: [QualityScoreService],
})
export class QualityScoreModule {}
