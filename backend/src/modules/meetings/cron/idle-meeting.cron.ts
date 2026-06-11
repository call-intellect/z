import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LivekitService } from '../../livekit/livekit.service';
import { RecordingsService } from '../../recordings/recordings.service';
import { MeetingsService } from '../meetings.service';

/**
 * Минимальный возраст брошенной `scheduled` для reconcile (Р2: «через 30 мин»;
 * меньше — риск закрыть заранее созданную встречу). Берём max с общим
 * idle-timeout (по умолчанию 15 мин — для active это ок, для scheduled мало).
 */
const MIN_SCHEDULED_RECONCILE_MINUTES = 30;

/**
 * Кран idle-meeting.
 *
 * Раз в `cfg.idle.cron` (по умолчанию каждую минуту) проходит по
 * `Meeting.status='active'`, у которых `startedAt + IDLE_MEETING_TIMEOUT_MINUTES < NOW`.
 * Если в LiveKit-room фактически нет активных участников — `deleteRoom`.
 * Webhook `room_finished` довершит FSM-переход active → completed.
 *
 * Второй проход (ТЗ Ф6/Р2): reconcile брошенных `scheduled` старше порога —
 * подбирает встречи, у которых потерян вебхук `room_started` (idle-cron по
 * `active` их не видит). Пустая room → `failed(never_activated)`; живые
 * участники → recover в `active` (+ восстановление записи при recordByDefault).
 *
 * NB: Cron-выражение из ENV — статически зарегистрировать через декоратор
 * нельзя (декоратор берёт значение в момент class-decoration). Используем
 * фиксированное расписание (раз в минуту) — это значение по умолчанию
 * `IDLE_MEETING_CRON`. Само значение из ENV учитывается через `cfg.idle.cron`
 * (можно расширить выключателем при необходимости).
 */
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

  /**
   * Каждую минуту. Дальнейшие настройки (вкл/выкл, окно ENV-cron) можно
   * добавить через `SchedulerRegistry`, но в MVP достаточно частой проверки.
   */
  @Cron('*/1 * * * *')
  async sweep(): Promise<void> {
    await this.sweepIdleActive();
    await this.reconcileAbandonedScheduled();
  }

  /** Прежняя логика: active-встречи без участников дольше таймаута → deleteRoom. */
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

    this.logger.debug(
      `Idle-cron: ${candidates.length} кандидатов (timeout=${timeoutMinutes} мин)`,
    );

    for (const meeting of candidates) {
      try {
        const participants = await this.livekit.listParticipants({ id: meeting.id });
        const hasActive = participants.some((p) => {
          // ParticipantInfo_State.ACTIVE = 1; нам важно, что есть кто-то живой.
          // Но тут проще: если массив непустой — значит в room кто-то есть.
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
        this.logger.log(
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

  /**
   * Reconcile брошенных `scheduled` (потерян вебхук room_started — ТЗ Ф6/Р2).
   *   room пуста/не существует → deleteRoom (best-effort) + scheduled→failed(never_activated).
   *   в room есть живые участники → встреча реально идёт: scheduled→active(startedAt=now)
   *     + при recordByDefault попытаться стартовать запись (recovery room_started).
   */
  private async reconcileAbandonedScheduled(): Promise<void> {
    const minutes = Math.max(this.cfg.idle.timeoutMinutes, MIN_SCHEDULED_RECONCILE_MINUTES);
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    const candidates = await this.prisma.meeting.findMany({
      where: { status: 'scheduled', createdAt: { lt: cutoff } },
      select: { id: true, ownerId: true, recordByDefault: true },
      take: 50,
    });
    if (candidates.length === 0) return;

    this.logger.debug(
      `Idle-cron: ${candidates.length} брошенных scheduled (порог=${minutes} мин)`,
    );

    for (const meeting of candidates) {
      try {
        let participants: Awaited<ReturnType<LivekitService['listParticipants']>> = [];
        try {
          participants = await this.livekit.listParticipants({ id: meeting.id });
        } catch {
          // room не существует в LiveKit → трактуем как пустую (never_activated).
          participants = [];
        }
        const hasLive = participants.some((p) => Boolean(p.identity));

        if (hasLive) {
          // room_started потерян, но встреча идёт → восстановить.
          await this.meetings.transitionStatus(meeting.id, 'active', {
            startedAt: new Date(),
            reason: 'idle-cron:scheduled-reconcile-recover',
          });
          this.logger.log(
            { meetingId: meeting.id, count: participants.length },
            'Idle-cron: scheduled с участниками → recover active (room_started потерян)',
          );
          if (meeting.recordByDefault && this.recordings) {
            try {
              await this.recordings.start(meeting.id, meeting.ownerId);
              this.logger.log({ meetingId: meeting.id }, 'Idle-cron: запись восстановлена');
            } catch (err) {
              this.logger.warn(
                { meetingId: meeting.id, err: err instanceof Error ? err.message : String(err) },
                'Idle-cron: recovery-запись не стартовала (non-fatal)',
              );
            }
          }
        } else {
          // пусто/не существует → брошенная встреча.
          try {
            await this.livekit.deleteRoom({ id: meeting.id });
          } catch {
            /* best-effort: room могла не существовать */
          }
          await this.meetings.transitionStatus(meeting.id, 'failed', {
            failureReason: 'never_activated',
            reason: 'idle-cron:never_activated',
          });
          this.logger.log(
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
