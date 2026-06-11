import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { CheckinIngestService } from '../services/checkin-ingest.service';

/**
 * CheckinGraphIngestListener — подписчик `checkin.created` (ТЗ
 * 2026-06-10-daily-checkin-to-graph-bridge, Фаза 3).
 *
 * Слушает то же событие, что `CheckinSentimentAnalyzerWorker`, НЕЗАВИСИМО от
 * него (оба best-effort; порядок не важен; ошибка одного не влияет на другого).
 * Зовёт `CheckinIngestService.ingestCheckin` — мост чек-ина в knowledge-core.
 *
 * Kill-switch — `CHECKIN_GRAPH_INGEST_ENABLED` (ON по умолчанию,
 * `betaOps.checkinGraphIngestEnabled`, Р-B5 / Ship-On).
 *
 * Best-effort (R9): ошибка моста НЕ ломает создание чек-ина и sentiment-анализ —
 * только warn-лог + метрика `z_checkin_graph_ingest_total{result='error'}`.
 */
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
    // Kill-switch: фича работает (ON), рубильник на случай инцидента (R1).
    if (!this.cfg.betaOps.checkinGraphIngestEnabled) {
      this.metrics.incCheckinGraphIngest({ result: 'skipped' });
      return;
    }
    try {
      const res = await this.ingestService.ingestCheckin(
        event.tenantId,
        event.checkInId,
      );
      // res=null → чек-ин пустой/не найден (R2): ничего не ингестили → skipped.
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
