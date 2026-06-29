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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  WeeklyPerPersonQuerySchema,
  WeeklyPersonItemsQuerySchema,
  type WeeklyPerPersonDto,
  type WeeklyPerPersonQuery,
  type WeeklyPersonItemsDto,
  type WeeklyPersonItemsQuery,
} from '../dto/weekly-per-person.dto';
import { WeeklyPerPersonService } from '../services/weekly-per-person.service';

@ApiTags('dashboard-operations-weekly-per-person')
@Controller('api/v1/dashboard/operations/weekly-per-person')
@UseGuards(CookieAuthGuard, TenantGuard)
export class WeeklyPerPersonController {
  constructor(
    @Inject(WeeklyPerPersonService)
    private readonly svc: WeeklyPerPersonService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Недельный план-факт по людям (обещания/задачи/чек-ины)',
  })
  async get(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(WeeklyPerPersonQuerySchema))
    q: WeeklyPerPersonQuery,
  ): Promise<WeeklyPerPersonDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    return this.svc.compute(
      {
        tenantId: tenantId!,
        weekStart: q.weekStart,
        weekEnd: q.weekEnd,
        limit: q.limit,
        offset: q.offset,
        sort: q.sort,
      },
      new Date(),
    );
  }

  @Get(':personId/items')
  @ApiOperation({
    summary: 'Построчный план-факт по человеку за неделю (drill-down)',
  })
  async getItems(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Param('personId') personId: string,
    @Query(new ZodValidationPipe(WeeklyPersonItemsQuerySchema))
    q: WeeklyPersonItemsQuery,
  ): Promise<WeeklyPersonItemsDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    return this.svc.getPersonWeekItems(
      { tenantId: tenantId!, personId, weekStart: q.weekStart, weekEnd: q.weekEnd },
      new Date(),
    );
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
          message: 'Нет доступа к недельному план-факту по людям',
        },
      });
    }
  }
}
