import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { CheckinIngestService } from '../services/checkin-ingest.service';

@Injectable()
export class CheckinGraphIngestListener {
  private readonly logger = new Logger(CheckinGraphIngestListener.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CheckinIngestService)
    private readonly ingestService: CheckinIngestService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @OnEvent('checkin.created')
  async onCheckinCreated(event: {
    tenantId: string;
    checkInId: string;
    personId: string;
    kind: string;
    rawText: string | null;
  }): Promise<void> {
    if (!this.cfg.betaOps.checkinGraphIngestEnabled) {
      this.metrics.incCheckinGraphIngest({ result: 'skipped' });
      return;
    }
    try {
      const res = await this.ingestService.ingestCheckin(event.tenantId, event.checkInId);
      this.metrics.incCheckinGraphIngest({ result: res ? 'ok' : 'skipped' });
    } catch (err) {
      this.metrics.incCheckinGraphIngest({ result: 'error' });
      this.logger.warn(
        {
          checkInId: event.checkInId,
          tenantId: event.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'CheckinGraphIngestListener: ошибка моста чек-ин → граф — пропускаю (best-effort)',
      );
    }
  }
}
