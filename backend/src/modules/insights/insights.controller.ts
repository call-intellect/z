import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
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
import { RbacService } from '../rbac/rbac.service';

import {
  ChangeInsightStatusBodySchema,
  type ChangeInsightStatusBody,
  ChangeSeverityBodySchema,
  type ChangeSeverityBody,
  ChartInsightsQuerySchema,
  type ChartInsightsQuery,
  type InsightDetailDto,
  type InsightsChartResponse,
  type InsightSeverityDto,
  type InsightStatusDto,
  ListInsightsQuerySchema,
  type ListInsightsQuery,
  type ListInsightsResponse,
  SetMitigationBodySchema,
  type SetMitigationBody,
  TopInsightsQuerySchema,
  type TopInsightsQuery,
  type TopInsightsResponse,
} from './dto/insights.dto';
import { InsightsService } from './services/insights.service';

/**
 * REST API радара сигналов (SBA β-4).
 *
 *   GET  /api/v1/insights                  — список (фильтры / пагинация).
 *   GET  /api/v1/insights/chart?days=30    — данные для stacked-bar виджета.
 *   GET  /api/v1/insights/top?limit=5      — топ-N для Director Dashboard.
 *   GET  /api/v1/insights/:id              — детали Insight.
 *   POST /api/v1/insights/:id/status       — изменить статус (+ CardVersion).
 *   POST /api/v1/insights/:id/mitigation   — обновить план реагирования.
 *   POST /api/v1/insights/:id/severity     — изменить остроту.
 *
 * RBAC:
 *   - `insight` ResourceType.
 *   - Read: все member'ы Org (insight — shared knowledge).
 *   - Write: owner/admin (+ manager open для mitigation).
 *
 * Multi-tenancy: TenantGuard.
 * Все user-facing строки на русском.
 */
@ApiTags('insights')
@Controller('api/v1/insights')
@UseGuards(CookieAuthGuard, TenantGuard)
export class InsightsController {
  constructor(
    @Inject(InsightsService) private readonly svc: InsightsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Список сигналов Org (с фильтрами и пагинацией)',
  })
  async list(
    @Query(new ZodValidationPipe(ListInsightsQuerySchema))
    q: ListInsightsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListInsightsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({ tenantId: t, query: q });
  }

  @Get('chart')
  @ApiOperation({
    summary:
      'Данные графика динамики сигналов (stacked bar по kind за rolling N дней)',
  })
  async chart(
    @Query(new ZodValidationPipe(ChartInsightsQuerySchema))
    q: ChartInsightsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<InsightsChartResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getChart({ tenantId: t, query: q });
  }

  @Get('top')
  @ApiOperation({
    summary: 'Топ-N повторяющихся проблем (для виджета Director Dashboard)',
  })
  async top(
    @Query(new ZodValidationPipe(TopInsightsQuerySchema))
    q: TopInsightsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TopInsightsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getTop({ tenantId: t, query: q });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить сигнал по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<InsightDetailDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getById({ tenantId: t, id });
  }

  @Post(':id/status')
  @ApiOperation({
    summary: 'Изменить статус сигнала (owner / admin / curator)',
  })
  async changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChangeInsightStatusBodySchema))
    body: ChangeInsightStatusBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; status: InsightStatusDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.updateStatus({
      tenantId: t,
      id,
      body,
      reviewerUserId: user.id,
    });
  }

  @Post(':id/mitigation')
  @ApiOperation({
    summary: 'Записать / обновить план реагирования (owner / admin)',
  })
  async setMitigation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetMitigationBodySchema))
    body: SetMitigationBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.updateMitigation({
      tenantId: t,
      id,
      body,
      reviewerUserId: user.id,
    });
  }

  @Post(':id/severity')
  @ApiOperation({
    summary: 'Изменить остроту сигнала (owner / admin)',
  })
  async changeSeverity(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChangeSeverityBodySchema))
    body: ChangeSeverityBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; severity: InsightSeverityDto }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.updateSeverity({
      tenantId: t,
      id,
      body,
      reviewerUserId: user.id,
    });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'insight');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения сигналов',
        },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'insight');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только owner / admin могут изменять сигналы.',
        },
      });
    }
  }
}
