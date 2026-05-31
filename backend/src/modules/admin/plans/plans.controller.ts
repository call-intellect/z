import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { PlanSnapshotDto } from './dto/plan-snapshot.dto';
import { AdminPlansService } from './plans.service';

/**
 * Admin-redesign Фаза 4 (collapse-to-standard, ТЗ 2026-05-31) —
 * `AdminPlansController`.
 *
 * После collapse-to-standard остался **один** read-only эндпоинт
 * `GET /api/v1/admin/orgs/plans/current` — снимок единого тарифа
 * `tier_standard` для UI карточки на `/admin/orgs/plans`.
 *
 * CRUD-эндпоинты (`POST` / `PATCH` / `DELETE` / `GET /` / `GET /:id/usage`)
 * удалены: тарифы больше не редактируются как сущность БД (модель `Plan`
 * остаётся LEGACY до отдельного ТЗ удаления), а цена выехала в `AdminSetting`
 * (ключи `billing.*`) и редактируется через `/admin/settings/...`.
 *
 * Под `CookieAuthGuard + SuperAdminGuard` и `SuperAdminAuditInterceptor`.
 * Префикс `/admin/orgs/plans` сохраняется (исторически Plan → OrgEntitlement.tier).
 */
@ApiTags('admin-plans')
@Controller('api/v1/admin/orgs/plans')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminPlansController {
  constructor(
    @Inject(AdminPlansService) private readonly svc: AdminPlansService,
  ) {}

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
