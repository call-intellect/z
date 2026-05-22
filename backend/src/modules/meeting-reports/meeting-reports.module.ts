import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { MeetingReportsController } from './meeting-reports.controller';
import { MeetingReportsService } from './meeting-reports.service';

/**
 * Модуль HTTP-side для Фазы E §7 — несколько AI-отчётов на одну встречу.
 *
 * Воркер `ai.custom-report` живёт в `WorkersModule`. Здесь — только CRUD-эндпоинты.
 *
 * Зависимости через @Global модули:
 *   - PrismaService / RedisService / BusinessMetricsService — auto-imported.
 *   - AiQueueService — из @Global AiModule (enqueue в `ai.custom-report`).
 *   - EntitlementService — из @Global EntitlementsModule (gate по тарифу).
 */
@Module({
  imports: [AuthModule],
  controllers: [MeetingReportsController],
  providers: [MeetingReportsService],
  exports: [MeetingReportsService],
})
export class MeetingReportsModule {}
