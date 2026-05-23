import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { KpiController } from './kpi.controller';
import { KpiService } from './services/kpi.service';

/**
 * SBA α-8 wave 3 — KpiModule.
 *
 * KPI = Metric с заполненным `attachedTo*Id` (Role / Department /
 * ResponsibilityElement). Подмножество таблицы `metrics`, не отдельная
 * сущность. Подмодуль предоставляет CRUD + atomic measurement endpoint.
 *
 * Зависимости:
 *   - @Global Prisma, Rbac, Auth, Audit, Metrics.
 */
@Module({
  imports: [PrismaModule],
  controllers: [KpiController],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
