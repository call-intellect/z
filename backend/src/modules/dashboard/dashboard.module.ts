import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { DirectorDashboardController } from './director-dashboard.controller';
import { DirectorDashboardService } from './services/director-dashboard.service';

/**
 * DashboardModule (Фаза 8 knowledge-core).
 *
 * Содержит директорский дашборд (`GET /api/v1/dashboard/director`).
 * Менеджерский дашборд (фронт `/dashboard` для `manager`-ролей) использует
 * существующие endpoint'ы Meetings/Tasks — отдельной backend-логики не требует.
 *
 * Зависимости:
 *   - PrismaModule (Global) — БД-запросы.
 *   - AdminModule (Global, экспортирует AdminCacheService) — кэш TTL 60s.
 *   - RbacModule (Global) — `RbacService.canViewDirectorDashboard`.
 *   - AiModule (Global) — `LlmRouterService` для `narrativeSummary` (шаг 2 ТЗ).
 *
 * Все три зависимости — `@Global()`, явный `imports` нужен только для PrismaModule
 * для ясности. AdminModule / RbacModule / AiModule подняты в AppModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DirectorDashboardController],
  providers: [DirectorDashboardService],
})
export class DashboardModule {}
