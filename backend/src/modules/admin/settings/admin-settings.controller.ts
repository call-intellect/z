import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import {
  getSchemaForKey,
  hasSchemaForKey,
  zodToSimpleSchema,
} from './admin-setting-schema-registry';
import { AdminSettingsService } from './admin-settings.service';
import {
  HistoryQuerySchema,
  type HistoryQueryDto,
  ListSettingsQuerySchema,
  type ListSettingsQueryDto,
  SetSettingSchema,
  type SetSettingDto,
} from './dto/admin-settings.dto';

@ApiTags('admin-settings')
@Controller('api/v1/admin/settings')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminSettingsController {
  constructor(@Inject(AdminSettingsService) private readonly svc: AdminSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Список admin-настроек с фильтрами по category/section.' })
  async list(
    @Query(new ZodValidationPipe(ListSettingsQuerySchema))
    q: ListSettingsQueryDto,
  ) {
    return this.svc.list({
      ...(q.category ? { category: q.category } : {}),
      ...(q.section ? { section: q.section } : {}),
    });
  }

  @Get('schema/:key')
  @ApiOperation({
    summary:
      'JSON-схема ожидаемого значения admin-настройки + текущее/дефолтное значение. ' +
      'Используется фронтом для генерации `AdminSettingField` (Фаза 3).',
  })
  async schema(@Param('key') key: string) {
    const zodSchema = getSchemaForKey(key);
    const jsonSchema = zodToSimpleSchema(zodSchema);

    let currentValue: unknown = null;
    let severity: string | null = null;
    let description: string | null = null;
    let updatedAt: Date | null = null;
    try {
      const detail = await this.svc.getDetail(key);
      currentValue = detail.value;
      severity = detail.severity;
      description = detail.description;
      updatedAt = detail.updatedAt;
    } catch {}

    return {
      key,
      hasTypedSchema: hasSchemaForKey(key),
      jsonSchema,
      currentValue,
      defaultValue: null,
      severity,
      description,
      updatedAt,
    };
  }

  @Get(':key')
  @ApiOperation({ summary: 'Карточка одной admin-настройки.' })
  async detail(@Param('key') key: string) {
    return this.svc.getDetail(key);
  }

  @Post(':key')
  @ApiOperation({ summary: 'Обновить значение admin-настройки.' })
  async set(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(SetSettingSchema)) dto: SetSettingDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    await this.svc.set(key, dto.value, {
      userId: user.id,
      reason: dto.reason ?? null,
      ...(dto.expectedUpdatedAt ? { expectedUpdatedAt: dto.expectedUpdatedAt } : {}),
    });
    return { ok: true };
  }

  @Get(':key/history')
  @ApiOperation({ summary: 'История изменений admin-настройки (последние N записей).' })
  async history(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(HistoryQuerySchema)) q: HistoryQueryDto,
  ) {
    return this.svc.getHistory(key, q.limit);
  }
}
