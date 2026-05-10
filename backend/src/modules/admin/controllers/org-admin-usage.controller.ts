import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { OrgAdminGuard } from '../../auth/guards/org-admin.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  CallsLogQuerySchema,
  type CallsLogQuery,
  DashboardQuerySchema,
  type DashboardQuery,
  ExportCsvQuerySchema,
  type ExportCsvQuery,
  FunctionsUsageQuerySchema,
  type FunctionsUsageQuery,
  UsersUsageQuerySchema,
  type UsersUsageQuery,
} from '../dto/admin-usage.dto';
import { AdminUsageService } from '../services/admin-usage.service';

import { streamUsageCsv } from './admin-usage.csv';

/**
 * Org-Admin (owner/admin) usage endpoints.
 *
 * Все методы — `scope: 'org'`, `tenantId = req.tenantId` (из @CurrentOrg() ).
 * Без `SuperAdminAuditInterceptor` — это не super_admin. Внутренний
 * `AuditLog` пишется в downstream (если потребуется — отдельным interceptor'ом
 * на mutations, не на этих read-эндпоинтах).
 */
@ApiExcludeController()
@Controller('api/v1/org-admin/usage')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
export class OrgAdminUsageController {
  constructor(
    @Inject(AdminUsageService) private readonly svc: AdminUsageService,
  ) {}

  @Get('dashboard')
  async dashboard(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(DashboardQuerySchema)) q: DashboardQuery,
  ) {
    return this.svc.getDashboard({
      scope: 'org',
      tenantId,
      period: q.period,
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
  }

  @Get('users')
  async users(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(UsersUsageQuerySchema)) q: UsersUsageQuery,
  ) {
    return this.svc.getUsersUsage({
      scope: 'org',
      tenantId,
      period: q.period,
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.search ? { search: q.search } : {}),
    });
  }

  @Get('calls')
  async calls(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(CallsLogQuerySchema)) q: CallsLogQuery,
  ) {
    return this.svc.getCallsLog({
      scope: 'org',
      tenantId,
      ...(q.taskType ? { taskType: q.taskType } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.experimentGroup ? { experimentGroup: q.experimentGroup } : {}),
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
    });
  }

  @Get('calls/:id')
  async callDetails(
    @CurrentOrg() tenantId: string,
    @Param('id') id: string,
  ) {
    const detail = await this.svc.getCallDetails({
      scope: 'org',
      tenantId,
      callId: id,
    });
    if (!detail) {
      throw new NotFoundException({ ok: false, error: { code: 'call_not_found' } });
    }
    return detail;
  }

  @Get('functions')
  async functions(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(FunctionsUsageQuerySchema)) q: FunctionsUsageQuery,
  ) {
    return this.svc.getFunctionsUsage({
      scope: 'org',
      tenantId,
      period: q.period,
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
  }

  @Get('export/usage.csv')
  async exportCsv(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(ExportCsvQuerySchema)) q: ExportCsvQuery,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const filename = `usage-org-${q.period}-${Date.now()}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (q.kind === 'calls') {
      const result = await this.svc.getCallsLog({
        scope: 'org',
        tenantId,
        limit: 1000,
      });
      streamUsageCsv(res, result.items);
    } else if (q.kind === 'functions') {
      const result = await this.svc.getFunctionsUsage({
        scope: 'org',
        tenantId,
        period: q.period,
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
      });
      streamUsageCsv(res, result.items);
    } else {
      const result = await this.svc.getUsersUsage({
        scope: 'org',
        tenantId,
        period: q.period,
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        limit: 1000,
      });
      streamUsageCsv(res, result.items);
    }
    res.end();
  }
}
