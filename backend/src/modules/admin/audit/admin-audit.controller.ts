import { Controller, Get, Inject, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { AdminAuditService } from './admin-audit.service';
import {
  AuditStatsQuerySchema,
  type AuditStatsQueryDto,
  ListAuditQuerySchema,
  type ListAuditQueryDto,
} from './dto/admin-audit.dto';

@ApiTags('admin-audit')
@Controller('api/v1/admin/audit')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminAuditController {
  constructor(@Inject(AdminAuditService) private readonly svc: AdminAuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Журнал действий super_admin: фильтры по admin/tenant/route/method/period + cursor pagination.',
  })
  async list(@Query(new ZodValidationPipe(ListAuditQuerySchema)) q: ListAuditQueryDto) {
    return this.svc.list({
      ...(q.adminUserId ? { adminUserId: q.adminUserId } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.route ? { route: q.route } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit: q.limit,
    });
  }

  @Get('admins')
  @ApiOperation({
    summary: "Список super_admin'ов с количеством действий и временем последнего действия.",
  })
  async admins() {
    return this.svc.listAdmins();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Агрегированная статистика журнала за период: топ routes + распределение по методам.',
  })
  async stats(@Query(new ZodValidationPipe(AuditStatsQuerySchema)) q: AuditStatsQueryDto) {
    return this.svc.stats(q.period);
  }
}
