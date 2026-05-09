import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationDestination } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { EncryptionService } from '../../security/encryption.service';
import type { TelegramConfig } from '../dto/destination.dto';

import type { DestinationSender, SenderMessage } from './sender.types';

@Injectable()
export class TelegramBotSender implements DestinationSender {
  readonly type = 'telegram_bot';

  constructor(
    @Inject(EncryptionService) private readonly encryption: EncryptionService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async send(destination: IntegrationDestination, message: SenderMessage): Promise<void> {
    const cfg = destination.config as unknown as TelegramConfig & { bot_token_encrypted?: string };
    const token = cfg.bot_token_encrypted
      ? this.encryption.decrypt(cfg.bot_token_encrypted)
      : cfg.bot_token;
    if (!token) {
      throw new Error('telegram sender: пустой bot_token');
    }
    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
    const body = JSON.stringify({
      chat_id: cfg.chat_id,
      text: `*${message.title}*\n${message.body}`,
      parse_mode: 'Markdown',
    });
    // Telegram API публичный — SSRF-проверка не нужна (хост хардкодим).
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.cfg.webhooksOut.deliveryTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: ac.signal,
      });
      if (res.status < 200 || res.status >= 300) {
        const text = (await res.text().catch(() => '')).slice(0, 500);
        throw new Error(`telegram sender: HTTP ${res.status} ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
