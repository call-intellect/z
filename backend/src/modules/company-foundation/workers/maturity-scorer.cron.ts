import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { MaturityScorerService } from '../services/maturity-scorer.service';

@Injectable()
export class MaturityScorerCron {
  private readonly logger = new Logger(MaturityScorerCron.name);

  constructor(
    @Inject(MaturityScorerService)
    private readonly svc: MaturityScorerService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 5 * * *')
  async run(): Promise<void> {
    if (!this.cfg.companyFoundation.maturityScorerEnabled) {
      this.logger.debug('MaturityScorerCron disabled (MATURITY_SCORER_ENABLED=false)');
      return;
    }
    try {
      const startedAt = Date.now();
      const r = await this.svc.rebuildAllOrgs();
      this.logger.debug(
        { ...r, durationMs: Date.now() - startedAt },
        'maturity-scorer.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'maturity-scorer.cron: непойманная ошибка',
      );
    }
  }
}
