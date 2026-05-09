import { Module } from '@nestjs/common';

import { CrossmarkResultController } from './crossmark-result.controller';
import { CrossmarkResultService } from './crossmark-result.service';
import { CrossmarkUsageService } from './crossmark-usage.service';

/**
 * Модуль с дополнительными Crossmark-эндпоинтами (Phase 8.1):
 *   - GET /integrations/crossmark/v1/meetings/:id/result
 *   - GET /integrations/crossmark/v1/usage
 *
 * Базовые CRUD-эндпоинты (POST /meetings, GET/DELETE :id, recording-url,
 * extend-retention) живут в `MeetingsCrossmarkController` (Phase 2/4).
 *
 * Сервисы зависят только от глобальных модулей (Prisma, Auth, Metrics).
 */
@Module({
  controllers: [CrossmarkResultController],
  providers: [CrossmarkResultService, CrossmarkUsageService],
  exports: [CrossmarkResultService, CrossmarkUsageService],
})
export class CrossmarkModule {}
