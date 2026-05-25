import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import { AdminStorageService } from './admin-storage.service';
import {
  SwitchProviderSchema,
  type SwitchProviderDto,
} from './dto/admin-storage.dto';

/**
 * Admin-redesign Фаза 7 — `AdminStorageController`.
 *
 * UI Z-Admin `/admin/media/storage` — снимок S3-стораджа + переключение
 * провайдера (маркер, реальный endpoint в ENV).
 *
 * Все эндпоинты под `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor`.
 */
@ApiTags('admin-media-storage')
@Controller('api/v1/admin/media/storage')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminStorageController {
  constructor(
    @Inject(AdminStorageService)
    private readonly svc: AdminStorageService,
  ) {}

  @Get('buckets')
  @ApiOperation({
    summary:
      'Список настроенных бакетов S3 с per-bucket статистикой (ListObjectsV2, MaxKeys=1000).',
  })
  async buckets() {
    return this.svc.listBuckets();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Сводная статистика по всем бакетам (totalObjects + totalBytes).',
  })
  async stats() {
    return this.svc.getStats();
  }

  @Post('switch-provider')
  @ApiOperation({
    summary:
      'Переключить S3-провайдера. severity=destructive — reason обязателен (≥10 символов). ' +
      'Маркер: реальный endpoint меняется через ENV S3_ENDPOINT_URL + рестарт.',
  })
  async switchProvider(
    @Body(new ZodValidationPipe(SwitchProviderSchema))
    dto: SwitchProviderDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return this.svc.switchProvider({
      provider: dto.provider,
      reason: dto.reason,
      userId: user.id,
    });
  }
}
