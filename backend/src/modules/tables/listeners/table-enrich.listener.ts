import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  MEETING_AI_READY,
  type MeetingAiReadyEventPayload,
} from '../events/entity-sync.events';
import { TableEnrichQueueService } from '../services/table-enrich-queue.service';

/**
 * TableEnrichListener (Smart-tables Фаза 3 — Event-to-Cells).
 *
 * Подписывается на `meeting.ai_ready` (эмитит AnalyzeWorker после ai_ready) и
 * кладёт enrich-job в очередь `tables.enrich`. Тонкий: вся бизнес-логика —
 * в `TableEnrichService.enrichFromEvent` (вызывается воркером). Listener не
 * должен бросать — ошибка enqueue логируется и проглатывается, чтобы не
 * сорвать основной AI-pipeline (эмиттер синхронный).
 */
@Injectable()
export class TableEnrichListener {
  private readonly logger = new Logger(TableEnrichListener.name);

  constructor(
    @Inject(TableEnrichQueueService)
    private readonly queue: TableEnrichQueueService,
  ) {}

  @OnEvent(MEETING_AI_READY, { async: true })
  async onMeetingAiReady(payload: MeetingAiReadyEventPayload): Promise<void> {
    if (!payload?.meetingId || !payload?.tenantId) {
      return;
    }
    try {
      await this.queue.enqueueMeetingEnrich({
        meetingId: payload.meetingId,
        tenantId: payload.tenantId,
      });
    } catch (err) {
      this.logger.warn(
        {
          meetingId: payload.meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'table-enrich listener: enqueue не удался — пропускаем (best-effort)',
      );
    }
  }
}
