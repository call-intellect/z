import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  type CreatePushSubscriptionBody,
  CreatePushSubscriptionBodySchema,
  type DeletePushSubscriptionBody,
  DeletePushSubscriptionBodySchema,
  type PushSubscriptionListResponse,
} from '../dto/push-subscription.dto';
import { PushSubscriptionsService } from '../services/push-subscriptions.service';

@ApiTags('me-push-subscriptions')
@Controller('api/v1/me/push-subscriptions')
@UseGuards(CookieAuthGuard, TenantGuard)
export class PushSubscriptionsController {
  constructor(
    @Inject(PushSubscriptionsService)
    private readonly svc: PushSubscriptionsService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Сохранить push-подписку браузера (upsert по endpoint)',
  })
  async subscribe(
    @Body(new ZodValidationPipe(CreatePushSubscriptionBodySchema))
    body: CreatePushSubscriptionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; id: string }> {
    const t = this.requireTenant(tenantId);
    const expiresAt =
      body.expirationTime && body.expirationTime > 0 ? new Date(body.expirationTime) : null;
    const sub = await this.svc.subscribe({
      tenantId: t,
      userId: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      ...(body.userAgent ? { userAgent: body.userAgent } : {}),
      expiresAt,
    });
    return { ok: true, id: sub.id };
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить push-подписку по endpoint' })
  async unsubscribe(
    @Body(new ZodValidationPipe(DeletePushSubscriptionBodySchema))
    body: DeletePushSubscriptionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    this.requireTenant(tenantId);
    await this.svc.unsubscribe({ userId: user.id, endpoint: body.endpoint });
  }

  @Get()
  @ApiOperation({ summary: 'Список моих push-подписок (без секретов)' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PushSubscriptionListResponse> {
    this.requireTenant(tenantId);
    const list = await this.svc.listMine({ userId: user.id });
    return { items: list.map((s) => this.svc.toView(s)) };
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
}
