import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { CronManagerService } from './cron-manager.service';
import {
  UpdateCronScheduleSchema,
  type UpdateCronScheduleDto,
} from './dto/admin-crons.dto';

/**
 * Admin-redesign Фаза 0 — `CronManagerController`.
 *
 * Просмотр, переопределение расписания и ручной запуск cron-джобов из
 * админки Z. Источник истины — модель `CronSchedule` + `CronRunHistory`.
 */
@ApiTags('admin-crons')
@Controller('api/v1/admin/crons')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class CronManagerController {
  constructor(
    @Inject(CronManagerService) private readonly svc: CronManagerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список cron-джобов с расписанием и последним запуском.' })
  list() {
    return this.svc.list();
  }

  @Patch(':name')
  @ApiOperation({ summary: 'Изменить расписание/состояние cron-джоба.' })
  async update(
    @Param('name') name: string,
    @Body(new ZodValidationPipe(UpdateCronScheduleSchema))
    dto: UpdateCronScheduleDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    await this.svc.updateSchedule(
      name,
      {
        ...(dto.expression !== undefined ? { expression: dto.expression } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
      user.id,
      dto.reason ?? null,
    );
    return { ok: true };
  }

  @Post(':name/run')
  @ApiOperation({ summary: 'Запустить cron-джоб вручную (manual trigger).' })
  async trigger(
    @Param('name') name: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return this.svc.triggerNow(name, user.id);
  }
}
