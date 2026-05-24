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
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
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

/**
 * Push Subscriptions REST API (Wave 2 backend-web-push, 2026-05-24).
 *
 *   POST   /api/v1/me/push-subscriptions   — создать (idempotent через upsert)
 *   DELETE /api/v1/me/push-subscriptions   — удалить по endpoint
 *   GET    /api/v1/me/push-subscriptions   — мои подписки (без секретов)
 *
 * Скоупируется по пользователю (`userId`), tenantId берётся из X-Org-Id
 * заголовка через TenantGuard. RBAC не требуется (это «свои данные» — каждый
 * пользователь управляет только своими push-устройствами; нет cross-user
 * операций). Соответствует паттерну `feed-subscriptions` (Wave 2 Поток D),
 * только без RBAC-проверки на resourceType — там она нужна для шпионажа
 * чужих лент, а здесь у нас только self-операции.
 *
 * Без VAPID на backend'е — controller всё равно работает: подписки складываются
 * в БД, WebPushSender уходит в no-op (warn). Frontend graceful-флоу опирается
 * именно на это.
 */
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
      body.expirationTime && body.expirationTime > 0
        ? new Date(body.expirationTime)
        : null;
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
    // tenantId не используем в where — фронт может удалять подписку из
    // прежней Org. Но запрашиваем для консистентности с TenantGuard.
    this.requireTenant(tenantId);
    await this.svc.unsubscribe({ userId: user.id, endpoint: body.endpoint });
    // 204 — без тела (Nest вернёт пусто).
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

  // ─────────────────────────── helpers ──────────────────────────────

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
