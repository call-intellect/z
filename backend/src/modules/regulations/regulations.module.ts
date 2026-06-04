import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';

import { RegulationsController } from './regulations.controller';
import { RegulationsService } from './services/regulations.service';

/**
 * RegulationsModule (SBA α-7).
 *
 * REST API `/api/v1/regulations` — единый список Regulation / Process / Policy
 * (с фильтром `kind`). Под капотом — 3 отдельные Prisma-таблицы, расширенные
 * in-place из Phase 0b (см. план α-7, решение по §14.1, §14.3).
 *
 * Все user-facing строки на русском. RBAC — `regulation` / `process` /
 * `policy` ResourceType (см. policy.csv).
 */
@Module({
  imports: [PrismaModule, CurationModule],
  controllers: [RegulationsController],
  providers: [RegulationsService],
  exports: [RegulationsService],
})
export class RegulationsModule {}
