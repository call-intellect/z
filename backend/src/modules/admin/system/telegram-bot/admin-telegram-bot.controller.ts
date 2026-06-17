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
  async updateToken(@Body(new ZodValidationPipe(UpdateTokenSchema)) dto: UpdateTokenDto) {
    return this.svc.updateToken({ token: dto.token });
  }

  @Put('webhook')
  async resetWebhook(@Body(new ZodValidationPipe(ResetWebhookSchema)) dto: ResetWebhookDto) {
    return this.svc.resetWebhook(dto.webhookUrl ? { webhookUrl: dto.webhookUrl } : undefined);
  }

  @Put('templates')
  async updateTemplates(
    @Body(new ZodValidationPipe(UpdateTemplatesSchema))
    dto: UpdateTemplatesDto,
  ) {
    return this.svc.updateTemplates(dto);
  }

  @Put('status')
  async setStatus(@Body(new ZodValidationPipe(UpdateStatusSchema)) dto: UpdateStatusDto) {
    return this.svc.setStatus({ status: dto.status });
  }

  @Get('bindings')
  async listBindings(
    @Query(new ZodValidationPipe(ListBindingsQuerySchema))
    query: ListBindingsQueryDto,
  ) {
    return this.svc.listBindings(query);
  }

  @Post('ping')
  async pingProxy() {
    return this.svc.pingProxy();
  }
}
