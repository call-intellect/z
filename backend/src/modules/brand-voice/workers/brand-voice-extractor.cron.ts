import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BrandVoiceExtractorService } from '../services/brand-voice-extractor.service';

@Injectable()
export class BrandVoiceExtractorCron {
  private readonly logger = new Logger(BrandVoiceExtractorCron.name);

  constructor(
    @Inject(BrandVoiceExtractorService)
    private readonly extractor: BrandVoiceExtractorService,
  ) {}

  @Cron('0 8 * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.extractor.runForAllTenants();
      this.logger.debug(stats, 'brand-voice-extractor.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'brand-voice-extractor.cron: непойманная ошибка',
      );
    }
  }
}
