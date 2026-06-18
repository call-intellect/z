import { timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { TypedConfigService } from '../../../../common/config';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';
import { ConversationalService } from '../../conversational.service';
import { AssistantInboundQueueService } from '../../queue/assistant-inbound-queue.service';

import { MaxBotChannelAdapter } from './max-bot.adapter';
import type { MaxUpdate } from './max.types';

@ApiExcludeController()
@Controller('api/v1/webhooks/max-bot')
export class MaxWebhooksController {
  private readonly logger = new Logger(MaxWebhooksController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MaxBotChannelAdapter)
    private readonly adapter: MaxBotChannelAdapter,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AssistantInboundQueueService)
    private readonly inboundQueue: AssistantInboundQueueService,
  ) {}

  @Post(':tenantId/:secret')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('tenantId') tenantId: string,
    @Param('secret') secretFromUrl: string,
    @Body() body: MaxUpdate,
  ): Promise<{ ok: true }> {
    const startedAt = Date.now();
    const channel = await this.prisma.channel.findUnique({
      where: { tenantId_kind: { tenantId, kind: 'max_bot' } },
    });
    if (!channel || channel.status !== 'active') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message: `MAX-канал не настроен для tenant=${tenantId}`,
        },
      });
    }

    let expectedSecret: string;
    try {
      expectedSecret = this.adapter.readWebhookSecret(channel);
    } catch (err) {
      this.logger.error(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'max webhook: не удалось расшифровать webhookSecret',
      );
      throw new ForbiddenException({
        ok: false,
        error: { code: 'webhook_secret_unreadable' },
      });
    }
    if (!expectedSecret || !constantTimeStringEqual(secretFromUrl, expectedSecret)) {
      this.logger.warn({ tenantId }, 'max webhook: invalid secret in URL');
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_webhook_secret' },
      });
    }

    // (Ф1) Идемпотентность по mid (Message ID): у MAX нет update_id, ретраи
    // доставки распознаём по body.message.body.mid. Повтор не переобрабатываем.
    const mid = body?.message?.body?.mid;
    if (mid) {
      const dedupeKey = `max:update:${channel.id}:${mid}`;
      try {
        const res = await this.redis.client.set(dedupeKey, '1', 'EX', 3600, 'NX');
        if (res === null) {
          this.logger.debug(
            { tenantId, channelId: channel.id, mid },
            'max webhook: дубль mid — пропущен (idempotency)',
          );
          return { ok: true };
        }
      } catch (err) {
        // Redis недоступен → fail-open (обрабатываем), чтобы не потерять сообщение.
        this.logger.warn(
          { tenantId, channelId: channel.id, mid, err: err instanceof Error ? err.message : String(err) },
          'max webhook: дедуп mid недоступен (Redis) — обрабатываем без дедупа',
        );
      }
    } else {
      this.logger.warn(
        { tenantId, channelId: channel.id },
        'max webhook: mid отсутствует — обработка без дедупа',
      );
    }

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
          updateType: body?.update_type,
          err: err instanceof Error ? err.message : String(err),
        },
        'max webhook: ingestUpdate failed',
      );
      return { ok: true };
    }

    if (!inbound) return { ok: true };

    const dedupeId = mid ? `${channel.id}:${mid}` : undefined;
    if (this.cfg.bot.assistantInboundAsyncEnabled) {
      // Ранний ACK: enqueue + сразу 200 (обработка фоновым воркером
      // assistant.inbound). При сбое enqueue — синхронный fallback.
      try {
        await this.inboundQueue.enqueue({ inbound, ...(dedupeId ? { dedupeId } : {}) });
        this.logger.log(
          { tenantId, channelId: channel.id, mid, type: inbound.type, ackMs: Date.now() - startedAt },
          'max webhook: enqueued (early-ack)',
        );
        return { ok: true };
      } catch (err) {
        this.logger.error(
          { tenantId, channelId: channel.id, err: err instanceof Error ? err.message : String(err) },
          'max webhook: enqueue упал — синхронный fallback',
        );
      }
    }
    // Синхронный путь (флаг OFF или fallback после сбоя enqueue).
    try {
      await this.conversational.dispatchInbound(inbound);
    } catch (err) {
      this.logger.error(
        {
          tenantId,
          type: inbound.type,
          err: err instanceof Error ? err.message : String(err),
        },
        'max webhook: dispatchInbound failed',
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
