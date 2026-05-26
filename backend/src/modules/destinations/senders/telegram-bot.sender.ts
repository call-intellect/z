import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationDestination } from '@prisma/client';

import { TelegramApiClient } from '../../conversational/adapters/telegram-bot/telegram-api-client';
import { EncryptionService } from '../../security/encryption.service';
import type { TelegramConfig } from '../dto/destination.dto';

import type { DestinationSender, SenderMessage } from './sender.types';

/**
 * `destination.type = telegram_bot` — отправка уведомления в произвольный
 * чат через токен бота, заведённый пользователем-владельцем destination'а.
 *
 * 2026-05-26 (ТЗ plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §2):
 * транспорт идёт через единый `TelegramApiClient` — он сам решает,
 * пускать через прокси `telegram.crossmark.ru` или прямой `api.telegram.org`
 * (на основании `TELEGRAM_PROXY_ENABLED`). Это убирает дублирование
 * `fetch('https://api.telegram.org/...')` в трёх местах и даёт единые
 * метрики (`telegram_proxy_request_total`).
 *
 * Замечание: прокси crossmark пропускает только зарегистрированные в нём
 * боты. Если у клиента-владельца destination'а свой бот, не известный
 * прокси — outbound вернёт 401/403. В таком случае оператор должен либо
 * зарегистрировать токен в прокси, либо временно выставить
 * `TELEGRAM_PROXY_ENABLED=false` (см. ТЗ §13 «rollback»). Это известная
 * деградация на старте; в нашем основном flow (kora_bot) она не
 * проявляется.
 */
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
