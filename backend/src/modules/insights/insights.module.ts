import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { InsightsController } from './insights.controller';
import { InsightsService } from './services/insights.service';

/**
 * InsightsModule (SBA β-4).
 *
 * REST API `/api/v1/insights` — реестр повторяющихся сигналов компании
 * (проблемы / риски / блокеры / неэффективности). Под капотом — Prisma-таблица
 * `insights`.
 *
 * Зависимости:
 *   - PrismaModule — модель Insight + CardVersion (для writeCardVersion).
 *   - RbacModule (Global) — для requireRead / requireWrite в контроллере.
 *
 * Все user-facing строки на русском. RBAC — `insight` ResourceType
 * (см. policy.csv).
 */
@Module({
  imports: [PrismaModule],
  controllers: [InsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
