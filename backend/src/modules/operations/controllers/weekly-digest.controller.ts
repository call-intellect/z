import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { TypedConfigService } from '../../../common/config/index';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  AvailablePeriodsQuerySchema,
  type AvailablePeriodsQuery,
  type AvailablePeriodsDto,
} from '../dto/available-periods.dto';
import {
  WeeklyDigestQuerySchema,
  type WeeklyDigestQuery,
  type WeeklyOperationsDigestDto,
} from '../dto/weekly-digest.dto';
import { WeeklyDigestService } from '../services/weekly-digest.service';

@ApiTags('dashboard-operations-weekly')
@Controller('api/v1/dashboard/operations/weekly-digest')
@UseGuards(CookieAuthGuard, TenantGuard)
export class WeeklyDigestController {
  constructor(
    @Inject(WeeklyDigestService)
    private readonly svc: WeeklyDigestService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Получить недельный дайджест операционного директора' })
  async get(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(WeeklyDigestQuerySchema))
    q: WeeklyDigestQuery,
  ): Promise<WeeklyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    const dto = await this.svc.getStored({
      tenantId: tenantId!,
      weekStart: q.weekStart,
    });
    if (!dto) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'digest_not_found',
          message: 'Недельная сводка за указанную неделю ещё не сгенерирована',
        },
      });
    }
    return dto;
  }

  @Get('latest')
  @ApiOperation({ summary: 'Последний недельный дайджест операционного директора' })
  async getLatest(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<WeeklyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    const dto = await this.svc.getLatest({ tenantId: tenantId! });
    if (!dto) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'digest_not_found',
          message: 'Недельная сводка ещё не сгенерирована',
        },
      });
    }
    return dto;
  }

  @Get('available-periods')
  @ApiOperation({ summary: 'Список доступных периодов отчёта (для навигатора/архива)' })
  async availablePeriods(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(AvailablePeriodsQuerySchema)) q: AvailablePeriodsQuery,
  ): Promise<AvailablePeriodsDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    const knob = await this.cfg.getDynamic<number>(
      'operations.report_archive.recent_limit',
      'REPORT_ARCHIVE_RECENT_LIMIT',
      12,
    );
    const limit = Math.min(Math.max(q.limit ?? knob, 1), 50);
    return this.svc.listAvailablePeriods({ tenantId: tenantId!, limit });
  }

  @Post('generate')
  @ApiOperation({
    summary: 'Принудительно пересобрать недельный дайджест (admin/owner; для отладки)',
  })
  async generate(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(WeeklyDigestQuerySchema))
    q: WeeklyDigestQuery,
  ): Promise<WeeklyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireWriteAccess(uid, tenantId!);
    const weekEnd = addDaysToDateLocal(q.weekStart, 4);
    return this.svc.generate({
      tenantId: tenantId!,
      weekStart: q.weekStart,
      weekEnd,
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

  private async requireReadAccess(userId: string, tenantId: string): Promise<void> {
    const allowed = await this.rbac.canViewOperationsDashboard(userId, tenantId);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_role',
          message: 'Нет доступа к недельной сводке',
        },
      });
    }
  }

  private async requireWriteAccess(userId: string, tenantId: string): Promise<void> {
    const ctx = await this.rbac.loadContext(userId, tenantId);
    if (!ctx) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden_role', message: 'Нет доступа' },
      });
    }
    if (ctx.isSuperAdmin) return;
    if (ctx.role === 'owner' || ctx.role === 'admin') return;
    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'forbidden_role',
        message: 'Только admin/owner может принудительно пересобрать дайджест',
      },
    });
  }
}

function addDaysToDateLocal(dateLocal: string, days: number): string {
  const d = new Date(`${dateLocal}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
