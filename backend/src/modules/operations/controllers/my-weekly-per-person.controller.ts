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
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  WeeklyPersonItemsQuerySchema,
  type MyWeeklyPerPersonDto,
  type WeeklyPersonItemsDto,
  type WeeklyPersonItemsQuery,
} from '../dto/weekly-per-person.dto';
import { CommitmentsService } from '../services/commitments.service';
import { WeeklyPerPersonService } from '../services/weekly-per-person.service';

const SELF_LIMIT = 1000;

const MyWeeklyPerPersonQuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_start'),
});
type MyWeeklyPerPersonQuery = z.infer<typeof MyWeeklyPerPersonQuerySchema>;

@ApiTags('me-weekly-per-person')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyWeeklyPerPersonController {
  constructor(
    @Inject(WeeklyPerPersonService)
    private readonly svc: WeeklyPerPersonService,
    @Inject(CommitmentsService)
    private readonly commitments: CommitmentsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Get('weekly-per-person')
  @ApiOperation({
    summary: 'Мой недельный план-факт (self-scope: моя строка)',
  })
  async get(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(MyWeeklyPerPersonQuerySchema))
    q: MyWeeklyPerPersonQuery,
  ): Promise<MyWeeklyPerPersonDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);

    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.per_person_self_view.enabled',
      'OPERATIONS_PER_PERSON_SELF_VIEW_ENABLED',
      true,
    );
    if (!enabled) {
      return this.empty(q.weekStart);
    }

    const selfPersonId = await this.resolveSelfPersonId(tenantId!, uid);
    if (!selfPersonId) {
      return this.empty(q.weekStart);
    }

    const dto = await this.svc.compute(
      {
        tenantId: tenantId!,
        weekStart: q.weekStart,
        limit: SELF_LIMIT,
        offset: 0,
        sort: 'risk',
      },
      new Date(),
    );

    const row = dto.rows.find((r) => r.personId === selfPersonId) ?? null;

    this.metrics.incWeeklyPerPersonSelfViewServed({
      tenantTop: tenantTopOf(tenantId!),
    });

    return {
      weekStart: dto.weekStart,
      weekEnd: dto.weekEnd,
      row,
    };
  }

  @Get('weekly-per-person/:personId/items')
  @ApiOperation({
    summary: 'Мой построчный план-факт за неделю (self drill-down)',
  })
  async getMyItems(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Param('personId') personId: string,
    @Query(new ZodValidationPipe(WeeklyPersonItemsQuerySchema))
    q: WeeklyPersonItemsQuery,
  ): Promise<WeeklyPersonItemsDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);

    const selfPersonId = await this.resolveSelfPersonId(tenantId!, uid);
    if (!selfPersonId || selfPersonId !== personId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_person',
          message: 'Можно смотреть только свой план-факт',
        },
      });
    }

    return this.svc.getPersonWeekItems(
      { tenantId: tenantId!, personId: selfPersonId, weekStart: q.weekStart },
      new Date(),
    );
  }

  private empty(weekStart: string): MyWeeklyPerPersonDto {
    const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000);
    const y = weekEndDate.getUTCFullYear();
    const m = String(weekEndDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(weekEndDate.getUTCDate()).padStart(2, '0');
    return {
      weekStart,
      weekEnd: `${y}-${m}-${d}`,
      row: null,
    };
  }

  private async resolveSelfPersonId(tenantId: string, userId: string): Promise<string | null> {
    try {
      const person = await this.commitments.resolveSelfPerson({
        tenantId,
        userId,
      });
      return person.id;
    } catch (err) {
      if (err instanceof ForbiddenException && this.isNoPersonError(err)) {
        return null;
      }
      throw err;
    }
  }

  private isNoPersonError(err: ForbiddenException): boolean {
    const response = err.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      (response as { error?: { code?: string } }).error?.code === 'no_person'
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
}
