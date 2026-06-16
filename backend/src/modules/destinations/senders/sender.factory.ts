import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationDestination } from '@prisma/client';

import { EmailSender } from './email.sender';
import { GenericWebhookSender } from './generic-webhook.sender';
import type { DestinationSender, SenderMessage } from './sender.types';
import { SlackWebhookSender } from './slack-webhook.sender';
import { TelegramBotSender } from './telegram-bot.sender';

@Injectable()
export class SenderFactory {
  constructor(
    @Inject(EmailSender) private readonly email: EmailSender,
    @Inject(SlackWebhookSender) private readonly slack: SlackWebhookSender,
    @Inject(TelegramBotSender) private readonly telegram: TelegramBotSender,
    @Inject(GenericWebhookSender) private readonly generic: GenericWebhookSender,
  ) {}

  resolve(type: IntegrationDestination['type']): DestinationSender {
    switch (type) {
      case 'email':
        return this.email;
      case 'slack_webhook':
        return this.slack;
      case 'telegram_bot':
        return this.telegram;
      case 'generic_webhook':
        return this.generic;
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown destination type: ${String(_exhaustive)}`);
      }
    }
  }

  async send(destination: IntegrationDestination, message: SenderMessage): Promise<void> {
    return this.resolve(destination.type).send(destination, message);
  }
}
