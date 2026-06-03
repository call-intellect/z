import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import {
  ConfirmPendingActionBodySchema,
  type ConfirmPendingActionBody,
  ListPendingActionsQuerySchema,
  type ListPendingActionsQuery,
  SnoozePendingActionBodySchema,
  type SnoozePendingActionBody,
} from './dto/pending-actions.dto';
import {
  PendingActionsService,
  type PendingActionsCountResult,
  type PendingActionsListResult,
} from './services/pending-actions.service';

/**
 * REST `/api/v1/pending-actions/*` — единый feed «требует действия»
 * (Action Center B0, 2026-06-02).
 *
 *   GET  /api/v1/pending-actions/count   — бейдж (total + bySource)
 *   GET  /api/v1/pending-actions         — список (urgent-first, limit)
 *   POST /api/v1/pending-actions/snooze  — отложить item на N часов
 *
 * Доступно любому члену Org: выдача ограничена pending'ом пользователя —
 * роль резолвится в сервисе через Membership (owner/admin видят всё по своим
 * источникам, остальные — только адресованное им). Org берётся из `X-Org-Id`.
 */
@ApiTags('pending-actions')
@Controller('api/v1/pending-actions')
@UseGuards(CookieAuthGuard, TenantGuard)
export class PendingActionsController {
  constructor(
    @Inject(PendingActionsService)
    private readonly svc: PendingActionsService,
  ) {}

  @Get('count')
  @ApiOperation({
    summary: 'Счётчик «требует действия» (бейдж): total + разбивка bySource',
  })
  async getCount(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PendingActionsCountResult> {
    const t = this.requireTenant(tenantId);
    return this.svc.getCount({ tenantId: t, userId: user.id });
  }

  @Get()
  @ApiOperation({
    summary: 'Список «требует действия» (urgent-first, затем по возрасту)',
  })
  async getList(
    @Query(new ZodValidationPipe(ListPendingActionsQuerySchema))
    query: ListPendingActionsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PendingActionsListResult> {
    const t = this.requireTenant(tenantId);
    return this.svc.getList({ tenantId: t, userId: user.id, limit: query.limit });
  }

  @Post('snooze')
  @ApiOperation({ summary: 'Отложить item из feed\'а на N часов (1..720)' })
  async snooze(
    @Body(new ZodValidationPipe(SnoozePendingActionBodySchema))
    body: SnoozePendingActionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; snoozedUntil: string }> {
    const t = this.requireTenant(tenantId);
    return this.svc.snooze({
      tenantId: t,
      userId: user.id,
      source: body.source,
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      hours: body.hours,
    });
  }

  @Post('confirm')
  @ApiOperation({
    summary:
      'Быстрое подтверждение item\'а (B4): one-tap approve для light-curation',
  })
  async confirm(
    @Body(new ZodValidationPipe(ConfirmPendingActionBodySchema))
    body: ConfirmPendingActionBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.svc.confirm({
      tenantId: t,
      userId: user.id,
      source: body.source,
      resourceId: body.resourceId,
    });
    return { ok: true };
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
