import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { CurationController } from './curation.controller';
import { ConflictService } from './services/conflict.service';
import { CurationService } from './services/curation.service';
import { CuratorRoutingService } from './services/curator-routing.service';
import { CardStaleDetectorCron } from './workers/card-stale-detector.cron';

/**
 * CurationModule (SBA α-4 — Layer 4 Curation Foundation).
 *
 * Зависимости:
 *   - PrismaModule — модели CurationItem / CurationDecision / ConflictItem /
 *     CardVersion / CuratorAssignment.
 *   - ConversationalModule (@Global) — отправка probe-нотификаций кураторам.
 *   - RbacModule (@Global) — RBAC-проверки в контроллере.
 *   - BusinessMetricsService (@Global через MetricsModule).
 *
 * Экспортирует CurationService и ConflictService — публичный API для
 * специалистов Слоя 3 (вызывают triage / report).
 */
@Module({
  imports: [PrismaModule],
  controllers: [CurationController],
  providers: [
    CurationService,
    ConflictService,
    CuratorRoutingService,
    CardStaleDetectorCron,
  ],
  exports: [CurationService, ConflictService, CuratorRoutingService],
})
export class CurationModule {}
