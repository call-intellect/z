import { timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational.service';

import { TelegramBotChannelAdapter } from './telegram-bot.adapter';
import type { TelegramUpdate } from './telegram.types';

/**
 * Webhook-приёмник Telegram Bot Updates для SBA β-1.
 *
 * URL: `POST /api/v1/webhooks/telegram-bot/:tenantId`.
 *
 * Авторизация (context7 verified 2026-05-22):
 *   - Telegram сам присылает `X-Telegram-Bot-Api-Secret-Token` (если webhook
 *     был зарегистрирован с `secret_token` в `setWebhook`). Сверяем
 *     timing-safe с `Channel.config.webhookSecret`.
 *   - На любой неуспех возвращаем 200 (Telegram не любит non-2xx и
 *     спамит retry'ями) — кроме откровенно невалидного payload'а.
 *
 * Marked `@ApiExcludeController` — это не публичный API, в Swagger не
 * показываем (паттерн `TelegramWebhookController` из `ingest/`).
 *
 * Tenant-resolution: `:tenantId` приходит в URL. Channel для tenant'а
 * + kind='telegram_bot' резолвится из БД; если канала нет или disabled —
 * 404 (Telegram перестанет слать).
 */
@ApiExcludeController()
@Controller('api/v1/webhooks/telegram-bot')
export class TelegramWebhooksController {
  private readonly logger = new Logger(TelegramWebhooksController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TelegramBotChannelAdapter)
    private readonly adapter: TelegramBotChannelAdapter,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  @Post(':tenantId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('tenantId') tenantId: string,
    @Body() body: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
  ): Promise<{ ok: true }> {
    // 1. Найти Channel.
    const channel = await this.prisma.channel.findUnique({
      where: { tenantId_kind: { tenantId, kind: 'telegram_bot' } },
    });
    if (!channel || channel.status !== 'active') {
      // Telegram будет ретраить — лучше отдать 404, чтобы заметить
      // (Telegram прекратит после нескольких 404 подряд).
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message: `Telegram-канал не настроен для tenant=${tenantId}`,
        },
      });
    }

    // 2. Verify secret.
    let expectedSecret: string;
    try {
      expectedSecret = this.adapter.readWebhookSecret(channel);
    } catch (err) {
      this.logger.error(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'telegram webhook: не удалось расшифровать webhookSecret',
      );
      throw new ForbiddenException({
        ok: false,
        error: { code: 'webhook_secret_unreadable' },
      });
    }
    if (
      !secretHeader ||
      !expectedSecret ||
      !constantTimeStringEqual(secretHeader, expectedSecret)
    ) {
      this.logger.warn(
        { tenantId, hasHeader: Boolean(secretHeader) },
        'telegram webhook: invalid secret header',
      );
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_webhook_secret' },
      });
    }

    // 3. Parse + dispatch.
    let inbound;
    try {
      inbound = await this.adapter.ingestUpdate({
        update: body,
        tenantId,
        channel,
      });
    } catch (err) {
      this.logger.error(
        {
          tenantId,
          updateId: body?.update_id,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram webhook: ingestUpdate failed',
      );
      // Возвращаем 200 — иначе Telegram засрёт retry'ями. Ошибка
      // зафиксирована в логе/метриках адаптера.
      return { ok: true };
    }

    if (!inbound) {
      return { ok: true };
    }

    try {
      await this.conversational.dispatchInbound(inbound);
    } catch (err) {
      this.logger.error(
        {
          tenantId,
          type: inbound.type,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram webhook: dispatchInbound failed',
      );
    }
    return { ok: true };
  }
}

/** Timing-safe сравнение строк (utf-8). */
function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return timingSafeEqual(ba, bb);
}
