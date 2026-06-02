import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';

import {
  AggregatesQuerySchema,
  type AggregatesQueryDto,
  SystemLogQuerySchema,
  type SystemLogQueryDto,
  UpdateLoggingSettingsSchema,
  type UpdateLoggingSettingsDto,
} from './dto/system-logs.dto';
import { LogCleanupService } from './log-cleanup.service';
import { LogSettingsService } from './log-settings.service';
import { LogService, type LogQueryFilters } from './log.service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * LoggingModule — REST для админки (только SUPER_ADMIN).
 *
 * `:id` объявлен ПОСЛЕ `aggregates`/`settings`, иначе перехватит их.
 * PATCH settings и cleanup сами пишут security-лог факта изменения.
 */
@ApiTags('platform-logs')
@Controller('api/v1/platform/logs')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
export class SystemLogsController {
  constructor(
    private readonly logs: LogService,
    private readonly settings: LogSettingsService,
    private readonly cleanup: LogCleanupService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список технических логов: фильтры + пагинация.' })
  async list(
    @Query(new ZodValidationPipe(SystemLogQuerySchema)) q: SystemLogQueryDto,
  ) {
    const filters: LogQueryFilters = {
      limit: q.limit,
      offset: q.offset,
      ...(q.level ? { level: q.level } : {}),
      ...(q.levelAtLeast ? { levelAtLeast: q.levelAtLeast } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.contour ? { contour: q.contour } : {}),
      ...(q.module ? { module: q.module } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.orgId ? { orgId: q.orgId } : {}),
      ...(q.requestId ? { requestId: q.requestId } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.path ? { path: q.path } : {}),
      ...(typeof q.statusCode === 'number' ? { statusCode: q.statusCode } : {}),
      ...(q.dateFrom ? { dateFrom: q.dateFrom } : {}),
      ...(q.dateTo ? { dateTo: q.dateTo } : {}),
      ...(q.search ? { search: q.search } : {}),
    };
    return this.logs.list(filters);
  }

  @Get('aggregates')
  @ApiOperation({ summary: 'Агрегаты логов за период (по умолчанию 7 дней).' })
  async aggregates(
    @Query(new ZodValidationPipe(AggregatesQuerySchema)) q: AggregatesQueryDto,
  ) {
    const to = q.dateTo ?? new Date();
    const from = q.dateFrom ?? new Date(to.getTime() - WEEK_MS);
    return this.logs.aggregates(from, to);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Текущие runtime-настройки логирования.' })
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Изменить настройки логирования (применяются без рестарта).' })
  async updateSettings(
    @Body(new ZodValidationPipe(UpdateLoggingSettingsSchema)) patch: UpdateLoggingSettingsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const next = await this.settings.applyUpdate(patch, user.id);
    this.logs.security('logging_settings.update', 'Настройки логирования изменены', {
      module: 'logging',
      userId: user.id,
      details: { patch },
    });
    return next;
  }

  @Post('cleanup')
  @ApiOperation({ summary: 'Ручной запуск ретеншена (удаление логов старше retentionDays).' })
  async runCleanup(@CurrentUser() user: CurrentUserPayload) {
    const result = await this.cleanup.runCleanup();
    this.logs.security('logging.cleanup', 'Ручной ретеншен логов', {
      module: 'logging',
      userId: user.id,
      details: { result },
    });
    return result;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Одна запись лога подробно.' })
  async getOne(@Param('id') id: string) {
    return this.logs.getById(id);
  }
}
