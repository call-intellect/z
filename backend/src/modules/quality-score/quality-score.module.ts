import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { QualityScoreController } from './quality-score.controller';
import { QualityScoreService } from './quality-score.service';

/**
 * Модуль HTTP-side для quality-score (Фаза C §7).
 *
 * Воркер `ai.quality-score` живёт в WorkersModule + AiModule (PromptResolver,
 * LlmRouter). Здесь — только эндпоинты чтения / регенерации / org-настроек /
 * org-агрегата.
 *
 * Зависимости через @Global модули:
 *   - PrismaService / RedisService / BusinessMetricsService — auto-imported.
 *   - AiQueueService — из AiModule (enqueue регенерации).
 */
@Module({
  imports: [AuthModule],
  controllers: [QualityScoreController],
  providers: [QualityScoreService],
  exports: [QualityScoreService],
})
export class QualityScoreModule {}
