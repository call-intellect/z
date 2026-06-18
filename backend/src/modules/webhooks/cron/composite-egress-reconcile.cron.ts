import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecordingsService } from '../../recordings/recordings.service';
import { MeetingFinalizationService } from '../meeting-finalization.service';

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
        meeting: {
          status: { in: ['completed', 'recording_processing'] },
          endedAt: { lt: new Date(Date.now() - 60_000) },
        },
      },
      select: { meetingId: true },
      take: 50,
    });

    if (candidates.length === 0) return;

    this.logger.debug(`composite-egress-reconcile: ${candidates.length} записей без mainVideoUrl`);

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
