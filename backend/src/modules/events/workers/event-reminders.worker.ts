import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ConversationalService } from '../../conversational/conversational.service';
import {
  CORE_QUEUE_NAMES,
  type EventReminderJobData,
} from '../../core-queue/queues';

/**
 * Calendar MVP (2026-05-25) — BullMQ-воркер `core.event-reminders`.
 *
 * Поток:
 *   1. По reminderId достаём EventReminder + Event + участников.
 *   2. Если reminder уже sentAt != null — no-op (идемпотентность).
 *   3. Если reminder.userId != null — отправляем одному; иначе всем
 *      участникам с EventParticipant.userId != null.
 *   4. По каналу:
 *      - `telegram` → ConversationalService.sendNotification({
 *          eventType: 'event.reminder' }) — маршрутизатор сам подберёт
 *          telegram_bot/max_bot/in_app.
 *      - `push` / `email` — TODO (заглушка + лог).
 *   5. После доставки — EventReminder.sentAt = now (один раз для всех каналов).
 *   6. Метрика `calendar_reminders_sent_total{tenant, channel, success}`.
 */
@Injectable()
export class EventRemindersWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventRemindersWorker.name);
  private worker: Worker<EventReminderJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<EventReminderJobData>(
      CORE_QUEUE_NAMES.EVENT_REMINDERS,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        { jobId: job?.id, err: err.message },
        'EventRemindersWorker — job упал',
      );
    });
    this.logger.log(
      `EventRemindersWorker запущен (${CORE_QUEUE_NAMES.EVENT_REMINDERS})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<EventReminderJobData>): Promise<void> {
    const { reminderId } = job.data;
    const reminder = await this.prisma.eventReminder.findUnique({
      where: { id: reminderId },
      include: {
        event: {
          include: {
            participants: {
              select: { userId: true },
            },
          },
        },
      },
    });
    if (!reminder) {
      this.logger.warn({ reminderId }, 'reminder не найден — пропуск');
      return;
    }
    if (reminder.sentAt) {
      this.logger.debug(
        { reminderId },
        'reminder уже отправлен (sentAt) — пропуск',
      );
      return;
    }
    if (reminder.event.deletedAt) {
      this.logger.debug(
        { reminderId, eventId: reminder.eventId },
        'event удалён — отменяем reminder',
      );
      await this.prisma.eventReminder.update({
        where: { id: reminder.id },
        data: { sentAt: new Date() },
      });
      return;
    }

    // Получатели.
    const recipientIds: string[] = [];
    if (reminder.userId) {
      recipientIds.push(reminder.userId);
    } else {
      for (const p of reminder.event.participants) {
        if (p.userId) recipientIds.push(p.userId);
      }
    }
    const uniqueRecipients = Array.from(new Set(recipientIds));
    if (uniqueRecipients.length === 0) {
      this.logger.debug(
        { reminderId },
        'нет получателей с userId — помечаем sentAt и выходим',
      );
      await this.prisma.eventReminder.update({
        where: { id: reminder.id },
        data: { sentAt: new Date() },
      });
      return;
    }

    let allOk = true;
    for (const userId of uniqueRecipients) {
      const ok = await this.deliverOne({
        tenantId: reminder.event.tenantId,
        userId,
        channel: reminder.channel,
        event: reminder.event,
        offsetMin: reminder.offsetMin,
      });
      if (!ok) allOk = false;
    }

    await this.prisma.eventReminder.update({
      where: { id: reminder.id },
      data: { sentAt: new Date() },
    });

    this.logger.log(
      {
        reminderId,
        eventId: reminder.eventId,
        channel: reminder.channel,
        recipients: uniqueRecipients.length,
        success: allOk,
      },
      'EventRemindersWorker — отправка завершена',
    );
  }

  private async deliverOne(args: {
    tenantId: string;
    userId: string;
    channel: 'push' | 'email' | 'telegram';
    event: { id: string; title: string; startAt: Date; location: string | null };
    offsetMin: number;
  }): Promise<boolean> {
    const { tenantId, userId, channel, event, offsetMin } = args;

    try {
      if (channel === 'telegram') {
        await this.conversational.sendNotification({
          tenantId,
          recipientUserId: userId,
          eventType: 'event.reminder',
          payload: {
            eventId: event.id,
            eventTitle: event.title,
            startAtIso: event.startAt.toISOString(),
            offsetMin,
            location: event.location,
            actionUrl: `/me/calendar?event=${event.id}`,
          },
          dataClass: 'internal',
        });
      } else {
        // push / email — TODO: интеграция с PushService / MailService.
        this.logger.warn(
          { channel, userId, eventId: event.id },
          'TODO: доставка через push/email не реализована',
        );
      }
      this.metrics.incCalendarReminderSent({
        tenant: tenantId,
        channel,
        success: true,
      });
      return true;
    } catch (err) {
      this.logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          channel,
          userId,
          eventId: event.id,
        },
        'EventRemindersWorker — доставка упала',
      );
      this.metrics.incCalendarReminderSent({
        tenant: tenantId,
        channel,
        success: false,
      });
      return false;
    }
  }
}
