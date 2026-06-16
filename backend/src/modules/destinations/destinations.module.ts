import { Global, Module } from '@nestjs/common';

import { DestinationsController } from './destinations.controller';
import { DestinationsRepository } from './destinations.repository';
import { DestinationsService } from './destinations.service';
import { IntegrationDestinationsSenderService } from './integration-destinations-sender.service';
import { EmailSender } from './senders/email.sender';
import { GenericWebhookSender } from './senders/generic-webhook.sender';
import { SenderFactory } from './senders/sender.factory';
import { SlackWebhookSender } from './senders/slack-webhook.sender';
import { TelegramBotSender } from './senders/telegram-bot.sender';

@Global()
@Module({
  controllers: [DestinationsController],
  providers: [
    DestinationsService,
    DestinationsRepository,
    SenderFactory,
    EmailSender,
    SlackWebhookSender,
    TelegramBotSender,
    GenericWebhookSender,
    IntegrationDestinationsSenderService,
  ],
  exports: [DestinationsService, SenderFactory, IntegrationDestinationsSenderService],
})
export class DestinationsModule {}
