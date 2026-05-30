import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireEntitlement } from '../entitlements/require-entitlement.decorator';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  DirectorDashboardQuerySchema,
  type DirectorDashboardDto,
  type DirectorDashboardQuery,
} from './dto/director-dashboard.dto';
import { DirectorDashboardService } from './services/director-dashboard.service';
import {
  TeamDetailService,
  type TeamDetailDto,
} from './services/team-detail.service';
import {
  TeamHealthService,
  type TeamHealthDto,
} from './services/team-health.service';

/**
 * GET /api/v1/dashboard/director?period=week|month — главная директорская
 * страница. Доступ: owner / admin Org или super_admin (см.
 * `RbacService.canViewDirectorDashboard`). manager → 403 forbidden_role.
 */
@ApiExcludeController()
@Controller('api/v1/dashboard')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.dashboard_director')
export class DirectorDashboardController {
  constructor(
    @Inject(DirectorDashboardService)
    private readonly svc: DirectorDashboardService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(TeamHealthService)
    private readonly teamHealthSvc: TeamHealthService,
    @Inject(TeamDetailService)
    private readonly teamDetailSvc: TeamDetailService,
  ) {}

  @Get('director')
  async director(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(DirectorDashboardQuerySchema))
    q: DirectorDashboardQuery,
  ): Promise<DirectorDashboardDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    const allowed = await this.rbac.canViewDirectorDashboard(userId, tenantId);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_role',
          message: 'Нет доступа к директорскому дашборду',
        },
      });
    }
    return this.svc.getDirectorView({ tenantId, period: q.period });
  }

  /**
   * Pulse Wave 1 §1.6 — Team Health Grid.
   *
   * Возвращает таблицу здоровья всех отделов tenant'а (4 метрики: sentiment,
   * promises, conflicts, decisions). Отделы с <3 чел. помечены `belowCohort`.
   *
   * Доступ — те же owner/admin/super_admin (`canViewDirectorDashboard`).
   */
  @Get('team-health')
  async teamHealth(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<TeamHealthDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    const allowed = await this.rbac.canViewDirectorDashboard(userId, tenantId);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_role',
          message: 'Нет доступа к директорскому дашборду',
        },
      });
    }
    return this.teamHealthSvc.getHealth({ tenantId });
  }

  /**
   * Pulse Wave 2 §2.5 — детальная страница команды `/teams/[id]`.
   *
   * Возвращает агрегат по одному отделу: шапку, состав с per-person sentiment,
   * health-метрики (sentiment 7d + commitment reliability), цели и топ-темы.
   *
   * Доступ — те же owner/admin/super_admin (`canViewDirectorDashboard`).
   * 404 если отдел не найден в tenant.
   */
  @Get('teams/:id')
  async teamDetail(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<TeamDetailDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    const allowed = await this.rbac.canViewDirectorDashboard(userId, tenantId);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_role',
          message: 'Нет доступа к директорскому дашборду',
        },
      });
    }
    return this.teamDetailSvc.getDetail({ tenantId, departmentId: id });
  }
}
