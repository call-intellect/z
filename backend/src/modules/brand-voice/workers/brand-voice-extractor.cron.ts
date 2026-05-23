import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BrandVoiceExtractorService } from '../services/brand-voice-extractor.service';

/**
 * SBA β-7 — BrandVoiceExtractorCron.
 *
 * Раз в сутки (08:00 UTC) пересобирает BrandVoiceProfile для всех тенантов.
 * Логика — в `BrandVoiceExtractorService.runForAllTenants()`. Cron — тонкая
 * обёртка с try/catch (best-effort, ошибки не валят остальные тенанты).
 *
 * Cron-выражение литералом в декораторе. ENV-флаг
 * BRAND_VOICE_EXTRACTOR_ENABLED проверяется внутри сервиса — cron всё равно
 * срабатывает, но в no-op режиме (нужно для трекинга «прогон был, но
 * выключен») и для ситуации, когда оператор включит фичу без рестарта.
 */
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
      this.logger.log(stats, 'brand-voice-extractor.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'brand-voice-extractor.cron: непойманная ошибка',
      );
    }
  }
}
