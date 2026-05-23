import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { BrandVoiceController } from './controllers/brand-voice.controller';
import { DocumentUseCasesController } from './controllers/document-use-cases.controller';
import { BrandVoiceExtractorService } from './services/brand-voice-extractor.service';
import { BrandVoiceService } from './services/brand-voice.service';
import { BrandVoiceExtractorCron } from './workers/brand-voice-extractor.cron';

/**
 * SBA β-7 — Brand Voice Curator (Specialist 3.10).
 *
 * Объединяет:
 *   - BrandVoiceService — CRUD над BrandVoiceProfile + use-cases tagging.
 *   - BrandVoiceExtractorService — daily-cron logic (LLM-extraction профиля).
 *   - BrandVoiceExtractorCron — `@Cron('0 8 * * *')` обёртка.
 *   - BrandVoiceController — `/api/v1/brand-voice` (GET/PATCH/POST rebuild).
 *   - DocumentUseCasesController — `/api/v1/documents/:id/use-cases` (PATCH).
 *
 * Зависимости (через @Global): PrismaModule, RbacModule, AuthModule, AuditModule,
 * MetricsModule, AiModule (LlmRouterService), ScheduleModule.
 *
 * Экспортируем `BrandVoiceService`, чтобы chat-v2 SynthesisService мог
 * подмешивать BrandVoiceProfile в systemPrompt при mode='clone_style'
 * scope='org' (см. README/integration в `synthesis.service.ts`).
 */
@Module({
  imports: [PrismaModule],
  controllers: [BrandVoiceController, DocumentUseCasesController],
  providers: [
    BrandVoiceService,
    BrandVoiceExtractorService,
    BrandVoiceExtractorCron,
  ],
  exports: [BrandVoiceService, BrandVoiceExtractorService],
})
export class BrandVoiceModule {}
