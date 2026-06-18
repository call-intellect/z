import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { PlanSnapshotDto } from './dto/plan-snapshot.dto';
import { AdminPlansService } from './plans.service';

@ApiTags('admin-plans')
@Controller('api/v1/admin/orgs/plans')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminPlansController {
  constructor(@Inject(AdminPlansService) private readonly svc: AdminPlansService) {}

  @Get('current')
  @ApiOperation({
    summary:
      'Снимок единого тарифа tier_standard: цена/мест/встреч из AdminSetting, features/quotas из TIER_CONFIG, COUNT Org на стандарте и на legacy-тирах.',
  })
  @ApiResponse({ status: 200, type: PlanSnapshotDto })
  getCurrent(): Promise<PlanSnapshotDto> {
    return this.svc.getCurrentSnapshot();
  }
}
