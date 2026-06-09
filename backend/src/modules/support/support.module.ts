import { Module } from '@nestjs/common';

import { TrackerModule } from '../tracker/tracker.module';

import { SupportAdminController } from './controllers/support-admin.controller';
import { SupportClientController } from './controllers/support-client.controller';
import { SupportDeskController } from './controllers/support-desk.controller';
import { SupportCuratorCron } from './crons/support-curator.cron';
import { SupportSlaCron } from './crons/support-sla.cron';
import { SupportAccessGuard } from './guards/support-access.guard';
import { SupportAdminGuard } from './guards/support-admin.guard';
import { SupportAccessService } from './services/support-access.service';
import { SupportAnswerCriticService } from './services/support-answer-critic.service';
import { SupportCloneService } from './services/support-clone.service';
import { SupportContourService } from './services/support-contour.service';
import { SupportCuratorService } from './services/support-curator.service';
import { SupportDeskService } from './services/support-desk.service';
import { SupportEditClassifyService } from './services/support-edit-classify.service';
import { SupportIntakeService } from './services/support-intake.service';
import { SupportLearningService } from './services/support-learning.service';
import { SupportSlaService } from './services/support-sla.service';

/**
 * SupportModule — встроенная вендорская служба поддержки (ТЗ 2026-06-09
 * support-desk-clone, Ф1: человек отвечает, без клона/контура-изоляции).
 *
 * Зависимости:
 *   - TrackerModule — `ActivityRecorderService` (запись IssueActivity).
 *   - @Global модули (в imports не нужны): PrismaModule (PrismaService),
 *     ConfigModule (TypedConfigService), ConversationalModule
 *     (ConversationalService — дублирование сотруднику), EntitlementsModule
 *     (EntitlementService — гейт feature.support_desk), AuthModule
 *     (CookieAuthGuard), RbacModule (RbacService + KnowledgeAccessResolver),
 *     KnowledgeCoreModule (KnowledgeEmbeddingService — засев контура Ф2;
 *     ChatV2RetrievalService + ConfidenceCalibrationService — клон Ф3),
 *     AiModule (LlmRouterService — клон/critic Ф3; MultiAgentDebateService —
 *     дебат-гейт ночного куратора Ф4).
 *
 * SLA-cron и curator-cron поднимаются IN-PROCESS как провайдеры (отдельного
 * worker-процесса в Z нет).
 */
@Module({
  imports: [TrackerModule],
  controllers: [
    SupportClientController,
    SupportDeskController,
    SupportAdminController,
  ],
  providers: [
    SupportAccessService,
    SupportAccessGuard,
    SupportAdminGuard,
    SupportContourService,
    SupportIntakeService,
    SupportDeskService,
    SupportSlaService,
    SupportSlaCron,
    // Ф3 — клон поддержки: генератор черновика + critic обоснованности.
    // Инжектят @Global ChatV2RetrievalService + ConfidenceCalibrationService
    // (KnowledgeCoreModule) и LlmRouterService (AiModule) — без явных imports.
    SupportAnswerCriticService,
    SupportCloneService,
    // Ф3 — обучающая петля: классификатор типа правки + accept/reject/edit
    // → SupportDraftOutcome + LlmPreferenceSample + CSAT-гейт промоута в контур.
    SupportEditClassifyService,
    SupportLearningService,
    // Ф4 — ночной куратор контура: рефлексирующий агент наводит порядок в базе
    // (keep|promote|fix|merge|archive), destructive только за дебат-гейтом и
    // только мягко (soft-archive/merge). Инжектит @Global MultiAgentDebateService
    // (AiModule). Cron — in-process провайдер (отдельного worker-процесса нет).
    SupportCuratorService,
    SupportCuratorCron,
  ],
  exports: [SupportAccessService],
})
export class SupportModule {}
