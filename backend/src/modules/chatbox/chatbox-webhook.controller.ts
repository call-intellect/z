import { timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

/**
 * Inbound webhook-приёмник ChatBox (ТЗ 2026-06-05, Фаза 4).
 *
 * URL: `POST /api/v1/webhooks/chatbox/:tenantId/:secret`. ChatBox шлёт сюда
 * события чатов/сообщений/клиентов; secret в path — shared-secret (сравнивается
 * с `ChatboxIntegration.webhookSecret` через timingSafeEqual).
 *
 * Любое событие → точечный `incremental`-добор через очередь (дедуп по jobId
 * схлопнёт бурст). БЕЗ авторизации (внешний вызов от ChatBox).
 *
 * На любую внутреннюю ошибку (кроме явного Forbidden) — возвращаем 200, чтобы
 * ChatBox не зацикливал ретраи.
 */
@ApiExcludeController()
@Controller('api/v1/webhooks/chatbox')
export class ChatboxWebhookController {
  private readonly logger = new Logger(ChatboxWebhookController.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxSyncQueueService)
    private readonly queue: ChatboxSyncQueueService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
  ) {}

  @Post(':tenantId/:secret')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('tenantId') tenantId: string,
    @Param('secret') secret: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const integration = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
      select: { webhookSecret: true },
    });
    if (!integration || !integration.webhookSecret) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'chatbox_webhook_not_configured' },
      });
    }

    if (!constantTimeEqual(secret, integration.webhookSecret)) {
      this.logger.warn({ tenantId }, 'chatbox webhook: invalid secret in URL');
      throw new ForbiddenException({
        ok: false,
        error: { code: 'chatbox_webhook_invalid_secret' },
      });
    }

    // С этого момента — best-effort: любая ошибка → 200 (ChatBox дублирует ретраи).
    try {
      const enabled =
        (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true;
      if (!enabled) {
        this.logger.debug(
          { tenantId },
          'chatbox webhook: chatbox.enabled=false — no-op',
        );
        return { ok: true };
      }

      const event = extractEvent(body);
      this.logger.debug(
        { tenantId, event: event ?? 'unknown' },
        'chatbox webhook: enqueue incremental',
      );
      await this.queue.enqueue(tenantId, 'incremental');
    } catch (err) {
      this.logger.error(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'chatbox webhook: обработка не удалась — отвечаю 200',
      );
    }

    return { ok: true };
  }
}

/** Constant-time сравнение строк (разная длина → false, без timing-утечки). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Осторожно достаёт `event` из тела `{event, data}`; не падает на чужой форме. */
function extractEvent(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const ev = (body as Record<string, unknown>)['event'];
    if (typeof ev === 'string') return ev;
  }
  return undefined;
}
