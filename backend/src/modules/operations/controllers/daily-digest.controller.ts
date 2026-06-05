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

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  GetDailyDigestQuerySchema,
  type GetDailyDigestQuery,
  type DailyOperationsDigestDto,
} from '../dto/daily-digest.dto';
import { DailyDigestService } from '../services/daily-digest.service';

/**
 * SBA β-8.3 — `/api/v1/dashboard/operations/daily-digest`.
 *
 * Источник: plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md §1.5.
 *
 *   GET /?date=YYYY-MM-DD       — отдать сохранённый дайджест или 404.
 *     Доступ: coo / owner / admin / super_admin
 *     (через `RbacService.canViewOperationsDashboard`).
 *
 *   GET /latest                 — последний сохранённый дайджест (по dateLocal DESC).
 *     Удобно для блока «Вчерашний отчёт» на главной /dashboard/operations.
 *     Доступ: те же роли.
 *
 *   POST /generate?date=YYYY-MM-DD — принудительная (пере)генерация.
 *     Доступ: owner / admin / super_admin (через role-check в `loadContext`).
 */
@ApiTags('dashboard-operations-daily')
@Controller('api/v1/dashboard/operations/daily-digest')
@UseGuards(CookieAuthGuard, TenantGuard)
export class DailyDigestController {
  constructor(
    @Inject(DailyDigestService)
    private readonly svc: DailyDigestService,
    @Inject(RbacService) private readonly rbac: RbacService,
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

  @Post('generate')
  @ApiOperation({
    summary:
      'Принудительно пересобрать ежедневный дайджест (owner/admin/super_admin)',
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

  private async requireWriteAccess(
    userId: string,
    tenantId: string,
  ): Promise<void> {
    // Принудительная регенерация — owner / admin / super_admin.
    // ТЗ-C Ф4 (2026-06-05, R8): выравнивание прав с фронтом
    // (DailyDigestClient.tsx:79 — isSuperAdmin || admin || owner). Владелец
    // компании должен иметь возможность пересобрать «вчерашний отчёт» сам.
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
        message:
          'Только владелец / администратор может пересобрать ежедневный отчёт',
      },
    });
  }
}
