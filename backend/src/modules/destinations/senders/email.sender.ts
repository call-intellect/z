import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationDestination } from '@prisma/client';

import { MailService } from '../../mail/mail.service';
import type { EmailConfig } from '../dto/destination.dto';

import type { DestinationSender, SenderMessage } from './sender.types';

@Injectable()
export class EmailSender implements DestinationSender {
  readonly type = 'email';

  constructor(@Inject(MailService) private readonly mail: MailService) {}

  async send(destination: IntegrationDestination, message: SenderMessage): Promise<void> {
    const cfg = destination.config as unknown as EmailConfig;
    const result = await this.mail.sendPlain({
      to: cfg.recipient_email,
      subject: message.title,
      text: message.body,
      template: 'destination-email',
    });
    if (!result.ok) {
      throw new Error(`email sender: ${result.error ?? 'unknown'}`);
    }
  }
}
