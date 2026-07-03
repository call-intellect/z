import { Controller, Get, Inject, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import {
  LlmCostCompaniesQuerySchema,
  type LlmCostCompaniesQuery,
  LlmCostCompanyDetailQuerySchema,
  type LlmCostCompanyDetailQuery,
  LlmCostModelQuerySchema,
  type LlmCostModelQuery,
  LlmCostModuleQuerySchema,
  type LlmCostModuleQuery,
  LlmCostOverviewQuerySchema,
  type LlmCostOverviewQuery,
  LlmCostTaskTypeQuerySchema,
  type LlmCostTaskTypeQuery,
} from '../dto/llm-cost-dashboard.dto';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { LlmCostDashboardService } from './llm-cost-dashboard.service';
import type { LlmCostModule } from './llm-cost-module-map';

@ApiExcludeController()
@Controller('api/v1/admin/llm-cost')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class LlmCostDashboardController {
  constructor(@Inject(LlmCostDashboardService) private readonly svc: LlmCostDashboardService) {}

  @Get('overview')
  overview(@Query(new ZodValidationPipe(LlmCostOverviewQuerySchema)) q: LlmCostOverviewQuery) {
    return this.svc.overview(q);
  }

  @Get('models/:model')
  modelDetail(
    @Param('model') model: string,
    @Query(new ZodValidationPipe(LlmCostModelQuerySchema)) q: LlmCostModelQuery,
  ) {
    return this.svc.modelDetail(decodeURIComponent(model), q);
  }

  @Get('modules/:module')
  moduleDetail(
    @Param('module') module: LlmCostModule,
    @Query(new ZodValidationPipe(LlmCostModuleQuerySchema)) q: LlmCostModuleQuery,
  ) {
    return this.svc.moduleDetail(module, q);
  }

  @Get('companies')
  companies(@Query(new ZodValidationPipe(LlmCostCompaniesQuerySchema)) q: LlmCostCompaniesQuery) {
    return this.svc.companies(q);
  }

  @Get('companies/:tenantId')
  companyDetail(
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(LlmCostCompanyDetailQuerySchema)) q: LlmCostCompanyDetailQuery,
  ) {
    return this.svc.companyDetail(tenantId, q);
  }

  @Get('task-types/:taskType')
  taskTypeDetail(
    @Param('taskType') taskType: string,
    @Query(new ZodValidationPipe(LlmCostTaskTypeQuerySchema)) q: LlmCostTaskTypeQuery,
  ) {
    return this.svc.taskTypeDetail(taskType, q);
  }
}
