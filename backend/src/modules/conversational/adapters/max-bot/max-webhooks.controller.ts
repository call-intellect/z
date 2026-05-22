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

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational.service';

import { MaxBotChannelAdapter } from './max-bot.adapter';
import type { MaxUpdate } from './max.types';

/**
 * Webhook-приёмник MAX Bot Updates для SBA β-1.
 *
 * URL: `POST /api/v1/webhooks/max-bot/:tenantId/:secret`.
 *
 * MAX Bot API (dev.max.ru/docs-api, context7 verified 2026-05-22) НЕ
 * передаёт header-secret. Secret-валидация — через path-параметр (URL
 * сам по себе является shared-secret). `setup-max-bot.ts` использует
 * этот же формат при `POST /subscriptions`.
 *
 * На любой неуспех — лучше вернуть 200, чем 5xx (MAX дублирует
 * notification'ы при ошибках). Кроме явных Forbidden/NotFound.
 */
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
  ) {}

  @Post(':tenantId/:secret')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('tenantId') tenantId: string,
    @Param('secret') secretFromUrl: string,
    @Body() body: MaxUpdate,
  ): Promise<{ ok: true }> {
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
    if (
      !expectedSecret ||
      !constantTimeStringEqual(secretFromUrl, expectedSecret)
    ) {
      this.logger.warn({ tenantId }, 'max webhook: invalid secret in URL');
      throw new ForbiddenException({
        ok: false,
        error: { code: 'invalid_webhook_secret' },
      });
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
