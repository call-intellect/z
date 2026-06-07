import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecordingsService } from '../../recordings/recordings.service';
import { MeetingFinalizationService } from '../meeting-finalization.service';

/**
 * Cron pull-фоллбэка на потерянный/задержанный composite egress-вебхук
 * (ТЗ 2026-06-06 composite-egress reconcile, Фаза 1).
 *
 * Проблема: LiveKit не гарантирует доставку push-вебхуков. Если `egress_ended`
 * для composite потеряется или задержится, у записи бесконечно нет
 * `mainVideoUrl`, встреча застревает в `recording_processing`, видео не
 * появляется в UI (наблюдалась «18-минутная пауза» на проде).
 *
 * Решение: раз в минуту проходим по записям без `mainVideoUrl`, которые ещё
 * в активной фазе записи, тянем статус composite-egress из LiveKit
 * (`listEgress`, pull) и, если он `EGRESS_COMPLETE`, сами финализируем через
 * тот же путь, что и вебхук (`reconcileCompositeEgress` → `onCompositeEnded`
 * + faststart-enqueue + промоут FSM). Верхняя граница паузы = интервал крона
 * (≤2 мин: грейс 60с + тик раз в минуту).
 *
 * Идемпотентность: `reconcileCompositeEgress` no-op'ит запись с уже заданным
 * `mainVideoUrl` или в терминальном статусе; `onCompositeEnded`/промоут сами
 * идемпотентны. Гонка с реальным вебхуком безопасна.
 *
 * Kill-switch: `RECORDING_COMPOSITE_RECONCILE_ENABLED` (дефолт ON). NB:
 * cron-выражение статично в декораторе (ScheduleModule не читает ENV в момент
 * class-decoration), поэтому интервал фиксирован раз в минуту;
 * включение/выключение — через флаг.
 *
 * `RecordingsService` инжектится через `forwardRef` — зеркалим стиль
 * `LivekitEventsHandler` (страховка от цикла Recordings ←→ Webhooks).
 */
@Injectable()
export class CompositeEgressReconcileCron {
  private readonly logger = new Logger(CompositeEgressReconcileCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RecordingsService))
    private readonly recordings: RecordingsService,
    @Inject(MeetingFinalizationService)
    private readonly finalization: MeetingFinalizationService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('*/1 * * * *', { name: 'composite-egress-reconcile' })
  async sweep(): Promise<void> {
    if (!this.cfg.recording.compositeReconcileEnabled) return;

    const candidates = await this.prisma.recording.findMany({
      where: {
        mainVideoUrl: null,
        compositeEgressId: { not: null },
        status: { in: ['recording', 'finalizing'] },
        // Грейс «дать вебхуку 60с»: каждый путь к `completed` проходит через
        // LiveKit `room_finished` (LivekitEventsHandler.onRoomFinished), который
        // всегда ставит `endedAt = now`; `recording_processing` достижим только
        // после `completed`, поэтому endedAt гарантированно не null. Не гонимся с
        // только что прилетевшим вебхуком — пуллим лишь «отстоявшиеся» записи.
        meeting: {
          status: { in: ['completed', 'recording_processing'] },
          endedAt: { lt: new Date(Date.now() - 60_000) },
        },
      },
      select: { meetingId: true },
      take: 50,
    });

    if (candidates.length === 0) return;

    this.logger.debug(
      `composite-egress-reconcile: ${candidates.length} записей без mainVideoUrl`,
    );

    for (const rec of candidates) {
      try {
        const { becameComplete, allReady, compositeBytes } =
          await this.recordings.reconcileCompositeEgress(rec.meetingId);
        if (becameComplete) {
          await this.finalization.enqueueFaststartIfNeeded(rec.meetingId, compositeBytes);
          await this.finalization.promoteMeetingToReady(rec.meetingId, allReady);
        }
      } catch (err) {
        this.logger.warn(
          {
            meetingId: rec.meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'composite-egress-reconcile: ошибка',
        );
      }
    }
  }
}
