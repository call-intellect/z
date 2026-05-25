import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import { AdminBotsService } from './admin-bots.service';
import { SetWebhookSchema, type SetWebhookDto } from './dto/admin-bots.dto';

/**
 * Admin-redesign Фаза 6 — `AdminBotsController`.
 *
 * UI Z-Admin `/admin/integrations/bots` — управление conversational-ботами:
 *   - Telegram (глобальный): статус, set/delete webhook;
 *   - MAX (глобальный): статус, subscribe/unsubscribe webhook;
 *   - Email IMAP-inbox: read-only снапшот ENV + test-connect (TODO).
 *
 * Все эндпоинты — `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor` (compliance: каждый вызов фиксируется в
 * `SuperAdminAccessLog`).
 *
 * NB: глобальный токен бота продолжает редактироваться через
 * `/admin/system/telegram-bot` (β-9). Этот контроллер — для управления
 * **webhook'ом** и сводным статусом из нового раздела «Интеграции».
 */
@ApiTags('admin-integrations-bots')
@Controller('api/v1/admin/integrations/bots')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminBotsController {
  constructor(
    @Inject(AdminBotsService) private readonly svc: AdminBotsService,
  ) {}

  // ───────────────────────── telegram ──────────────────────────────────

  @Get('telegram')
  @ApiOperation({
    summary:
      'Статус глобального Telegram-бота: токен (masked), webhook URL, rate-limit, тихие часы.',
  })
  getTelegram() {
    return this.svc.getTelegramStatus();
  }

  @Post('telegram/set-webhook')
  @ApiOperation({
    summary:
      'Установить webhook Telegram. Если URL не передан — собирается из PUBLIC_FRONTEND_URL.',
  })
  setTelegramWebhook(
    @Body(new ZodValidationPipe(SetWebhookSchema)) dto: SetWebhookDto,
  ) {
    return this.svc.setTelegramWebhook({
      ...(dto.url ? { url: dto.url } : {}),
    });
  }

  @Post('telegram/delete-webhook')
  @ApiOperation({ summary: 'Снять webhook Telegram (deleteWebhook).' })
  deleteTelegramWebhook() {
    return this.svc.deleteTelegramWebhook();
  }

  // ───────────────────────── max ───────────────────────────────────────

  @Get('max')
  @ApiOperation({
    summary:
      'Статус глобального MAX-бота: accessToken (masked), webhook URL, rate-limit.',
  })
  getMax() {
    return this.svc.getMaxStatus();
  }

  @Post('max/set-webhook')
  @ApiOperation({
    summary:
      'Подписать MAX-бот на webhook (subscribeWebhook). URL по умолчанию — /api/v1/webhooks/max-bot.',
  })
  setMaxWebhook(
    @Body(new ZodValidationPipe(SetWebhookSchema)) dto: SetWebhookDto,
  ) {
    return this.svc.setMaxWebhook({
      ...(dto.url ? { url: dto.url } : {}),
    });
  }

  @Post('max/delete-webhook')
  @ApiOperation({ summary: 'Отписать MAX-бот от webhook (unsubscribeWebhook).' })
  deleteMaxWebhook() {
    return this.svc.deleteMaxWebhook();
  }

  // ───────────────────────── email-inbox ───────────────────────────────

  @Get('email-inbox')
  @ApiOperation({
    summary:
      'Read-only снимок ENV-настроек IMAP-инбокса (host/port/user/folder/cron).',
  })
  getEmailInbox() {
    return this.svc.getEmailInboxStatus();
  }

  @Post('email-inbox/test-connection')
  @ApiOperation({
    summary:
      'Попытаться установить IMAP-соединение и распечатать greeting (TODO 501).',
  })
  testEmailInbox() {
    return this.svc.testEmailInboxConnection();
  }
}
