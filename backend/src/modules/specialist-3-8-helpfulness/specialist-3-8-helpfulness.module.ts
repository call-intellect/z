import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { ProbeModule } from '../probe/probe.module';
import { RbacModule } from '../rbac/rbac.module';

import { HelpfulnessAdminController } from './controllers/helpfulness-admin.controller';
import { HelpfulnessController } from './controllers/helpfulness.controller';
import { HelpfulnessProbeCron } from './cron/helpfulness-probe.cron';
import { HelpfulnessSpotlightCron } from './cron/helpfulness-spotlight.cron';
import { HelpfulnessTraitDecayCron } from './cron/helpfulness-trait-decay.cron';
import { SocialContributionProfileCron } from './cron/social-contribution-profile.cron';
import { HelpfulnessApiService } from './services/helpfulness-api.service';
import { Specialist38HelpfulnessService } from './services/specialist-3-8-helpfulness.service';
import { Specialist38ProbeService } from './services/specialist-3-8-probe.service';
import { Specialist38HelpfulnessWorker } from './workers/specialist-3-8-helpfulness.worker';

/**
 * SBA Wave 2 — Specialist 3.8 (Helpfulness Agent) module.
 *
 * Контракт:
 *   - @Global() — чтобы worker'ы и cron'ы могли инжектить сервис без явного
 *     import'а; контроллеры тоже доступны (если AppModule подключит).
 *   - Зависимости:
 *     - PrismaModule (common, обычно глобален).
 *     - ProbeModule — для probe-trigger'ов.
 *     - RbacModule — для контроллеров.
 *     - LlmRouterService (AiModule), KnowledgeEmbeddingService
 *       (KnowledgeCoreModule) — глобальные.
 *
 * AppModule должен подключить этот модуль (см. README модуля и отчёт).
 *
 * TODO (sub-ТЗ §«Privacy & Ethics»):
 *   - Эндпоинт `/api/v1/me/settings/privacy` (opt-out) — Sprint 4.
 *   - Frontend: 4 страницы + 3 виджета — отдельный фронт-агент.
 *   - Seed LLM task routes для 3-х новых taskType — patch script отдельно.
 */
@Global()
@Module({
  imports: [PrismaModule, ProbeModule, RbacModule],
  controllers: [HelpfulnessController, HelpfulnessAdminController],
  providers: [
    Specialist38HelpfulnessService,
    Specialist38ProbeService,
    HelpfulnessApiService,
    Specialist38HelpfulnessWorker,
    SocialContributionProfileCron,
    HelpfulnessSpotlightCron,
    HelpfulnessTraitDecayCron,
    HelpfulnessProbeCron,
  ],
  exports: [
    Specialist38HelpfulnessService,
    Specialist38ProbeService,
    HelpfulnessApiService,
  ],
})
export class Specialist38HelpfulnessModule {}
