import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import {
  CallsLogQuerySchema,
  type CallsLogQuery,
  DashboardQuerySchema,
  type DashboardQuery,
  ExportCsvQuerySchema,
  type ExportCsvQuery,
  FunctionCallsQuerySchema,
  type FunctionCallsQuery,
  FunctionsUsageQuerySchema,
  type FunctionsUsageQuery,
  UsersUsageQuerySchema,
  type UsersUsageQuery,
} from '../dto/admin-usage.dto';
import {
  type AdminCallLogItem,
  AdminUsageService,
} from '../services/admin-usage.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { streamUsageCsv } from './admin-usage.csv';

/**
 * Z-Admin (super_admin) usage endpoints.
 *
 * Все методы — `scope: 'global'`. Параметр `tenantId` не передаётся клиентом —
 * super_admin видит данные по всем Org. Для drill-down в конкретную Org
 * используется фильтр по userId/meetingId/sourceRef.
 *
 * `SuperAdminAuditInterceptor` пишет SuperAdminAccessLog для каждого вызова
 * (в т.ч. GET — это требование compliance).
 */
@ApiExcludeController()
@Controller('api/v1/admin/usage')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminUsageController {
  constructor(
    @Inject(AdminUsageService) private readonly svc: AdminUsageService,
  ) {}

  @Get('dashboard')
  async dashboard(
    @Query(new ZodValidationPipe(DashboardQuerySchema)) q: DashboardQuery,
  ) {
    return this.svc.getDashboard({
      scope: 'global',
      period: q.period,
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
  }

  @Get('users')
  async users(
    @Query(new ZodValidationPipe(UsersUsageQuerySchema)) q: UsersUsageQuery,
  ) {
    return this.svc.getUsersUsage({
      scope: 'global',
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
    @Query(new ZodValidationPipe(CallsLogQuerySchema)) q: CallsLogQuery,
  ) {
    return this.svc.getCallsLog({
      scope: 'global',
      ...(q.taskType ? { taskType: q.taskType } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.experimentGroup ? { experimentGroup: q.experimentGroup } : {}),
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
    });
  }

  @Get('calls/:id')
  async callDetails(@Param('id') id: string) {
    const detail = await this.svc.getCallDetails({
      scope: 'global',
      callId: id,
    });
    if (!detail) throw new NotFoundException({ ok: false, error: { code: 'call_not_found' } });
    return detail;
  }

  @Get('functions')
  async functions(
    @Query(new ZodValidationPipe(FunctionsUsageQuerySchema)) q: FunctionsUsageQuery,
  ) {
    return this.svc.getFunctionsUsage({
      scope: 'global',
      period: q.period,
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
  }

  @Get('functions/:taskType/calls')
  async functionCalls(
    @Param('taskType') taskType: string,
    @Query(new ZodValidationPipe(FunctionCallsQuerySchema)) q: FunctionCallsQuery,
  ) {
    return this.svc.getFunctionCalls({
      scope: 'global',
      taskType,
      limit: q.limit,
    });
  }

  @Get('export/usage.csv')
  async exportCsv(
    @Query(new ZodValidationPipe(ExportCsvQuerySchema)) q: ExportCsvQuery,
    @Res() res: Response,
  ) {
    await this.streamCsv(q, res, 'global', undefined);
  }

  private async streamCsv(
    q: ExportCsvQuery,
    res: Response,
    scope: 'global' | 'org',
    tenantId: string | undefined,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const filename = `usage-${scope}-${q.period}-${Date.now()}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (q.kind === 'calls') {
      const result = await this.svc.getCallsLog({
        scope,
        ...(tenantId !== undefined ? { tenantId } : {}),
        limit: 1000,
      });
      streamUsageCsv(res, result.items as AdminCallLogItem[]);
    } else if (q.kind === 'functions') {
      const result = await this.svc.getFunctionsUsage({
        scope,
        ...(tenantId !== undefined ? { tenantId } : {}),
        period: q.period,
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
      });
      streamUsageCsv(res, result.items);
    } else {
      const result = await this.svc.getUsersUsage({
        scope,
        ...(tenantId !== undefined ? { tenantId } : {}),
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
