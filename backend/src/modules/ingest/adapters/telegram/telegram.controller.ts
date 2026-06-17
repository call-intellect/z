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

@ApiExcludeController()
@Controller('api/v1/ingest/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

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

    if (!secretHeader || !constantTimeStringEqual(secretHeader, config.webhookSecret)) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_webhook_secret' },
      });
    }

    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader) {
      const cl = Number(contentLengthHeader);
      if (Number.isFinite(cl) && cl > TelegramWebhookController.PAYLOAD_LIMIT_BYTES) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'payload_too_large',
            message: `Payload >${TelegramWebhookController.PAYLOAD_LIMIT_BYTES} bytes`,
          },
        });
      }
    }

    const msg = update.message ?? update.channel_post;
    if (!msg) {
      return { ok: true };
    }

    if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(msg.chat.id)) {
      this.logger.debug(
        { sourceId, chatId: msg.chat.id },
        'telegram: chat не в allowedChatIds — пропускаем',
      );
      return { ok: true };
    }

    const isForwarded = Boolean(msg.forward_from || msg.forward_from_chat || msg.forward_origin);
    if (!config.includeForwarded && isForwarded) {
      this.logger.debug({ sourceId, chatId: msg.chat.id }, 'telegram: forward пропущен');
      return { ok: true };
    }

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
