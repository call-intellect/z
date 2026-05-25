import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import { MaintenanceAdminService } from './maintenance-admin.service';

/**
 * Admin-redesign Фаза 8 — `MaintenanceAdminController`.
 *
 * UI `/admin/platform/maintenance` — статус бэкапов и активные maintenance
 * windows. Manual бэкап/реиндекс — заглушки (501).
 */
@ApiTags('admin-platform-maintenance')
@Controller('api/v1/admin/platform/maintenance')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class MaintenanceAdminController {
  constructor(
    @Inject(MaintenanceAdminService)
    private readonly svc: MaintenanceAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Статус: дата последнего бэкапа (если есть) + активные maintenance windows (SystemMessage type=maintenance).',
  })
  status() {
    return this.svc.getStatus();
  }

  @Post('backup-now')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Manual бэкап (заглушка 501 — выполняется через pg_dump на инфра).',
  })
  backupNow() {
    return this.svc.backupNow();
  }

  @Post('reindex-now')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Manual реиндекс (заглушка 501 — будет в Фазе 9 через воркеры).',
  })
  reindexNow() {
    return this.svc.reindexNow();
  }
}
