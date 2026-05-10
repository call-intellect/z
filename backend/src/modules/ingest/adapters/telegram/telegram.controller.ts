import { timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { IngestService } from '../../ingest.service';

import { TelegramAdapterService } from './telegram.service';

/**
 * Webhook-контроллер Telegram (Фаза 10 knowledge-core).
 *
 * `POST /api/v1/ingest/telegram/:sourceId` — endpoint для Telegram Bot API
 * Update'ов. Авторизация:
 *   - НЕ через `IngestTokenGuard` (Telegram не передаёт `Authorization`).
 *   - Через `X-Telegram-Bot-Api-Secret-Token` header (timing-safe сравнение
 *     с `Source.config.webhookSecret`).
 *
 * Telegram не любит non-2xx — на любом «не подходит» возвращаем 200 без ingest'а.
 *
 * FIXME knowledge-core Фаза 12: добавить @RequireEntitlement('feature.adapter_telegram').
 */
@ApiExcludeController()
@Controller('api/v1/ingest/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  /** Лимит размера payload — 4 MiB. */
  private static readonly PAYLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

  constructor(
    @Inject(TelegramAdapterService) private readonly telegram: TelegramAdapterService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  @Post(':sourceId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('sourceId') sourceId: string,
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
    @Req() req: Request,
  ): Promise<{ ok: true; idempotent?: boolean }> {
    const { source, config } = await this.telegram.loadActiveBotSource(sourceId);

    // 1. Проверка secret-токена.
    if (!secretHeader || !constantTimeStringEqual(secretHeader, config.webhookSecret)) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_webhook_secret' },
      });
    }

    // 2. Лимит размера. `req.headers['content-length']` — самое быстрое.
    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader) {
      const cl = Number(contentLengthHeader);
      if (Number.isFinite(cl) && cl > TelegramWebhookController.PAYLOAD_LIMIT_BYTES) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'payload_too_large', message: `Payload >${TelegramWebhookController.PAYLOAD_LIMIT_BYTES} bytes` },
        });
      }
    }

    // 3. Извлекаем сообщение (поддержим message и channel_post).
    const msg = update.message ?? update.channel_post;
    if (!msg) {
      // Update без message (edit/callback и т.п.) — игнорируем тихо.
      return { ok: true };
    }

    // 4. Фильтр allowedChatIds.
    if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(msg.chat.id)) {
      this.logger.debug(
        { sourceId, chatId: msg.chat.id },
        'telegram: chat не в allowedChatIds — пропускаем',
      );
      return { ok: true };
    }

    // 5. Фильтр forwarded.
    const isForwarded = Boolean(
      msg.forward_from || msg.forward_from_chat || msg.forward_origin,
    );
    if (!config.includeForwarded && isForwarded) {
      this.logger.debug({ sourceId, chatId: msg.chat.id }, 'telegram: forward пропущен');
      return { ok: true };
    }

    // 6. Формируем payload и ingest.
    const photoFileIds: string[] = Array.isArray(msg.photo)
      ? msg.photo.map((p) => p.file_id).filter(Boolean)
      : [];
    const payload = {
      updateId: update.update_id,
      chatId: msg.chat.id,
      chatTitle: msg.chat.title ?? msg.chat.username ?? null,
      messageId: msg.message_id,
      fromUserId: msg.from?.id ?? null,
      fromUsername: msg.from?.username ?? null,
      fromName:
        msg.from?.first_name || msg.from?.last_name
          ? `${msg.from?.first_name ?? ''} ${msg.from?.last_name ?? ''}`.trim()
          : null,
      text: msg.text ?? msg.caption ?? '',
      photoFileIds,
      date: msg.date,
      raw: update,
    };
    const sourceExternalId = `tg:${msg.chat.id}:${msg.message_id}`;
    const occurredAt = new Date(msg.date * 1000);

    const result = await this.ingest.ingest({
      tenantId: source.tenantId,
      sourceId: source.id,
      sourceExternalId,
      occurredAt,
      payload,
      dataClass: source.dataClass,
    });
    return { ok: true, idempotent: result.idempotent };
  }
}

interface TelegramChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
}

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  forward_from?: TelegramUser;
  forward_from_chat?: TelegramChat;
  forward_origin?: unknown;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return timingSafeEqual(ba, bb);
}
