import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { CheckinParserService } from './checkin-parser.service';
import { DailyCheckInService } from './daily-checkin.service';
import { OperationsDashboardService } from './operations-dashboard.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8 — CheckinResponseHandler.
 *
 * Слушает `notification.responded`, эмиттированный
 * `ConversationalService.respondToProbe`. Если eventType='checkin.prompt' (или
 * payload.metaJson.kind='checkin'), считает это ответом на morning/evening
 * чек-ин и сохраняет в `DailyCheckIn`.
 *
 * Алгоритм:
 *   1. Найти исходный Notification, прочитать его payload (там лежит kind +
 *      dateLocal + personId — мы их кладём в `DailyCheckInPromptCron`).
 *   2. Извлечь rawText из responsePayload.text.
 *   3. Парсить через `CheckinParserService` (LLM). confidence < 0.6 →
 *      сохраняем raw + curatorReview=true.
 *   4. Upsert в `DailyCheckIn` (через DailyCheckInService.upsertFromParser).
 *   5. Инвалидируем кэш COO дашборда.
 *
 * Контракт: best-effort. Любая ошибка → warn, не throw (не ломаем основной
 * pipeline respond-to-probe).
 */
@Injectable()
export class CheckinResponseHandler {
  private readonly logger = new Logger(CheckinResponseHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CheckinParserService) private readonly parser: CheckinParserService,
    @Inject(DailyCheckInService)
    private readonly checkinService: DailyCheckInService,
    @Inject(OperationsDashboardService)
    private readonly dashboard: OperationsDashboardService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @OnEvent('notification.responded')
  async handle(event: {
    tenantId: string;
    notificationId: string;
    recipientUserId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      // Фильтр: только checkin.prompt + payload.metaJson.kind='checkin'.
      const isCheckin =
        event.eventType === 'checkin.prompt' ||
        (event.payload &&
          typeof event.payload === 'object' &&
          (event.payload as Record<string, unknown>).kind === 'checkin');
      if (!isCheckin) return;

      const notif = await this.prisma.notification.findUnique({
        where: { id: event.notificationId },
        select: { payload: true, recipientUserId: true, tenantId: true },
      });
      if (!notif) return;
      const origPayload = notif.payload as Record<string, unknown> | null;
      if (!origPayload) return;

      const kind = origPayload.checkInKind === 'evening' ? 'evening' : 'morning';
      const dateLocal =
        typeof origPayload.dateLocal === 'string' ? origPayload.dateLocal : null;
      const personId =
        typeof origPayload.personId === 'string' ? origPayload.personId : null;
      if (!dateLocal || !personId) {
        this.logger.debug(
          { notificationId: event.notificationId },
          'CheckinResponseHandler: payload без personId/dateLocal — skip',
        );
        return;
      }

      const rawText =
        typeof event.payload?.text === 'string'
          ? (event.payload.text as string)
          : typeof event.payload?.answer === 'string'
            ? (event.payload.answer as string)
            : '';

      const parsed = await this.parser.parse({
        tenantId: event.tenantId,
        kind,
        rawText,
      });

      await this.checkinService.upsertFromParser({
        tenantId: event.tenantId,
        personId,
        kind,
        dateLocal,
        plans: parsed.plans,
        dones: parsed.dones,
        blockers: parsed.blockers,
        notificationId: event.notificationId,
        rawResponseText: rawText,
        parseConfidence: parsed.confidence,
      });

      if (parsed.confidence < 0.6) {
        this.metrics.incDailyCheckinSkipped({
          tenantTop: resolveOperationsTenantTop(event.tenantId),
          kind,
          reason: 'low_confidence',
        });
      }

      await this.dashboard.invalidateCache(event.tenantId);
      this.logger.log(
        {
          tenantId: event.tenantId,
          personId,
          kind,
          dateLocal,
          confidence: parsed.confidence,
        },
        'CheckinResponseHandler: чек-ин сохранён',
      );
    } catch (err) {
      this.logger.warn(
        {
          notificationId: event.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'CheckinResponseHandler: внутренняя ошибка — пропускаю',
      );
    }
  }
}
