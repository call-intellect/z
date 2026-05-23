import {
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { OrgAdminGuard } from '../../auth/guards/org-admin.guard';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';

import {
  UnitEconomicsOrgQuerySchema,
  type UnitEconomicsOrgQuery,
} from './dto/admin-budget.dto';
import { UnitEconomicsService } from './unit-economics.service';

/**
 * SBA α-10 wave 3 — /api/v1/org/economics.
 * Для admin'ов текущей Org (owner/admin). Не требует super_admin.
 *
 * Не выдаёт топ Org'ов глобально — только своя Org.
 */
@ApiExcludeController()
@Controller('api/v1/org/economics')
@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)
export class OrgEconomicsController {
  constructor(
    @Inject(UnitEconomicsService) private readonly svc: UnitEconomicsService,
  ) {}

  @Get('current')
  current(
    @CurrentOrg() tenantId: string,
    @Query(new ZodValidationPipe(UnitEconomicsOrgQuerySchema))
    q: UnitEconomicsOrgQuery,
  ) {
    return this.svc.getOrg(tenantId, q.days);
  }
}
