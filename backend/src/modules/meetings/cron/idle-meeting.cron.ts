import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LivekitService } from '../../livekit/livekit.service';
import { RecordingsService } from '../../recordings/recordings.service';
import { MeetingsService } from '../meetings.service';

const MIN_SCHEDULED_RECONCILE_MINUTES = 30;

@Injectable()
export class IdleMeetingCron {
  private readonly logger = new Logger(IdleMeetingCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Optional()
    @Inject(forwardRef(() => RecordingsService))
    private readonly recordings: RecordingsService | null = null,
  ) {}

  @Cron('*/1 * * * *')
  async sweep(): Promise<void> {
    await this.sweepIdleActive();
    await this.reconcileAbandonedScheduled();
  }

  private async sweepIdleActive(): Promise<void> {
    const timeoutMinutes = this.cfg.idle.timeoutMinutes;
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const candidates = await this.prisma.meeting.findMany({
      where: {
        status: 'active',
        startedAt: { lt: cutoff, not: null },
      },
      select: { id: true },
      take: 50,
    });

    if (candidates.length === 0) return;

    this.logger.debug(`Idle-cron: ${candidates.length} кандидатов (timeout=${timeoutMinutes} мин)`);

    for (const meeting of candidates) {
      try {
        const participants = await this.livekit.listParticipants({ id: meeting.id });
        const hasActive = participants.some((p) => {
          return Boolean(p.identity);
        });
        if (hasActive) {
          this.logger.debug(
            { meetingId: meeting.id, count: participants.length },
            'Idle-cron: участники ещё в room, пропускаем',
          );
          continue;
        }
        await this.livekit.deleteRoom({ id: meeting.id });
        this.logger.debug(
          { meetingId: meeting.id },
          'Idle-cron: room удалена (никого нет дольше таймаута)',
        );
      } catch (err) {
        this.logger.warn(
          {
            meetingId: meeting.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'Idle-cron: ошибка обработки встречи',
        );
      }
    }
  }

  private async reconcileAbandonedScheduled(): Promise<void> {
    const minutes = Math.max(this.cfg.idle.timeoutMinutes, MIN_SCHEDULED_RECONCILE_MINUTES);
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    const candidates = await this.prisma.meeting.findMany({
      where: { status: 'scheduled', createdAt: { lt: cutoff } },
      select: { id: true, ownerId: true, recordByDefault: true },
      take: 50,
    });
    if (candidates.length === 0) return;

    this.logger.debug(`Idle-cron: ${candidates.length} брошенных scheduled (порог=${minutes} мин)`);

    for (const meeting of candidates) {
      try {
        let participants: Awaited<ReturnType<LivekitService['listParticipants']>> = [];
        try {
          participants = await this.livekit.listParticipants({ id: meeting.id });
        } catch {
          participants = [];
        }
        const hasLive = participants.some((p) => Boolean(p.identity));

        if (hasLive) {
          await this.meetings.transitionStatus(meeting.id, 'active', {
            startedAt: new Date(),
            reason: 'idle-cron:scheduled-reconcile-recover',
          });
          this.logger.debug(
            { meetingId: meeting.id, count: participants.length },
            'Idle-cron: scheduled с участниками → recover active (room_started потерян)',
          );
          if (meeting.recordByDefault && this.recordings) {
            try {
              await this.recordings.start(meeting.id, meeting.ownerId);
              this.logger.debug({ meetingId: meeting.id }, 'Idle-cron: запись восстановлена');
            } catch (err) {
              this.logger.warn(
                { meetingId: meeting.id, err: err instanceof Error ? err.message : String(err) },
                'Idle-cron: recovery-запись не стартовала (non-fatal)',
              );
            }
          }
        } else {
          try {
            await this.livekit.deleteRoom({ id: meeting.id });
          } catch {}
          await this.meetings.transitionStatus(meeting.id, 'failed', {
            failureReason: 'never_activated',
            reason: 'idle-cron:never_activated',
          });
          this.logger.debug(
            { meetingId: meeting.id },
            'Idle-cron: брошенная scheduled закрыта (never_activated)',
          );
        }
      } catch (err) {
        this.logger.warn(
          { meetingId: meeting.id, err: err instanceof Error ? err.message : String(err) },
          'Idle-cron: ошибка reconcile scheduled',
        );
      }
    }
  }
}
