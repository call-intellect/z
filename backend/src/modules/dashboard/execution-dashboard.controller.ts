import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  DashboardLayoutQuerySchema,
  DigestTrendQuerySchema,
  GoalVectorByPersonQuerySchema,
  IssueChainsQuerySchema,
  type DashboardLayoutQuery,
  type DashboardLayoutResponseDto,
  type DigestTrendQuery,
  type DigestTrendResponseDto,
  type GoalVectorByPersonQuery,
  type GoalVectorByPersonResponseDto,
  type IssueChainsQuery,
  type IssueChainsResponseDto,
  type LoadByPersonResponseDto,
  type StuckIssuesResponseDto,
} from './dto/execution-dashboard.dto';
import { ExecutionDashboardService } from './services/execution-dashboard.service';

@ApiTags('dashboard-execution')
@Controller('api/v1/dashboard')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ExecutionDashboardController {
  constructor(
    @Inject(ExecutionDashboardService)
    private readonly svc: ExecutionDashboardService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('layout')
  @ApiOperation({
    summary: 'Модульный дашборд — раскладка ролевого пресета (override из AdminSetting или null)',
  })
  async layout(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(DashboardLayoutQuerySchema))
    q: DashboardLayoutQuery,
  ): Promise<DashboardLayoutResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getLayout({ role: q.role, rhythm: q.rhythm });
  }

  @Get('goal-vector/by-person')
  @ApiOperation({
    summary: 'Модульный дашборд — вектор к цели в разрезе по людям (вклад + задачи)',
  })
  async goalVectorByPerson(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(GoalVectorByPersonQuerySchema))
    q: GoalVectorByPersonQuery,
  ): Promise<GoalVectorByPersonResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getGoalVectorByPerson({
      tenantId: tenantId!,
      goalId: q.goalId,
      period: q.period,
      now: new Date(),
    });
  }

  @Get('issue-chains')
  @ApiOperation({
    summary: 'Модульный дашборд — цепочки «задача держит задачу» (blocks/blocked_by)',
  })
  async issueChains(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(IssueChainsQuerySchema))
    q: IssueChainsQuery,
  ): Promise<IssueChainsResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getIssueChains({ tenantId: tenantId!, limit: q.limit });
  }

  @Get('load/by-person')
  @ApiOperation({
    summary: 'Модульный дашборд — загрузка по людям (число активных задач, перегруз/норма/недогруз)',
  })
  async loadByPerson(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<LoadByPersonResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getLoadByPerson({ tenantId: tenantId! });
  }

  @Get('stuck/cross-project')
  @ApiOperation({
    summary: 'Модульный дашборд — зависшие задачи без движения по всем проектам (вне спринта)',
  })
  async stuckCrossProject(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<StuckIssuesResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getStuckCrossProject({ tenantId: tenantId!, now: new Date() });
  }

  @Get('operations/trend')
  @ApiOperation({
    summary: 'Модульный дашборд — тренд период-к-периоду (день/неделя) из digest-снимков',
  })
  async operationsTrend(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(DigestTrendQuerySchema))
    q: DigestTrendQuery,
  ): Promise<DigestTrendResponseDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getOperationsTrend({
      tenantId: tenantId!,
      period: q.period,
      now: new Date(),
    });
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
    const allowed = await this.rbac.canViewDirectorDashboard(userId, tenantId);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_role',
          message: 'Нет доступа к дашборду',
        },
      });
    }
  }
}
