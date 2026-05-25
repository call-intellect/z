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
import type { Channel } from '@prisma/client';

import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational.service';

import { TelegramBotChannelAdapter } from './telegram-bot.adapter';
import type { TelegramUpdate } from './telegram.types';

/**
 * Webhook-приёмник Telegram Bot Updates.
 *
 * URL'ы:
 *   - `POST /api/v1/webhooks/telegram-bot`           — β-9, основной
 *     путь после миграции на глобальный бот (`@kora_bot`).
 *     Лукапит `Channel WHERE tenantId IS NULL AND kind='telegram_bot'`.
 *   - `POST /api/v1/webhooks/telegram-bot/:tenantId` — legacy, оставлен
 *     на переходное окно (~30 дней) для старых per-tenant ботов. Пишет
 *     `logger.warn` про deprecation; затем переходит на тот же глобальный
 *     канал (если есть). Если глобального канала нет — пробует per-tenant
 *     `Channel` (старое поведение).
 *
 * Авторизация:
 *   - Telegram отправляет `X-Telegram-Bot-Api-Secret-Token` (если webhook
 *     зарегистрирован с `secret_token` в `setWebhook`). Сверяем timing-safe
 *     с `Channel.config.webhookSecret`.
 *   - На любой неуспех возвращаем 200 (Telegram спамит retry'ями на non-2xx)
 *     — кроме отсутствия канала / невалидного secret'а.
 *
 * `@ApiExcludeController` — это служебный endpoint, не публикуется в Swagger
 * (тот же паттерн, что у `TelegramWebhookController` из ingest/).
 */
@ApiExcludeController()
@Controller('api/v1/webhooks/telegram-bot')
export class TelegramWebhooksController {
  private readonly logger = new Logger(TelegramWebhooksController.name);

  /** Кэш глобального Channel'а — один на процесс. Сбрасывается при рестарте. */
  private globalChannelCache: Channel | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TelegramBotChannelAdapter)
    private readonly adapter: TelegramBotChannelAdapter,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * β-9 — Главный путь. Без `:tenantId` в URL. Лукапит глобальный
   * `Channel WHERE tenantId IS NULL AND kind='telegram_bot'`.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async receiveGlobal(
    @Body() body: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
  ): Promise<{ ok: true }> {
    const channel = await this.findGlobalChannel();
    if (!channel || channel.status !== 'active') {
      // Глобального канала ещё нет / выключен главным админом. Telegram
      // получит 404 — после нескольких подряд он сам прекратит слать.
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'global_channel_not_configured',
          message:
            'Глобальный Telegram-канал ещё не настроен или выключен главным администратором.',
        },
      });
    }

    this.metrics.incTelegramBotGlobalWebhookReceived({
      type: body?.edited_message ? 'edited_message' : body?.message ? 'message' : 'unknown',
    });

    return this.processUpdate({
      channel,
      body,
      secretHeader,
      tenantId: undefined,
    });
  }

  /**
   * Legacy путь с `:tenantId` в URL. Оставлен на переходное окно ~30 дней.
   *
   * Поведение:
   *   1. Сначала пытается найти глобальный канал — если он есть, использует
   *      его (без учёта `:tenantId`). Пишет warn про deprecation один раз
   *      на процесс (`globalChannelCache` — флажок).
   *   2. Если глобального нет — fallback на старое поведение: ищет
   *      `Channel WHERE tenantId=:tenantId AND kind='telegram_bot'`.
   */
  @Post(':tenantId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('tenantId') tenantId: string,
    @Body() body: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
  ): Promise<{ ok: true }> {
    // 1. Сначала пытаемся через глобальный канал.
    const globalChannel = await this.findGlobalChannel();
    if (globalChannel && globalChannel.status === 'active') {
      this.logger.warn(
        { tenantId },
        'telegram webhook: legacy endpoint `/:tenantId` deprecated — переход на глобальный канал. Перенастройте webhook на `POST /api/v1/webhooks/telegram-bot` без `:tenantId`.',
      );
      this.metrics.incTelegramBotGlobalWebhookReceived({
        type: body?.edited_message ? 'edited_message' : body?.message ? 'message' : 'unknown',
      });
      return this.processUpdate({
        channel: globalChannel,
        body,
        secretHeader,
        // Игнорируем `:tenantId` из URL — резолвим из Membership отправителя.
        tenantId: undefined,
      });
    }

    // 2. Fallback на старое поведение — per-tenant Channel.
    const channel = await this.prisma.channel.findUnique({
      where: { tenantId_kind: { tenantId, kind: 'telegram_bot' } },
    });
    if (!channel || channel.status !== 'active') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message: `Telegram-канал не настроен для tenant=${tenantId}`,
        },
      });
    }
    return this.processUpdate({
      channel,
      body,
      secretHeader,
      tenantId,
    });
  }

  // ─────────────────────────────── helpers ──────────────────────────

  /** Лукап глобального канала с in-process кэшем (TTL = жизни процесса). */
  private async findGlobalChannel(): Promise<Channel | null> {
    if (this.globalChannelCache) return this.globalChannelCache;
    // Prisma не умеет фильтровать по `tenantId IS NULL` через composite
    // unique-where с null, поэтому используем findFirst.
    const channel = await this.prisma.channel.findFirst({
      where: { tenantId: null, kind: 'telegram_bot' },
    });
    if (channel) {
      this.globalChannelCache = channel;
    }
    return channel;
  }

  /** Общая обработка после резолва канала: verify secret + dispatch. */
  private async processUpdate(args: {
    channel: Channel;
    body: TelegramUpdate;
    secretHeader: string | undefined;
    tenantId: string | undefined;
  }): Promise<{ ok: true }> {
    // 1. Verify secret.
    let expectedSecret: string;
    try {
      expectedSecret = this.adapter.readWebhookSecret(args.channel);
    } catch (err) {
      this.logger.error(
        {
          channelId: args.channel.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram webhook: не удалось расшифровать webhookSecret',
      );
      throw new ForbiddenException({
        ok: false,
        error: { code: 'webhook_secret_unreadable' },
      });
    }
    if (
      !args.secretHeader ||
      !expectedSecret ||
      !constantTimeStringEqual(args.secretHeader, expectedSecret)
    ) {
      this.logger.warn(
        { channelId: args.channel.id, hasHeader: Boolean(args.secretHeader) },
        'telegram webhook: invalid secret header',
      );
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_webhook_secret' },
      });
    }

    // 2. Parse + dispatch.
    let inbound;
    try {
      inbound = await this.adapter.ingestUpdate({
        update: args.body,
        tenantId: args.tenantId,
        channel: args.channel,
      });
    } catch (err) {
      this.logger.error(
        {
          channelId: args.channel.id,
          updateId: args.body?.update_id,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram webhook: ingestUpdate failed',
      );
      // 200 чтобы Telegram не ретраил.
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
          channelId: args.channel.id,
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
