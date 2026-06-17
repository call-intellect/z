import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  Channel,
  ChannelBinding,
  ChannelKind,
  DataClass,
  Notification,
  NotificationDelivery,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { MailService } from '../../mail/mail.service';
import { ChannelRegistry } from '../channel-registry';
import type { IChannel } from '../types/channel.types';

@Injectable()
export class EmailSmtpChannelAdapter implements IChannel, OnModuleInit {
  private readonly logger = new Logger(EmailSmtpChannelAdapter.name);
  readonly kind: ChannelKind = 'email_smtp';
  readonly maxDataClass: DataClass = 'internal';

  constructor(
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async send(args: {
    delivery: NotificationDelivery;
    notification: Notification;
    binding: ChannelBinding;
    channel: Channel;
  }): Promise<{ externalMessageId: string | null }> {
    const { notification, binding } = args;
    const to = binding.externalId;
    if (!to || !to.includes('@')) {
      throw new Error(
        `EmailSmtpChannelAdapter.send: невалидный email-адрес "${to}" для binding=${binding.id}`,
      );
    }

    const subject = this.subjectFor(notification);
    const text = this.renderPlainText(notification);

    const result = await this.mail.sendPlain({
      to,
      subject,
      text,
      template: `conversational/${notification.eventType}`,
    });

    if (!result.ok) {
      throw new Error(`smtp_failed: ${result.error ?? 'unknown'}`);
    }

    return { externalMessageId: null };
  }

  private subjectFor(notification: Notification): string {
    switch (notification.eventType) {
      case 'probe.question':
        return 'Кора спрашивает: уточнение по знаниям компании';
      case 'curation.pending':
        return 'Кора: нужна ваша модерация';
      case 'system.message':
        return 'Кора — уведомление';
      default:
        return `Кора — уведомление (${notification.eventType})`;
    }
  }

  private renderPlainText(notification: Notification): string {
    const frontend = this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '');
    const deepLink = `${frontend}/me/notifications/${notification.id}`;

    const payload = notification.payload as Record<string, unknown> | null;
    const lines: string[] = [];

    switch (notification.eventType) {
      case 'probe.question': {
        const q = (payload?.['question'] as string | undefined) ?? '';
        const ctx = (payload?.['context'] as string | undefined) ?? '';
        lines.push('Здравствуйте!', '');
        lines.push('Кора нашла пробел в памяти компании и просит вас уточнить:');
        lines.push('');
        if (q) lines.push(`Вопрос: ${q}`);
        if (ctx) {
          lines.push('');
          lines.push(`Контекст: ${ctx}`);
        }
        lines.push('');
        lines.push(`Ответить можно здесь: ${deepLink}`);
        break;
      }
      case 'curation.pending': {
        const summary = (payload?.['summary'] as string | undefined) ?? '';
        const resourceType = (payload?.['resourceType'] as string | undefined) ?? '';
        lines.push('Здравствуйте!', '');
        lines.push('Появилась карточка, которой нужна ваша модерация.');
        if (resourceType) lines.push(`Тип карточки: ${resourceType}`);
        if (summary) {
          lines.push('');
          lines.push(summary);
        }
        lines.push('');
        lines.push(`Открыть карточку: ${deepLink}`);
        break;
      }
      case 'system.message': {
        const title = (payload?.['title'] as string | undefined) ?? '';
        const body = (payload?.['body'] as string | undefined) ?? '';
        if (title) lines.push(title, '');
        if (body) lines.push(body, '');
        lines.push(`Подробности: ${deepLink}`);
        break;
      }
      default: {
        lines.push('Здравствуйте!', '');
        lines.push(`Новое событие в Коре: ${notification.eventType}`);
        lines.push('');
        lines.push(`Подробности: ${deepLink}`);
      }
    }

    lines.push('', '—', 'Кора — память компании.');
    return lines.join('\n');
  }
}
