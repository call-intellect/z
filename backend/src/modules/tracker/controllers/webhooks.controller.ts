import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreateWebhookSchema,
  type CreateWebhookDto,
} from '../dto/webhooks/create-webhook.dto';
import {
  UpdateWebhookSchema,
  type UpdateWebhookDto,
  WebhookLogsQuerySchema,
  type WebhookLogsQuery,
} from '../dto/webhooks/update-webhook.dto';
import type {
  WebhookLogsResponse,
  WebhookResponseDto,
  WebhookTestEnqueueResult,
} from '../services/webhooks.service';
import { WebhooksService } from '../services/webhooks.service';

/**
 * REST `/api/v1/tracker/webhooks` — исходящие webhook'и трекера.
 * Префикс `tracker/` чтобы не конфликтовать с уже существующим `/api/v1/webhooks`
 * (LiveKit-вебхуки). RBAC ResourceType='issue_webhook' (admin/owner).
 */
@ApiTags('tracker / webhooks')
@ApiBearerAuth()
@Controller('api/v1/tracker')
@UseGuards(CookieAuthGuard, TenantGuard)
export class TrackerWebhooksController {
  constructor(
    @Inject(WebhooksService) private readonly svc: WebhooksService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('webhooks')
  @ApiOperation({ summary: 'Список webhook-ов организации' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WebhookResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findAll(t);
  }

  @Post('webhooks')
  @ApiOperation({ summary: 'Создать webhook (secretKey возвращается один раз)' })
  async create(
    @Body(new ZodValidationPipe(CreateWebhookSchema)) body: CreateWebhookDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WebhookResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(body, t, user.id);
  }

  @Patch('webhooks/:id')
  @ApiOperation({ summary: 'Изменить webhook' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWebhookSchema)) body: UpdateWebhookDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WebhookResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить webhook' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.delete(id, t);
  }

  @Get('webhooks/:id/logs')
  @ApiOperation({ summary: 'Логи доставки webhook-а' })
  async logs(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(WebhookLogsQuerySchema)) query: WebhookLogsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WebhookLogsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getLogs(id, t, query);
  }

  @Post('webhooks/:id/test')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Поставить тестовую доставку в очередь webhook-delivery (HMAC + лог). 202 Accepted',
  })
  async test(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WebhookTestEnqueueResult> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.enqueueTest(id, t);
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'issue_webhook');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Доступ к webhook-ам — admin / owner' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue_webhook');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin / owner могут менять webhook-и',
        },
      });
    }
  }
}
