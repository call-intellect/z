import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { CORE_QUEUE_NAMES, type EventReminderJobData } from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { MailService } from '../../mail/mail.service';

interface ReminderRecipient {
  userId: string | null;
  personId: string | null;
  name: string;
  email: string | null;
}

@Injectable()
export class EventRemindersWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventRemindersWorker.name);
  private worker: Worker<EventReminderJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<EventReminderJobData>(
      CORE_QUEUE_NAMES.EVENT_REMINDERS,
      async (job) =>
        this.pipe.job(SystemLogPipeline.NOTIFICATIONS, 'events.reminders', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, err: err.message }, 'EventRemindersWorker — job упал');
    });
    this.logger.debug(`EventRemindersWorker запущен (${CORE_QUEUE_NAMES.EVENT_REMINDERS})`);
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
              select: {
                userId: true,
                personId: true,
                user: { select: { id: true, name: true, email: true } },
                person: { select: { id: true, name: true, email: true } },
              },
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
      this.logger.debug({ reminderId }, 'reminder уже отправлен (sentAt) — пропуск');
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

    const recipients: ReminderRecipient[] = [];
    if (reminder.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: reminder.userId },
        select: { id: true, name: true, email: true },
      });
      if (user) {
        recipients.push({
          userId: user.id,
          personId: null,
          name: user.name,
          email: this.normalizeEmail(user.email),
        });
      }
    } else {
      for (const p of reminder.event.participants) {
        if (p.user) {
          recipients.push({
            userId: p.user.id,
            personId: null,
            name: p.user.name,
            email: this.normalizeEmail(p.user.email),
          });
        } else if (p.person) {
          recipients.push({
            userId: null,
            personId: p.person.id,
            name: p.person.name,
            email: this.normalizeEmail(p.person.email),
          });
        }
      }
    }

    const seen = new Set<string>();
    const uniqueRecipients = recipients.filter((r) => {
      const key = r.userId ? `u:${r.userId}` : `p:${r.personId ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueRecipients.length === 0) {
      this.logger.debug({ reminderId }, 'нет получателей — помечаем sentAt и выходим');
      await this.prisma.eventReminder.update({
        where: { id: reminder.id },
        data: { sentAt: new Date() },
      });
      return;
    }

    let allOk = true;
    for (const recipient of uniqueRecipients) {
      const ok = await this.deliverOne({
        tenantId: reminder.event.tenantId,
        recipient,
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

    this.logger.debug(
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

  private normalizeEmail(email: string | null | undefined): string | null {
    if (!email) return null;
    const trimmed = email.trim();
    return trimmed === '' ? null : trimmed;
  }

  private async deliverOne(args: {
    tenantId: string;
    recipient: ReminderRecipient;
    channel: 'push' | 'email' | 'telegram';
    event: {
      id: string;
      title: string;
      startAt: Date;
      location: string | null;
      timezone: string;
    };
    offsetMin: number;
  }): Promise<boolean> {
    const { tenantId, recipient, channel, event, offsetMin } = args;

    try {
      if (channel === 'telegram') {
        if (!recipient.userId) {
          this.logger.debug(
            {
              channel,
              personId: recipient.personId,
              eventId: event.id,
            },
            'telegram-канал не поддерживает Person без User — пропуск',
          );
          return true;
        }
        await this.conversational.sendNotification({
          tenantId,
          recipientUserId: recipient.userId,
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
      } else if (channel === 'email') {
        if (!recipient.email) {
          this.logger.warn(
            {
              channel,
              userId: recipient.userId,
              personId: recipient.personId,
              eventId: event.id,
            },
            'email-канал: у получателя нет email — пропуск',
          );
          return true;
        }
        const subject = this.buildEmailSubject({
          eventTitle: event.title,
          startAt: event.startAt,
        });
        const text = this.buildEmailText({
          recipientName: recipient.name,
          event,
        });
        const result = await this.mail.sendPlain({
          to: recipient.email,
          subject,
          text,
          template: 'event-reminder',
        });
        if (!result.ok) {
          throw new Error(result.error ?? 'mail_send_failed');
        }
      } else {
        this.logger.warn(
          {
            channel,
            userId: recipient.userId,
            personId: recipient.personId,
            eventId: event.id,
          },
          'TODO: доставка через push не реализована',
        );
        return true;
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
          userId: recipient.userId,
          personId: recipient.personId,
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

  private buildEmailSubject(args: { eventTitle: string; startAt: Date }): string {
    const relative = this.formatRelative(new Date(), args.startAt);
    return `Напоминание: ${args.eventTitle} ${relative}`;
  }

  private buildEmailText(args: {
    recipientName: string;
    event: {
      id: string;
      title: string;
      startAt: Date;
      location: string | null;
      timezone: string;
    };
  }): string {
    const { recipientName, event } = args;
    const when = this.formatAbsolute(event.startAt, event.timezone);
    const where = event.location && event.location.trim() !== '' ? event.location : 'не указано';
    const link = `${this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '')}/events/${event.id}`;
    return [
      `Здравствуйте, ${recipientName}!`,
      '',
      `Напоминание о событии: ${event.title}`,
      `Когда: ${when}`,
      `Где: ${where}`,
      '',
      `Открыть событие: ${link}`,
      '',
      '— Кора',
    ].join('\n');
  }

  private formatRelative(now: Date, target: Date): string {
    const diffMs = target.getTime() - now.getTime();
    if (diffMs <= 0) return 'сейчас';
    const minutes = Math.round(diffMs / 60_000);
    if (minutes < 60) {
      return `через ${minutes} ${this.pluralMinutes(minutes)}`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `через ${hours} ${this.pluralHours(hours)}`;
    }
    const days = Math.round(hours / 24);
    if (days === 1) return 'завтра';
    return `через ${days} ${this.pluralDays(days)}`;
  }

  private formatAbsolute(date: Date, timezone: string): string {
    try {
      const formatter = new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone,
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `${formatter.format(date)} (${timezone})`;
    } catch {
      return `${date.toISOString()} (UTC)`;
    }
  }

  private pluralMinutes(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'минуту';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'минуты';
    return 'минут';
  }

  private pluralHours(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'час';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'часа';
    return 'часов';
  }

  private pluralDays(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
    return 'дней';
  }
}
