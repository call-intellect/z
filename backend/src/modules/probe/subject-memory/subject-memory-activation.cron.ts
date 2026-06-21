import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';

import { SubjectMemoryActivationService } from './subject-memory-activation.service';

@Injectable()
export class SubjectMemoryActivationCron {
  private readonly logger = new Logger(SubjectMemoryActivationCron.name);

  constructor(
    @Inject(SubjectMemoryActivationService)
    private readonly svc: SubjectMemoryActivationService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('35 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.subjectMemory.enabled) {
      this.logger.debug(
        'subject-memory-activation.cron disabled (subjectMemory.enabled=false)',
      );
      return;
    }
    try {
      const startedAt = Date.now();
      const promote = await this.svc.promoteShadowRules();
      const evaluate = await this.svc.evaluateCanaryRules();
      const decay = await this.svc.decayStaleRules();
      this.logger.debug(
        { ...promote, ...evaluate, ...decay, durationMs: Date.now() - startedAt },
        'subject-memory-activation.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'subject-memory-activation.cron: непойманная ошибка',
      );
    }
  }
}
