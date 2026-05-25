import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
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

import { AdminRetentionService } from './admin-retention.service';
import {
  PreviewRetentionQuerySchema,
  type PreviewRetentionQueryDto,
  UpdateRetentionSchema,
  type UpdateRetentionDto,
} from './dto/admin-retention.dto';

/**
 * Admin-redesign Фаза 7 — `AdminRetentionController`.
 *
 * UI Z-Admin `/admin/media/retention` — управление таблицей `RetentionPolicy`.
 * Все retention-настройки — severity='high', reason обязателен (≥10 символов).
 *
 * Все эндпоинты под `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor` (audit фиксирует все правки, включая просмотр
 * preview — это compliance-чувствительные действия).
 */
@ApiTags('admin-media-retention')
@Controller('api/v1/admin/media/retention')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminRetentionController {
  constructor(
    @Inject(AdminRetentionService)
    private readonly svc: AdminRetentionService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список всех retention-политик (sorted by type). При пустой БД — sync с ENV.',
  })
  async list() {
    return this.svc.list();
  }

  @Patch(':type')
  @ApiOperation({
    summary:
      'Обновить retention для типа. severity=high — reason обязателен (≥10 символов). ' +
      'Пишет в RetentionPolicy + дублирует в AdminSetting retention.{type} (pub/sub в воркеры).',
  })
  async update(
    @Param('type') type: string,
    @Body(new ZodValidationPipe(UpdateRetentionSchema))
    dto: UpdateRetentionDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return this.svc.update({
      type,
      days: dto.days,
      reason: dto.reason,
      userId: user.id,
    });
  }

  @Get(':type/preview')
  @ApiOperation({
    summary:
      'Preview сколько записей удалится при применении нового TTL. ' +
      'Параметр ?days=N — proposed; если не задан, равен текущему.',
  })
  async preview(
    @Param('type') type: string,
    @Query(new ZodValidationPipe(PreviewRetentionQuerySchema))
    q: PreviewRetentionQueryDto,
  ) {
    return this.svc.preview({
      type,
      ...(q.days !== undefined ? { days: q.days } : {}),
    });
  }
}
