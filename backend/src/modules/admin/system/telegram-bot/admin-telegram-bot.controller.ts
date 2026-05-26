import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import {
  ListBindingsQuerySchema,
  type ListBindingsQueryDto,
  ResetWebhookSchema,
  type ResetWebhookDto,
  UpdateStatusSchema,
  type UpdateStatusDto,
  UpdateTemplatesSchema,
  type UpdateTemplatesDto,
  UpdateTokenSchema,
  type UpdateTokenDto,
} from './admin-telegram-bot.dto';
import { AdminTelegramBotService } from './admin-telegram-bot.service';

/**
 * Главная админка Z — управление глобальным Telegram-ботом (β-9 Phase 4).
 *
 * Контракты:
 *   GET  /api/v1/admin/system/telegram-bot
 *   PUT  /api/v1/admin/system/telegram-bot/token
 *   PUT  /api/v1/admin/system/telegram-bot/webhook
 *   PUT  /api/v1/admin/system/telegram-bot/templates
 *   PUT  /api/v1/admin/system/telegram-bot/status
 *   GET  /api/v1/admin/system/telegram-bot/bindings
 *
 * Доступ — только super-admin (RBAC ResourceType `system_telegram_bot`).
 * `SuperAdminAuditInterceptor` пишет каждое действие в `SuperAdminAccessLog`
 * (включая GET — это compliance-требование для drill-down доступа).
 */
@ApiExcludeController()
@Controller('api/v1/admin/system/telegram-bot')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminTelegramBotController {
  constructor(
    @Inject(AdminTelegramBotService)
    private readonly svc: AdminTelegramBotService,
  ) {}

  @Get()
  async getSettings() {
    return this.svc.getSettings();
  }

  @Put('token')
  async updateToken(
    @Body(new ZodValidationPipe(UpdateTokenSchema)) dto: UpdateTokenDto,
  ) {
    return this.svc.updateToken({ token: dto.token });
  }

  @Put('webhook')
  async resetWebhook(
    @Body(new ZodValidationPipe(ResetWebhookSchema)) dto: ResetWebhookDto,
  ) {
    return this.svc.resetWebhook(
      dto.webhookUrl ? { webhookUrl: dto.webhookUrl } : undefined,
    );
  }

  @Put('templates')
  async updateTemplates(
    @Body(new ZodValidationPipe(UpdateTemplatesSchema))
    dto: UpdateTemplatesDto,
  ) {
    return this.svc.updateTemplates(dto);
  }

  @Put('status')
  async setStatus(
    @Body(new ZodValidationPipe(UpdateStatusSchema)) dto: UpdateStatusDto,
  ) {
    return this.svc.setStatus({ status: dto.status });
  }

  @Get('bindings')
  async listBindings(
    @Query(new ZodValidationPipe(ListBindingsQuerySchema))
    query: ListBindingsQueryDto,
  ) {
    return this.svc.listBindings(query);
  }

  /**
   * Синхронный пинг прокси telegram.crossmark.ru («Проверить прокси
   * сейчас»). ТЗ 2026-05-26 §7 + §10. Не пишет в БД, не меняет
   * Channel.config — только диагностика.
   */
  @Post('ping')
  async pingProxy() {
    return this.svc.pingProxy();
  }
}
