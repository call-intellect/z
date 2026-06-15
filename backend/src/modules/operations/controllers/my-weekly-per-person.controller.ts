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

/**
 * ТЗ-2 Ф4 (daily-value-dashboards) — `GET /api/v1/me/weekly-per-person`.
 *
 * Self-view недельного план-факта: ЛЮБОЙ авторизованный пользователь с
 * Person-записью видит ТОЛЬКО свою строку + среднюю надёжность команды
 * (для стрелки «я vs команда»). RBAC operations-dashboard НЕ требуется —
 * это персональные данные самого пользователя.
 *
 * Auth: CookieAuthGuard + TenantGuard. Graceful 200:
 *   - флаг `operations.per_person_self_view.enabled` OFF → пустой self DTO;
 *   - нет Person-записи → пустой self DTO.
 *
 * Self-person резолвится сервером из cookie-сессии (как `/me/daily-brief`),
 * query НЕ задаёт чужой personId. БЕЗ финансовых данных.
 */

const SELF_LIMIT = 1000;

/** Минимальная query-схема self-view: только понедельник недели. */
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
    summary: 'Мой недельный план-факт (self-scope: моя строка + среднее команды)',
  })
  async get(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(MyWeeklyPerPersonQuerySchema))
    q: MyWeeklyPerPersonQuery,
  ): Promise<MyWeeklyPerPersonDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);

    // Флаг (kill-switch, дефолт ON). OFF → пустой self DTO (graceful).
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

    // Считаем полный недельный агрегат и достаём из него свою строку + среднее
    // команды. limit большой, offset 0 — нужны ВСЕ строки для среднего и поиска
    // своей. sort не важен для self-view.
    const dto = await this.svc.compute(
      {
        tenantId: tenantId!,
        weekStart: q.weekStart,
        limit: SELF_LIMIT,
        offset: 0,
        sort: 'reliability',
      },
      new Date(),
    );

    const row = dto.rows.find((r) => r.personId === selfPersonId) ?? null;
    const teamAverageReliabilityPercent = this.averageReliability(dto.rows);

    this.metrics.incWeeklyPerPersonSelfViewServed({
      tenantTop: tenantTopOf(tenantId!),
    });

    return {
      weekStart: dto.weekStart,
      weekEnd: dto.weekEnd,
      row,
      teamAverageReliabilityPercent,
    };
  }

  /**
   * ТЗ редизайн Ф8.5 — self drill-down: построчный план-факт по СВОЕМУ
   * профилю за неделю. `:personId` обязан совпадать с собственным Person
   * (иначе 403 forbidden_person) — RBAC operations-dashboard не требуется.
   */
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

  // ── helpers ──

  /** Среднее non-null reliabilityPercent по строкам (округление до целого). */
  private averageReliability(
    rows: ReadonlyArray<{ reliabilityPercent: number | null }>,
  ): number | null {
    const values = rows
      .map((r) => r.reliabilityPercent)
      .filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return Math.round(sum / values.length);
  }

  private empty(weekStart: string): MyWeeklyPerPersonDto {
    // weekEnd = воскресенье той же недели (понедельник + 6 дней).
    const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
    const weekEndDate = new Date(
      weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000,
    );
    const y = weekEndDate.getUTCFullYear();
    const m = String(weekEndDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(weekEndDate.getUTCDate()).padStart(2, '0');
    return {
      weekStart,
      weekEnd: `${y}-${m}-${d}`,
      row: null,
      teamAverageReliabilityPercent: null,
    };
  }

  /** Резолв self-person (graceful: null если Person нет — не 403). */
  private async resolveSelfPersonId(
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
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
