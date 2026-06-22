import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecordingsService } from '../../recordings/recordings.service';
import { MeetingFinalizationService } from '../meeting-finalization.service';

@Injectable()
export class TrackEgressWatchdogCron {
  private readonly logger = new Logger(TrackEgressWatchdogCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RecordingsService))
    private readonly recordings: RecordingsService,
    @Inject(MeetingFinalizationService)
    private readonly finalization: MeetingFinalizationService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('*/10 * * * *', { name: 'track-egress-watchdog' })
  async sweep(now: Date = new Date()): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'recording.trackWatchdogEnabled',
      undefined,
      true,
    );
    if (!enabled) return;

    const timeoutMinutes = await this.cfg.getDynamic<number>(
      'recording.trackWatchdogTimeoutMinutes',
      undefined,
      20,
    );
    const cutoff = new Date(now.getTime() - timeoutMinutes * 60_000);

    const candidates = await this.prisma.recording.findMany({
      where: {
        mainVideoUrl: { not: null },
        status: { in: ['recording', 'finalizing'] },
        meeting: {
          status: { in: ['completed', 'recording_processing'] },
          endedAt: { lt: cutoff },
        },
        audioTracks: {
          some: {
            OR: [{ audioUrl: { startsWith: 's3://' } }, { bytes: null }],
          },
        },
      },
      select: {
        meetingId: true,
        audioTracks: {
          select: { id: true, audioUrl: true, bytes: true },
        },
      },
      take: 50,
    });

    if (candidates.length === 0) return;

    for (const rec of candidates) {
      const stuckIds = rec.audioTracks
        .filter((t) => t.bytes === null || t.audioUrl.startsWith('s3://'))
        .map((t) => t.id);
      const readyCount = rec.audioTracks.length - stuckIds.length;

      if (stuckIds.length === 0 || readyCount === 0) {
        this.metrics.incRecordingTrackWatchdog({ outcome: 'skipped' });
        continue;
      }

      try {
        const { allReady } = await this.recordings.degradeStuckTracksAndFinalize(
          rec.meetingId,
          stuckIds,
        );
        this.logger.warn(
          {
            meetingId: rec.meetingId,
            droppedTracks: stuckIds.length,
            readyTracks: readyCount,
            allReady,
            timeoutMinutes,
          },
          'track-egress-watchdog: деградировал застрявшие аудио-дорожки, переинициирована финализация',
        );
        await this.finalization.promoteMeetingToReady(rec.meetingId, allReady);
        this.metrics.incRecordingTrackWatchdog({ outcome: 'forced' });
      } catch (err) {
        this.logger.warn(
          {
            meetingId: rec.meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'track-egress-watchdog: ошибка',
        );
      }
    }
  }
}
