import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { DailyCostAggregatorCron } from './daily-cost-aggregator.cron';
import {
  AggregateUnitEconomicsBodySchema,
  type AggregateUnitEconomicsBody,
  UnitEconomicsOrgQuerySchema,
  type UnitEconomicsOrgQuery,
  UpdateOrgBudgetSchema,
  type UpdateOrgBudgetDto,
} from './dto/admin-budget.dto';
import { OrgEconomicsCron } from './org-economics.cron';
import { UnitEconomicsService } from './unit-economics.service';

@ApiExcludeController()
@Controller('api/v1/admin')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminEconomicsController {
  constructor(
    @Inject(UnitEconomicsService) private readonly svc: UnitEconomicsService,
    @Inject(DailyCostAggregatorCron)
    private readonly aggregator: DailyCostAggregatorCron,
    @Inject(OrgEconomicsCron)
    private readonly orgEconomics: OrgEconomicsCron,
  ) {}

  @Get('unit-economics/orgs/:id')
  org(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(UnitEconomicsOrgQuerySchema))
    q: UnitEconomicsOrgQuery,
  ) {
    return this.svc.getOrg(id, q.days);
  }

  @Post('unit-economics/aggregate')
  aggregate(
    @Body(new ZodValidationPipe(AggregateUnitEconomicsBodySchema))
    body: AggregateUnitEconomicsBody,
  ) {
    const date = body.date ? new Date(body.date) : new Date(Date.now() - 86400_000);
    return this.aggregator.runForDate(date);
  }

  @Post('unit-economics/refresh-org-metrics')
  refreshOrgMetrics() {
    return this.orgEconomics.runForAll();
  }

  @Get('orgs/:id/budget')
  getBudget(@Param('id') id: string) {
    return this.svc.getBudgetCap(id);
  }

  @Patch('orgs/:id/budget')
  setBudget(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOrgBudgetSchema)) dto: UpdateOrgBudgetDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.upsertBudgetCap(id, {
      monthlyCapRub: dto.monthlyCapRub,
      capKind: dto.capKind,
      alertThresholds: dto.alertThresholds,
      ...(user?.id ? { setByUserId: user.id } : {}),
    });
  }
}
