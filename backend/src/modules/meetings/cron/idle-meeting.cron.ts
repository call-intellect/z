import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LivekitService } from '../../livekit/livekit.service';

/**
 * Кран idle-meeting.
 *
 * Раз в `cfg.idle.cron` (по умолчанию каждую минуту) проходит по
 * `Meeting.status='active'`, у которых `startedAt + IDLE_MEETING_TIMEOUT_MINUTES < NOW`.
 * Если в LiveKit-room фактически нет активных участников — `deleteRoom`.
 * Webhook `room_finished` довершит FSM-переход active → completed.
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
  ) {}

  /**
   * Каждую минуту. Дальнейшие настройки (вкл/выкл, окно ENV-cron) можно
   * добавить через `SchedulerRegistry`, но в MVP достаточно частой проверки.
   */
  @Cron('*/1 * * * *')
  async sweep(): Promise<void> {
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
}
