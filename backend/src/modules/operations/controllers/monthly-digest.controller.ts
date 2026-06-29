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
  MonthlyDigestQuerySchema,
  type MonthlyDigestQuery,
  type MonthlyOperationsDigestDto,
} from '../dto/monthly-digest.dto';
import { MonthlyDigestService } from '../services/monthly-digest.service';

@ApiTags('dashboard-operations-monthly')
@Controller('api/v1/dashboard/operations/monthly-digest')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MonthlyDigestController {
  constructor(
    @Inject(MonthlyDigestService)
    private readonly svc: MonthlyDigestService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Получить месячную сводку «Месяц компании»' })
  async get(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(MonthlyDigestQuerySchema))
    q: MonthlyDigestQuery,
  ): Promise<MonthlyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    const dto = await this.svc.getStored({ tenantId: tenantId!, periodYm: q.period });
    if (!dto) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'digest_not_found',
          message: 'Месячная сводка за указанный месяц ещё не сгенерирована',
        },
      });
    }
    return dto;
  }

  @Get('latest')
  @ApiOperation({ summary: 'Последняя месячная сводка «Месяц компании»' })
  async getLatest(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
  ): Promise<MonthlyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireReadAccess(uid, tenantId!);
    const dto = await this.svc.getLatest({ tenantId: tenantId! });
    if (!dto) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'digest_not_found',
          message: 'Месячная сводка ещё не сгенерирована',
        },
      });
    }
    return dto;
  }

  @Post('generate')
  @ApiOperation({
    summary: 'Принудительно пересобрать месячную сводку (admin/owner; для отладки)',
  })
  async generate(
    @CurrentOrg() tenantId: string | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(MonthlyDigestQuerySchema))
    q: MonthlyDigestQuery,
  ): Promise<MonthlyOperationsDigestDto> {
    const uid = this.requireUser(req);
    this.requireTenant(tenantId);
    await this.requireWriteAccess(uid, tenantId!);
    return this.svc.generate({ tenantId: tenantId!, periodYm: q.period });
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
          message: 'Нет доступа к месячной сводке',
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
        message: 'Только admin/owner может принудительно пересобрать сводку',
      },
    });
  }
}
