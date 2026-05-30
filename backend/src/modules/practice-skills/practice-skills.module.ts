import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { AdminPracticeSkillsController } from './controllers/admin-practice-skills.controller';
import { PracticeSkillEvaluatorService } from './services/practice-skill-evaluator.service';
import { PracticeSkillExtractorService } from './services/practice-skill-extractor.service';
import { PracticeSkillRetrievalService } from './services/practice-skill-retrieval.service';
import { PracticeSkillEvaluateCron } from './workers/practice-skill-evaluate.cron';
import { PracticeSkillExtractWorker } from './workers/practice-skill-extract.worker';

/**
 * Agents v2 Фаза C1 (2026-05-30) — PracticeSkills (выполняемые навыки клонов).
 *
 * Содержит:
 *   - `PracticeSkillExtractorService` — concept + traits + reasoning-блоки →
 *     draft PracticeSkill через LLM.
 *   - `PracticeSkillRetrievalService` — KNN retrieval skill'ов для clone-respond.
 *   - `PracticeSkillEvaluatorService` — composite score vs baseline → promote/archive.
 *   - `PracticeSkillExtractWorker` — слушает событие `skill-trait-concept.normalized`
 *     и параллельно (concurrency=2) обрабатывает концепты через extractor.
 *   - `PracticeSkillEvaluateCron` — `@Cron('0 4 * * *')` — daily evaluator с
 *     обновлением gauge'ов.
 *   - `AdminPracticeSkillsController` — REST `/api/v1/admin/practice-skills/*`.
 *
 * Зависимости (через @Global):
 *   - PrismaService, TypedConfigService, BusinessMetricsService, RedisService.
 *   - @Global AiModule (LlmRouterService).
 *   - @Global KnowledgeCoreModule (KnowledgeEmbeddingService).
 *   - @Global EventEmitterModule (для @OnEvent).
 *   - @Global AuthModule (CookieAuthGuard / TenantGuard / OrgAdminGuard).
 *
 * Регистрировать в `AppModule` ПОСЛЕ KnowledgeCoreModule, AiModule, AuthModule.
 *
 * Экспортируем `PracticeSkillRetrievalService` — он нужен `ClonesService` для
 * подмешивания skill'ов в clone-respond. Остальные сервисы — internal.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminPracticeSkillsController],
  providers: [
    PracticeSkillExtractorService,
    PracticeSkillRetrievalService,
    PracticeSkillEvaluatorService,
    PracticeSkillExtractWorker,
    PracticeSkillEvaluateCron,
  ],
  exports: [PracticeSkillRetrievalService],
})
export class PracticeSkillsModule {}
