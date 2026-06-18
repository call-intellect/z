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
  type OnModuleDestroy,
  type OnModuleInit,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Channel } from '@prisma/client';
import type { Redis } from 'ioredis';

import { TypedConfigService } from '../../../../common/config';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';
import { ConversationalService } from '../../conversational.service';
import { AssistantInboundQueueService } from '../../queue/assistant-inbound-queue.service';
import { TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC } from '../../topics';

import { TelegramBotChannelAdapter } from './telegram-bot.adapter';
import type { TelegramUpdate } from './telegram.types';

@ApiExcludeController()
@Controller('api/v1/webhooks/telegram-bot')
export class TelegramWebhooksController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramWebhooksController.name);

  private globalChannelCache: Channel | null = null;

  private subscriber: Redis | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TelegramBotChannelAdapter)
    private readonly adapter: TelegramBotChannelAdapter,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(RedisService)
    private readonly redis: RedisService,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
    @Inject(AssistantInboundQueueService)
    private readonly inboundQueue: AssistantInboundQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.subscriber = this.redis.client.duplicate();
      await this.subscriber.subscribe(TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC);
      this.subscriber.on('message', (channel) => {
        if (channel === TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC) {
          this.globalChannelCache = null;
          this.logger.log('telegram webhook: globalChannelCache сброшен по pub/sub-сигналу');
        }
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram webhook: не удалось подписаться на pub/sub — invalidation кэша работать не будет (рестарт нужен)',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    try {
      await this.subscriber.quit();
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram webhook: ошибка при закрытии subscriber',
      );
    } finally {
      this.subscriber = null;
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receiveGlobal(
    @Body() body: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
  ): Promise<{ ok: true }> {
    const channel = await this.findGlobalChannel();
    if (!channel || channel.status !== 'active') {
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
      providedSecret: secretHeader,
      tenantId: undefined,
    });
  }

  @Post('s/:secret')
  @HttpCode(HttpStatus.OK)
  async receiveViaProxy(
    @Param('secret') secret: string,
    @Body() body: TelegramUpdate,
  ): Promise<{ ok: true }> {
    const channel = await this.findGlobalChannel();
    if (!channel || channel.status !== 'active') {
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
      providedSecret: secret,
      tenantId: undefined,
    });
  }

  @Post(':tenantId')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('tenantId') tenantId: string,
    @Body() body: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
  ): Promise<{ ok: true }> {
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
        providedSecret: secretHeader,
        tenantId: undefined,
      });
    }

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
      providedSecret: secretHeader,
      tenantId,
    });
  }

  private async findGlobalChannel(): Promise<Channel | null> {
    if (this.globalChannelCache) return this.globalChannelCache;
    const channel = await this.prisma.channel.findFirst({
      where: { tenantId: null, kind: 'telegram_bot' },
    });
    if (channel) {
      this.globalChannelCache = channel;
    }
    return channel;
  }

  private async processUpdate(args: {
    channel: Channel;
    body: TelegramUpdate;
    providedSecret: string | undefined;
    tenantId: string | undefined;
  }): Promise<{ ok: true }> {
    const startedAt = Date.now();
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
      !args.providedSecret ||
      !expectedSecret ||
      !constantTimeStringEqual(args.providedSecret, expectedSecret)
    ) {
      this.logger.warn(
        { channelId: args.channel.id, hasSecret: Boolean(args.providedSecret) },
        'telegram webhook: invalid webhook secret',
      );
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_webhook_secret' },
      });
    }

    const updateId = args.body?.update_id;
    if (updateId != null && Number.isFinite(updateId)) {
      const dedupeKey = `tg:update:${args.channel.id}:${updateId}`;
      try {
        const res = await this.redis.client.set(dedupeKey, '1', 'EX', 3600, 'NX');
        if (res === null) {
          this.logger.debug(
            { channelId: args.channel.id, updateId },
            'telegram webhook: дубль update_id — пропущен (idempotency)',
          );
          return { ok: true };
        }
      } catch (err) {
        this.logger.warn(
          { channelId: args.channel.id, updateId, err: err instanceof Error ? err.message : String(err) },
          'telegram webhook: дедуп update_id недоступен (Redis) — обрабатываем без дедупа',
        );
      }
    } else {
      this.logger.warn(
        { channelId: args.channel.id },
        'telegram webhook: update_id отсутствует/невалиден — обработка без дедупа',
      );
    }

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
      return { ok: true };
    }

    if (!inbound) {
      return { ok: true };
    }

    const dedupeId = updateId != null && Number.isFinite(updateId)
      ? `${args.channel.id}:${updateId}`
      : undefined;
    if (this.cfg.bot.assistantInboundAsyncEnabled) {
      try {
        await this.inboundQueue.enqueue({ inbound, ...(dedupeId ? { dedupeId } : {}) });
        this.logger.log(
          { channelId: args.channel.id, updateId, type: inbound.type, ackMs: Date.now() - startedAt },
          'telegram webhook: enqueued (early-ack)',
        );
        return { ok: true };
      } catch (err) {
        this.logger.error(
          { channelId: args.channel.id, err: err instanceof Error ? err.message : String(err) },
          'telegram webhook: enqueue упал — синхронный fallback',
        );
      }
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

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return timingSafeEqual(ba, bb);
}
