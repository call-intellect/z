import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import type {
  OperationsDashboardBlockersListDto,
  OperationsDashboardCapacityListDto,
  OperationsDashboardOverviewDto,
  OperationsDashboardTeamFrictionsListDto,
} from '../dto/operations-dashboard.dto';
import { OperationsDashboardService } from '../services/operations-dashboard.service';

/**
 * SBA β-8 — `GET /api/v1/dashboard/operations/*`.
 *
 * Доступ — owner/admin/coo/super_admin (см.
 * `RbacService.canViewOperationsDashboard`). Manager → 403 forbidden_role.
 */
@ApiTags('dashboard-operations')
@Controller('api/v1/dashboard/operations')
@UseGuards(CookieAuthGuard, TenantGuard)
export class OperationsDashboardController {
  constructor(
    @Inject(OperationsDashboardService)
    private readonly svc: OperationsDashboardService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'COO operations dashboard — pulse-метрики' })
  async overview(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<OperationsDashboardOverviewDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getOverview({ tenantId: tenantId! });
  }

  @Get('blockers')
  async blockers(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<OperationsDashboardBlockersListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getBlockers({ tenantId: tenantId! });
  }

  @Get('team-frictions')
  async teamFrictions(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<OperationsDashboardTeamFrictionsListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getTeamFrictions({ tenantId: tenantId! });
  }

  @Get('capacity')
  async capacity(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<OperationsDashboardCapacityListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getCapacity({ tenantId: tenantId! });
  }

  private requireUser(req: Request): string {
    const uid = req.user?.id;
    if (!uid) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_user', message: 'Требуется авторизация' },
      });
    }
    return uid;
  }

  private requireTenant(tenantId: string | undefined): void {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Не передан tenantId' },
      });
    }
  }

  private async requireAccess(userId: string, tenantId: string): Promise<void> {
    const allowed = await this.rbac.canViewOperationsDashboard(userId, tenantId);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_role',
          message: 'Нет доступа к COO operations dashboard',
        },
      });
    }
  }
}
