import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';

import { DecisionsController } from './decisions.controller';
import { DecisionsService } from './services/decisions.service';

/**
 * DecisionsModule (SBA β-3).
 *
 * REST API `/api/v1/decisions` — реестр решений компании. Под капотом —
 * Prisma-таблица `decisions` (расширенная in-place из Фазы 0a).
 *
 * Зависимости:
 *   - PrismaModule — модель Decision + CardVersion (history).
 *   - CurationModule — CurationService.triage (manual create), ConflictService
 *     (supersede через evolving).
 *   - RbacModule (Global) — для requireRead/requireWrite в контроллере.
 *
 * Все user-facing строки на русском. RBAC — `decision` ResourceType (см.
 * policy.csv).
 */
@Module({
  imports: [PrismaModule, CurationModule],
  controllers: [DecisionsController],
  providers: [DecisionsService],
  exports: [DecisionsService],
})
export class DecisionsModule {}
