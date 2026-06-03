import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecordingsService } from '../recordings.service';

/**
 * Cron сверки per-track аудиодорожек (ТЗ 2026-06-03 meeting-recording-reliability,
 * Фаза 1, P0).
 *
 * Раз в минуту проходит по активным записям (`Recording.status ∈
 * {requested, recording}`) и для каждой вызывает `reconcileTrackEgress`:
 * pull-сверка состояния комнаты в LiveKit → догон дорожек, потерянных на гонке
 * старта записи, reconnect-republish или потере webhook. Гарантия: пока участник
 * в комнате с AUDIO-треком — его дорожка будет создана не позже следующего тика.
 *
 * Идемпотентность создания egress — внутри `ensureTrackEgress` (DB-дедуп +
 * in-process lock), поэтому повторные тики не плодят дубли.
 *
 * Kill-switch: `RECORDING_TRACK_RECONCILE_ENABLED` (дефолт ON). NB: cron-выражение
 * статично в декораторе (ScheduleModule не читает ENV в момент class-decoration),
 * поэтому интервал фиксирован раз в минуту; включение/выключение — через флаг.
 */
@Injectable()
export class RecordingTrackReconcileCron {
  private readonly logger = new Logger(RecordingTrackReconcileCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RecordingsService) private readonly recordings: RecordingsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('*/1 * * * *', { name: 'recording-track-reconcile' })
  async sweep(): Promise<void> {
    if (!this.cfg.recording.trackReconcileEnabled) return;

    const candidates = await this.prisma.recording.findMany({
      where: { status: { in: ['requested', 'recording'] } },
      select: { meetingId: true },
      take: 50,
    });

    if (candidates.length === 0) return;

    this.logger.debug(
      `recording-track-reconcile: ${candidates.length} активных записей`,
    );

    for (const rec of candidates) {
      try {
        await this.recordings.reconcileTrackEgress(rec.meetingId);
      } catch (err) {
        this.logger.warn(
          {
            meetingId: rec.meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'recording-track-reconcile: ошибка сверки записи',
        );
      }
    }
  }
}
