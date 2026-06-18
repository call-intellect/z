import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationDestination } from '@prisma/client';

import { TelegramApiClient } from '../../conversational/adapters/telegram-bot/telegram-api-client';
import { EncryptionService } from '../../security/encryption.service';
import type { TelegramConfig } from '../dto/destination.dto';

import type { DestinationSender, SenderMessage } from './sender.types';

@Injectable()
export class TelegramBotSender implements DestinationSender {
  readonly type = 'telegram_bot';

  constructor(
    @Inject(EncryptionService) private readonly encryption: EncryptionService,
    @Inject(TelegramApiClient) private readonly tgApi: TelegramApiClient,
  ) {}

  async send(destination: IntegrationDestination, message: SenderMessage): Promise<void> {
    const cfg = destination.config as unknown as TelegramConfig & { bot_token_encrypted?: string };
    const token = cfg.bot_token_encrypted
      ? this.encryption.decrypt(cfg.bot_token_encrypted)
      : cfg.bot_token;
    if (!token) {
      throw new Error('telegram sender: пустой bot_token');
    }
    await this.tgApi.sendMessage({
      token,
      chatId: cfg.chat_id,
      text: `<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.body)}`,
      parseMode: 'HTML',
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
