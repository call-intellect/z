import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecordingsService } from '../recordings.service';

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

    this.logger.debug(`recording-track-reconcile: ${candidates.length} активных записей`);

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
