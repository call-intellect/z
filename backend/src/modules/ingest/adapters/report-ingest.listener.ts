import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';

import { ReportIngestAdapter } from './report.adapter';

/**
 * Payload события `meeting.report-fast-ready` (эмитит MeetingReportFastWorker
 * после готовности fast-отчёта). Дублируем shape структурно, чтобы НЕ тащить
 * knowledge-core в граф зависимостей IngestModule.
 */
interface ReportFastReadyEvent {
  meetingId: string;
  tenantId: string;
  status: 'ready' | 'partial';
}

/**
 * ReportIngestListener (Фаза 2 «отчёт встречи → граф», ТЗ
 * 2026-06-11-report-to-graph-phase2.md §4).
 *
 * Слушает `meeting.report-fast-ready` (EventEmitter2 — глобальный) и заносит
 * готовый fast-отчёт встречи в граф через `ReportIngestAdapter`.
 *
 * Принципы:
 *   1. **Kill-switch** `REPORT_INGEST_ENABLED` (Ship-On, дефолт ON) — при false
 *      ранний return (фича выключена, аварийный рубильник).
 *   2. **Best-effort** — весь обработчик в try/catch; падать наружу нельзя
 *      (отчёт уже записан, ingest — отложенный шаг). Паттерн TrackerAdapter.
 */
@Injectable()
export class ReportIngestListener {
  private readonly logger = new Logger(ReportIngestListener.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ReportIngestAdapter)
    private readonly adapter: ReportIngestAdapter,
  ) {}

  @OnEvent('meeting.report-fast-ready', { async: true })
  async handleReportFastReady(payload: ReportFastReadyEvent): Promise<void> {
    try {
      // Kill-switch (аварийный рубильник). При выключенной фиче — no-op.
      if (!this.cfg.knowledgeCore.reportIngestEnabled) {
        this.logger.debug(
          { meetingId: payload?.meetingId },
          'report-ingest-listener: REPORT_INGEST_ENABLED=false — skip',
        );
        return;
      }
      if (!payload?.meetingId) {
        this.logger.warn(
          'report-ingest-listener: событие без meetingId — skip',
        );
        return;
      }
      await this.adapter.ingestReport(payload.meetingId);
    } catch (err) {
      // Strict best-effort: отчёт уже зафиксирован, ingest — отложенный шаг;
      // падать наружу нельзя.
      this.logger.warn(
        {
          meetingId: payload?.meetingId,
          tenantId: payload?.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'report-ingest-listener: ingest отчёта упал — событие пропущено',
      );
    }
  }
}
