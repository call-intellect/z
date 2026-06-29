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
  GetDailyDigestQuerySchema,
  type GetDailyDigestQuery,
  type DailyOperationsDigestDto,
} from '../dto/daily-digest.dto';
import { DailyDigestService } from '../services/daily-digest.service';

@ApiTags('dashboard-operations-daily')
@Controller('api/v1/dashboard/operations/daily-digest')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DailyDigestController {
  constructor(
    @Inject(DailyDigestService)
    private readonly svc: DailyDigestService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Получить ежедневный дайджест операционного директора' })
  async get(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(GetDailyDigestQuerySchema))
    q: GetDailyDigestQuery,
  ): Promise<DailyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    const dto = await this.svc.getStored({
      tenantId: tenantId!,
      dateLocal: q.date,
    });
    if (!dto) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'digest_not_found',
          message: 'Ежедневный отчёт за указанную дату ещё не сгенерирован',
        },
      });
    }
    return dto;
  }

  @Get('latest')
  @ApiOperation({ summary: 'Последний сохранённый ежедневный дайджест' })
  async getLatest(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<DailyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    const dto = await this.svc.getLatest({ tenantId: tenantId! });
    if (!dto) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'digest_not_found',
          message: 'Ежедневный отчёт ещё не сгенерирован ни за один день',
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
    summary: 'Принудительно пересобрать ежедневный дайджест (owner/admin/super_admin)',
  })
  async generate(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(GetDailyDigestQuerySchema))
    q: GetDailyDigestQuery,
  ): Promise<DailyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireWriteAccess(uid, tenantId!);
    return this.svc.generate({
      tenantId: tenantId!,
      dateLocal: q.date,
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
          message: 'Нет доступа к ежедневному отчёту',
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
    if (ctx.role === 'owner') return;
    if (ctx.role === 'admin') return;
    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'forbidden_role',
        message: 'Только владелец / администратор может пересобрать ежедневный отчёт',
      },
    });
  }
}
