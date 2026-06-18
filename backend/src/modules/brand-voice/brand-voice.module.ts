import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { BrandVoiceController } from './controllers/brand-voice.controller';
import { DocumentUseCasesController } from './controllers/document-use-cases.controller';
import { BrandVoiceExtractorService } from './services/brand-voice-extractor.service';
import { BrandVoiceService } from './services/brand-voice.service';
import { BrandVoiceExtractorCron } from './workers/brand-voice-extractor.cron';

@Module({
  imports: [PrismaModule],
  controllers: [BrandVoiceController, DocumentUseCasesController],
  providers: [BrandVoiceService, BrandVoiceExtractorService, BrandVoiceExtractorCron],
  exports: [BrandVoiceService, BrandVoiceExtractorService],
})
export class BrandVoiceModule {}
