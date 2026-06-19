import { Controller, Get, Inject, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { AdminIntegrationsService } from './admin-integrations.service';
import { SyncRunsQuerySchema, type SyncRunsQueryDto } from './dto/admin-integrations.dto';

@ApiTags('admin-integrations')
@Controller('api/v1/admin/integrations/sources')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminIntegrationsController {
  constructor(
    @Inject(AdminIntegrationsService)
    private readonly svc: AdminIntegrationsService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Состояние источников Bitrix/ChatBox по всем org: статус, последний синк, ошибки, прогоны за 24ч.',
  })
  overview() {
    return this.svc.getSourcesOverview();
  }

  @Get('runs')
  @ApiOperation({
    summary:
      'История прогонов источников (IntegrationSyncRun) с фильтрами provider/tenantId/kind/status, cursor-пагинация.',
  })
  runs(@Query(new ZodValidationPipe(SyncRunsQuerySchema)) q: SyncRunsQueryDto) {
    return this.svc.listSyncRuns(q);
  }
}
