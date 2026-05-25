import { Module } from '@nestjs/common';

import { ConciergeAnalyticsController } from './concierge-analytics.controller';
import { ConciergeAnalyticsService } from './concierge-analytics.service';
import { KnowledgeAnalyticsController } from './knowledge-analytics.controller';
import { KnowledgeAnalyticsService } from './knowledge-analytics.service';

/**
 * Admin-redesign Фаза 2 — `AnalyticsModule`.
 *
 * Общий модуль для read-only аналитики Z-Admin:
 *  - Knowledge analytics (`/admin/analytics/knowledge/*`)
 *  - Concierge analytics (`/admin/analytics/concierge/*`)
 *
 * Импортируется `AdminModule`. Зависит только от глобального
 * `PrismaService`. Никакого write-API не предоставляет — только GET.
 *
 * Существующий `/admin/usage/*` (Z-Admin Phase 8.2) НЕ перенаправляется и
 * не дублируется — Фаза 2 просто добавляет новые разделы, не ломая обратную
 * совместимость.
 */
@Module({
  controllers: [
    KnowledgeAnalyticsController,
    ConciergeAnalyticsController,
  ],
  providers: [KnowledgeAnalyticsService, ConciergeAnalyticsService],
  exports: [KnowledgeAnalyticsService, ConciergeAnalyticsService],
})
export class AnalyticsModule {}
