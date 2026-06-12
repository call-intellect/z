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
import { ConflictArbiterCron } from './workers/conflict-arbiter.cron';
import {
  ConsistencyCheckerCron,
  ConsistencyCheckerService,
} from './workers/consistency-checker.cron';
import { CurationAutotuneCron } from './workers/curation-autotune.cron';
import { CurationItemLifecycleCron } from './workers/curation-item-lifecycle.cron';

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
 *   - AiModule (@Global) — MultiAgentDebateService для A1 «лестница доверия»
 *     (AI-судья провизорной канонизации критических карточек). CurationService
 *     инжектит его через @Optional(): в worker-процессе без AiModule зависимость
 *     null → критические карточки безопасно идут к человеку (deep), как раньше.
 *     Autonomy W1 (2026-06-12): тот же сервис нужен ConflictArbiterCron
 *     (ночной LLM-арбитр конфликтов), тоже через @Optional() — без AiModule
 *     конфликты остаются open.
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
    // ── Action Center B5 «оживление expiresAt» (2026-06-02) ──
    CurationItemLifecycleCron,
    // ── Action Center A2 «лестница доверия» (2026-06-02) ──
    CurationAutotuneCron,
    // ── Autonomy W1 «LLM-арбитр конфликтов» (2026-06-12) ──
    ConflictArbiterCron,
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
