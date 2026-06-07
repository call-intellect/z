import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { MeetingsService } from '../meetings/meetings.service';

/**
 * Финализация встречи после завершения записи (egress_ended).
 *
 * Выносит из `LivekitEventsHandler` промоут-логику, чтобы её мог звать и вебхук,
 * и крон-реконсайл (отдельная фаза). Поведение идентично прежнему inline-коду в
 * handler'е — это чистый вынос без изменения семантики.
 *
 *   promoteMeetingToReady    — FSM `completed → recording_processing →
 *                              recording_ready` + enqueueTranscribe.
 *   enqueueFaststartIfNeeded — faststart-постобработка composite MP4 за флагом
 *                              `RECORDING_FASTSTART_ENABLED` + порог по размеру.
 *
 * `AiQueueService` и `TypedConfigService` — `@Optional()`: в юнит-тестах их может
 * не быть (тогда faststart не ставится, а transcribe просто логирует warn).
 */
@Injectable()
export class MeetingFinalizationService {
  private readonly logger = new Logger(MeetingFinalizationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Optional()
    @Inject(AiQueueService)
    private readonly aiQueue: AiQueueService | null = null,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
  ) {}

  /**
   * После egress_ended: если recording.status стал `ready` — переводим встречу
   * `completed → recording_processing → recording_ready`. Делаем оба перехода
   * одним вызовом, потому что FSM их связывает.
   */
  async promoteMeetingToReady(meetingId: string, allReady: boolean): Promise<void> {
    if (!allReady) return;
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { status: true },
    });
    if (!meeting) return;

    try {
      // completed → recording_processing → recording_ready (если ещё в completed).
      if (meeting.status === 'completed') {
        await this.meetings.transitionStatus(meetingId, 'recording_processing', {
          reason: 'livekit:egress_ended',
        });
      }
      const cur = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { status: true },
      });
      if (cur?.status === 'recording_processing') {
        await this.meetings.transitionStatus(meetingId, 'recording_ready', {
          reason: 'livekit:egress_ended',
        });
      }

      // Фаза 5: ставим BullMQ job на транскрибацию.
      if (this.aiQueue) {
        try {
          await this.aiQueue.enqueueTranscribe(meetingId);
          this.logger.log(
            { meetingId },
            'recording_ready: AI-pipeline (transcribe) поставлен в очередь',
          );
        } catch (qerr) {
          this.logger.warn(
            { meetingId, err: qerr instanceof Error ? qerr.message : String(qerr) },
            'recording_ready: enqueueTranscribe не удался',
          );
        }
      } else {
        this.logger.warn(
          { meetingId },
          'recording_ready: AiQueueService недоступен (нет AiModule в контексте)',
        );
      }
    } catch (err) {
      this.logger.warn(
        { meetingId, err: err instanceof Error ? err.message : String(err) },
        'maybePromoteMeetingToReady: FSM-переход не удался',
      );
    }
  }

  /**
   * Фаза 3 (recording-reliability): faststart-постобработка composite MP4, чтобы
   * браузер играл видео прогрессивно. За флагом RECORDING_FASTSTART_ENABLED
   * (дефолт on) + порог по размеру (мелкие файлы не ремуксим). Non-fatal — не
   * блокирует FSM-переход в ready. Размер неизвестен (`null`) → ставим (воркер
   * перепроверит по bytesTotal).
   */
  async enqueueFaststartIfNeeded(
    meetingId: string,
    compositeBytes: number | null,
  ): Promise<void> {
    const faststartMinBytes = this.cfg?.recording.faststartMinBytes ?? 0;
    if (
      this.cfg?.recording.faststartEnabled &&
      this.aiQueue &&
      (compositeBytes === null || compositeBytes >= faststartMinBytes)
    ) {
      try {
        await this.aiQueue.enqueueRecordingFaststart(meetingId);
        this.logger.log(
          { meetingId },
          'egress_ended: faststart-постобработка composite поставлена в очередь',
        );
      } catch (qerr) {
        this.logger.warn(
          { meetingId, err: qerr instanceof Error ? qerr.message : String(qerr) },
          'egress_ended: enqueue faststart не удался (non-fatal)',
        );
      }
    }
  }
}
