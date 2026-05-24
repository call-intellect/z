import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
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
import { RbacService } from '../../rbac/rbac.service';
import {
  type FeedSubscriptionDto,
  type FeedTypeDto,
  FeedTypeSchema,
  PatchSubscriptionBodySchema,
  type PatchSubscriptionBody,
  UpsertSubscriptionBodySchema,
  type UpsertSubscriptionBody,
} from '../dto/activity-feed.dto';
import { ActivityFeedService } from '../services/activity-feed.service';

/**
 * Feed Subscriptions REST API (Wave 2 Поток D, 2026-05-24).
 *
 *   GET    /api/v1/feed-subscriptions
 *   POST   /api/v1/feed-subscriptions
 *   PATCH  /api/v1/feed-subscriptions/:feedType
 *   DELETE /api/v1/feed-subscriptions/:feedType
 *
 * Подписка скоупируется по пользователю (`userId`), не по tenant'у:
 * unique-ключ `(userId, feedType)`. Это сознательное решение sub-ТЗ —
 * один пользователь имеет одну подписку на тип ленты, даже если состоит
 * в нескольких Org. Tenant в read'ах вычисляется отдельно через X-Org-Id.
 *
 * RBAC: `activity_feed_item` read — чтобы получить любую подписку требуется
 * быть members tenant'а (защита от шпионажа). Write — себе.
 */
@ApiTags('activity-feed-subscriptions')
@Controller('api/v1/feed-subscriptions')
@UseGuards(CookieAuthGuard, TenantGuard)
export class FeedSubscriptionsController {
  constructor(
    @Inject(ActivityFeedService) private readonly svc: ActivityFeedService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список подписок текущего пользователя' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: FeedSubscriptionDto[] }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const items = await this.svc.listSubscriptions({ userId: user.id });
    return { items };
  }

  @Post()
  @ApiOperation({ summary: 'Создать или заменить подписку (upsert по feedType)' })
  async upsert(
    @Body(new ZodValidationPipe(UpsertSubscriptionBodySchema))
    body: UpsertSubscriptionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; subscription: FeedSubscriptionDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const subscription = await this.svc.upsertSubscription({
      userId: user.id,
      body,
    });
    return { ok: true, subscription };
  }

  @Patch(':feedType')
  @ApiOperation({ summary: 'Частичное обновление подписки' })
  async patch(
    @Param('feedType') feedTypeRaw: string,
    @Body(new ZodValidationPipe(PatchSubscriptionBodySchema))
    body: PatchSubscriptionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; subscription: FeedSubscriptionDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const feedType = this.parseFeedType(feedTypeRaw);
    const subscription = await this.svc.patchSubscription({
      userId: user.id,
      feedType,
      body,
    });
    return { ok: true, subscription };
  }

  @Delete(':feedType')
  @ApiOperation({ summary: 'Отписаться от типа ленты' })
  async remove(
    @Param('feedType') feedTypeRaw: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    const feedType = this.parseFeedType(feedTypeRaw);
    return this.svc.deleteSubscription({ userId: user.id, feedType });
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

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'activity_feed_item');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для управления подписками',
        },
      });
    }
  }

  private parseFeedType(raw: string): FeedTypeDto {
    const parsed = FeedTypeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_feed_type',
          message: `Неизвестный тип ленты: ${raw}`,
        },
      });
    }
    return parsed.data;
  }
}
