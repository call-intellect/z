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

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  OpenCommitmentsQuerySchema,
  type OpenCommitmentsQuery,
  type OpenCommitmentsListDto,
} from '../dto/commitments.dto';
import type {
  OperationsDashboardBlockersListDto,
  OperationsDashboardCapacityListDto,
  OperationsDashboardOverviewDto,
  OperationsDashboardTeamFrictionsListDto,
  OperationsMissingCheckInsDto,
  OperationsStaleIssuesDto,
  OperationsTeamTemperatureDto,
} from '../dto/operations-dashboard.dto';
import {
  TeamTemperatureQuerySchema,
  type TeamTemperatureQuery,
} from '../dto/weekly-digest.dto';
import { CommitmentsService } from '../services/commitments.service';
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
    @Inject(CommitmentsService)
    private readonly commitments: CommitmentsService,
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
  @ApiOperation({
    summary:
      'COO capacity — Person × Appointment.loadPercent. `projectId?` принимается ' +
      'для совместимости с UI «Загруженность проекта» (parity Wave 2, 2026-05-27), ' +
      'но сейчас игнорируется: модель Appointment не привязана к Project. ' +
      'Per-project «загруженность по задачам трекера» — отдельный endpoint ' +
      '/projects/:projectId/workload в tracker-модуле.',
  })
  async capacity(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    // Tracker Project Overview Wave 2 (2026-05-27) — параметр принят для
    // совместимости с фронтом-партнёром; внутри `getCapacity` пока не
    // используется (см. ApiOperation выше).
    @Query('projectId') _projectId?: string,
  ): Promise<OperationsDashboardCapacityListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getCapacity({ tenantId: tenantId! });
  }

  /**
   * SBA β-8.1 — Температура команды за окно (default 7 дней).
   * Доступ — coo/owner/admin (как остальные эндпоинты дашборда).
   */
  @Get('team-temperature')
  @ApiOperation({
    summary: 'COO operations dashboard — температура команды (зелёный/жёлтый/красный)',
  })
  async teamTemperature(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(TeamTemperatureQuerySchema))
    q: TeamTemperatureQuery,
  ): Promise<OperationsTeamTemperatureDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.svc.getTeamTemperature({ tenantId: tenantId!, days: q.days });
  }

  /**
   * Pulse Wave 2.3 — Кто из сотрудников ещё не отчитался за сегодня (или
   * за указанный `?date=YYYY-MM-DD`). Используется виджетом «Не отчитались
   * сегодня» на дашборде операций.
   */
  @Get('missing-checkins')
  @ApiOperation({
    summary:
      'COO operations dashboard — сотрудники без чек-ина за указанный день (default сегодня МСК)',
  })
  async missingCheckIns(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query('date') date?: string,
  ): Promise<OperationsMissingCheckInsDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    const target =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : this.todayMsk();
    return this.svc.getMissingCheckIns({ tenantId: tenantId!, date: target });
  }

  /**
   * Pulse Wave 2.3 — «Зависшие» задачи трекера (без активности > 5 дней
   * или с просроченным `dueDate` без `completedAt`). Используется виджетом
   * «Зависли задачи» на дашборде операций.
   */
  @Get('stale-issues')
  @ApiOperation({
    summary:
      'COO operations dashboard — зависшие/просроченные задачи трекера (default staleDays=5, limit=20)',
  })
  async staleIssues(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query('staleDays') staleDays?: string,
    @Query('limit') limit?: string,
  ): Promise<OperationsStaleIssuesDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    const parsedStale = staleDays ? Number.parseInt(staleDays, 10) : undefined;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    return this.svc.getStaleIssues({
      tenantId: tenantId!,
      staleDays:
        parsedStale !== undefined && Number.isFinite(parsedStale)
          ? parsedStale
          : undefined,
      limit:
        parsedLimit !== undefined && Number.isFinite(parsedLimit)
          ? parsedLimit
          : undefined,
    });
  }

  /**
   * SBA β-8.2 — Открытые обещания за окно (default 14 дней).
   * Доступ — coo/owner/admin (как остальные эндпоинты дашборда).
   */
  @Get('open-commitments')
  @ApiOperation({
    summary: 'COO operations dashboard — открытые обещания (с именами)',
  })
  async openCommitments(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(OpenCommitmentsQuerySchema))
    q: OpenCommitmentsQuery,
  ): Promise<OpenCommitmentsListDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireAccess(uid, tenantId!);
    return this.commitments.listOpenForTenant({
      tenantId: tenantId!,
      days: q.days,
      limit: q.limit,
    });
  }

  /**
   * Pulse Wave 2.3 — текущая дата в МСК (UTC+3) в формате YYYY-MM-DD.
   * Используется как default для `?date=` в `missing-checkins`. Не зависит
   * от системной таймзоны контейнера (в проде backend может стоять и в
   * UTC, и в Europe/Moscow).
   */
  private todayMsk(): string {
    const now = new Date();
    const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return msk.toISOString().slice(0, 10);
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
