import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { CompletenessController } from './completeness.controller';
import { CurationController } from './curation.controller';
import { ConflictService } from './services/conflict.service';
import { CurationService } from './services/curation.service';
import { CuratorRoutingService } from './services/curator-routing.service';
import { CardStaleDetectorCron } from './workers/card-stale-detector.cron';
import {
  CompletenessScannerCron,
  CompletenessScannerService,
} from './workers/completeness-scanner.cron';
import {
  ConsistencyCheckerCron,
  ConsistencyCheckerService,
} from './workers/consistency-checker.cron';

/**
 * CurationModule (SBA α-4 — Layer 4 Curation Foundation + wave 2).
 *
 * Зависимости:
 *   - PrismaModule — модели CurationItem / CurationDecision / ConflictItem /
 *     CardVersion / CuratorAssignment / CompletenessSlot.
 *   - ConversationalModule (@Global) — отправка probe-нотификаций кураторам.
 *   - RbacModule (@Global) — RBAC-проверки в контроллере.
 *   - BusinessMetricsService (@Global через MetricsModule).
 *   - ProbeModule (@Global) — ProbeService.suggest для consistency-violations
 *     (wave 2). Опционален: ConsistencyCheckerService инжектит ProbeService
 *     через `@Optional()` для unit-тестов.
 *   - RedisModule (@Global) — dedup-кеш для consistency-violations.
 *
 * Экспортирует CurationService и ConflictService — публичный API для
 * специалистов Слоя 3 (вызывают triage / report). Также экспортирует
 * CompletenessScannerService — для будущих специалистов и patch-скриптов.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CurationController, CompletenessController],
  providers: [
    CurationService,
    ConflictService,
    CuratorRoutingService,
    CardStaleDetectorCron,
    // ── SBA α-4 wave 2 ──
    CompletenessScannerService,
    CompletenessScannerCron,
    ConsistencyCheckerService,
    ConsistencyCheckerCron,
  ],
  exports: [
    CurationService,
    ConflictService,
    CuratorRoutingService,
    CompletenessScannerService,
  ],
})
export class CurationModule {}
