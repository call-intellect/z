import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { AdminPromptEvolutionController } from './controllers/admin-prompt-evolution.controller';
import { AutoRuleExtractorService } from './services/autorule-extractor.service';
import { GepaRunnerService } from './services/gepa-runner.service';
import { PromptFeedbackCollectorService } from './services/prompt-feedback-collector.service';
import { RuleInjectorService } from './services/rule-injector.service';
import { AutoRuleExtractCron } from './workers/autorule-extract.cron';
import { GepaAbMonitorCron } from './workers/gepa-ab-monitor.cron';
import { GepaOptimizeCron } from './workers/gepa-optimize.cron';
import { GepaPromoteCron } from './workers/gepa-promote.cron';

/**
 * Agents v2 Фаза B1 + C2 (2026-05-30) — Prompt Evolution.
 *
 * Фаза B1 (AutoRule, shadow):
 *   - `PromptFeedbackCollectorService` — слушает `ai.invocation.completed`/
 *     `ai.invocation.edited` и пишет в `PromptFeedback`.
 *   - `AutoRuleExtractorService` — ежедневный extractor правил из feedback.
 *   - `RuleInjectorService` — заготовка для Фазы C (вернёт пустой массив).
 *   - `AutoRuleExtractCron` — `@Cron('0 3 * * *')`.
 *   - `AdminPromptEvolutionController` — REST API для админа.
 *
 * Фаза C2 (GEPA prompt evolution):
 *   - `GepaRunnerService` — оркестратор Python subprocess `runner.py`.
 *   - `GepaOptimizeCron` — `@Cron('0 4 * * 0')` (weekly Sun 04:00).
 *   - `GepaPromoteCron` — `@Cron('0 5 * * 0')` (weekly Sun 05:00).
 *   - `GepaAbMonitorCron` — `@Cron('*\/15 * * * *')` (каждые 15 минут).
 *
 * Зависимости:
 *   - @Global AiModule (`LlmRouterService`)
 *   - @Global EmbeddingsModule (`EmbeddingFallbackService`)
 *   - @Global RedisModule, PrismaModule, MetricsModule, ConfigModule
 *   - @Global EventEmitterModule (для @OnEvent)
 *   - AuthModule (для CookieAuthGuard / TenantGuard / OrgAdminGuard)
 *
 * Регистрировать в `AppModule` ПОСЛЕ AiModule и AuthModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminPromptEvolutionController],
  providers: [
    PromptFeedbackCollectorService,
    AutoRuleExtractorService,
    RuleInjectorService,
    AutoRuleExtractCron,
    // ── Agents v2 Фаза C2 — GEPA ──
    GepaRunnerService,
    GepaOptimizeCron,
    GepaPromoteCron,
    GepaAbMonitorCron,
  ],
  exports: [RuleInjectorService, GepaRunnerService],
})
export class PromptEvolutionModule {}
