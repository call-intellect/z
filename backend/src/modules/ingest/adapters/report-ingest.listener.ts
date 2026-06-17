import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';

import { ReportIngestAdapter } from './report.adapter';

interface ReportFastReadyEvent {
  meetingId: string;
  tenantId: string;
  status: 'ready' | 'partial';
}

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
      if (!this.cfg.knowledgeCore.reportIngestEnabled) {
        this.logger.debug(
          { meetingId: payload?.meetingId },
          'report-ingest-listener: REPORT_INGEST_ENABLED=false — skip',
        );
        return;
      }
      if (!payload?.meetingId) {
        this.logger.warn('report-ingest-listener: событие без meetingId — skip');
        return;
      }
      await this.adapter.ingestReport(payload.meetingId);
    } catch (err) {
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
