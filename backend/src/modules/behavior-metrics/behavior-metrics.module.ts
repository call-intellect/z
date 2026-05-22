import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { BehaviorMetricsController } from './behavior-metrics.controller';
import { BehaviorMetricsService } from './behavior-metrics.service';

/**
 * Модуль HTTP-side для behavior-metrics (Фаза B §8).
 *
 * Воркер `ai.behavior-metrics` живёт в WorkersModule + AiModule (calculator
 * и refine), здесь — только эндпоинты чтения.
 */
@Module({
  imports: [AuthModule],
  controllers: [BehaviorMetricsController],
  providers: [BehaviorMetricsService],
  exports: [BehaviorMetricsService],
})
export class BehaviorMetricsModule {}
