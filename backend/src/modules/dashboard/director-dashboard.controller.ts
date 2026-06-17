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
import {
  PeopleAtRiskQuerySchema,
  type PeopleAtRiskQuery,
  type PeopleAtRiskResponse,
} from './dto/people-at-risk.dto';
import {
  PulsePatternsQuerySchema,
  type PulsePatternsDto,
  type PulsePatternsQuery,
} from './dto/pulse-patterns.dto';
import { DirectorDashboardService } from './services/director-dashboard.service';
import { PeopleAtRiskService } from './services/people-at-risk.service';
import { PulsePatternsService } from './services/pulse-patterns.service';
import { TeamDetailService, type TeamDetailDto } from './services/team-detail.service';
import { TeamHealthService, type TeamHealthDto } from './services/team-health.service';

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
    @Inject(PulsePatternsService)
    private readonly pulsePatternsSvc: PulsePatternsService,
    @Inject(PeopleAtRiskService)
    private readonly peopleAtRiskSvc: PeopleAtRiskService,
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
    return this.svc.getDirectorView({ tenantId, period: q.period, userId });
  }

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

  @Get('pulse-patterns')
  async pulsePatterns(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(PulsePatternsQuerySchema))
    q: PulsePatternsQuery,
  ): Promise<PulsePatternsDto> {
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
    return this.pulsePatternsSvc.getPulsePatterns({
      tenantId,
      period: q.period,
    });
  }

  @Get('people-at-risk')
  async peopleAtRisk(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(PeopleAtRiskQuerySchema)) q: PeopleAtRiskQuery,
  ): Promise<PeopleAtRiskResponse> {
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
    return this.peopleAtRiskSvc.getAtRisk({
      tenantId,
      limit: q.limit,
      viewerUserId: userId,
    });
  }
}
