import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import {
  ListEntitlementsQuerySchema,
  type ListEntitlementsQueryDto,
  UpdateEntitlementSchema,
  type UpdateEntitlementDto,
} from './dto/entitlements.dto';
import { AdminEntitlementsService } from './entitlements.service';

@ApiTags('admin-entitlements')
@Controller('api/v1/admin/orgs')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminEntitlementsController {
  constructor(
    @Inject(AdminEntitlementsService)
    private readonly svc: AdminEntitlementsService,
  ) {}

  @Get('entitlements')
  @ApiOperation({
    summary:
      'Список OrgEntitlement: tier + counts override-ключей. По умолчанию ?hasOverrides=true (только Org с переопределениями).',
  })
  list(
    @Query(new ZodValidationPipe(ListEntitlementsQuerySchema))
    q: ListEntitlementsQueryDto,
  ) {
    return this.svc.listOverview({
      hasOverrides: q.hasOverrides,
      ...(q.plan ? { plan: q.plan } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      limit: q.limit,
    });
  }

  @Patch(':id/entitlements')
  @ApiOperation({
    summary: 'Обновить OrgEntitlement для конкретной Org. Если записи нет — создаст (upsert).',
  })
  upsert(
    @Param('id') orgId: string,
    @Body(new ZodValidationPipe(UpdateEntitlementSchema)) dto: UpdateEntitlementDto,
  ) {
    return this.svc.upsertForOrg(orgId, dto);
  }

  @Delete(':id/entitlements/feature/:featureKey')
  @ApiOperation({
    summary: 'Снять override конкретной фичи (удаляет ключ из featureOverrides).',
  })
  removeFeature(@Param('id') orgId: string, @Param('featureKey') featureKey: string) {
    return this.svc.removeFeatureKey(orgId, featureKey);
  }

  @Delete(':id/entitlements/quota/:quotaKey')
  @ApiOperation({
    summary: 'Снять override конкретной quota (удаляет ключ из quotaOverrides).',
  })
  removeQuota(@Param('id') orgId: string, @Param('quotaKey') quotaKey: string) {
    return this.svc.removeQuotaKey(orgId, quotaKey);
  }

  @Post(':id/entitlements/resolve')
  @ApiOperation({
    summary:
      'Effective entitlements для Org: plan.features ∪ featureOverrides (override побеждает) + аналогично для quotas. Для отладки и UI-превью.',
  })
  resolve(@Param('id') orgId: string) {
    return this.svc.resolveForOrg(orgId);
  }
}
