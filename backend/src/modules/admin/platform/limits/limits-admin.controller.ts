import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
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

import { UpdateLimitSchema, type UpdateLimitDto } from './dto/limits-admin.dto';
import { LimitsAdminService } from './limits-admin.service';

@ApiTags('admin-platform-limits')
@Controller('api/v1/admin/platform/limits')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class LimitsAdminController {
  constructor(@Inject(LimitsAdminService) private readonly svc: LimitsAdminService) {}

  @Get()
  @ApiOperation({
    summary:
      'Список всех платформенных лимитов (AdminSetting where category=platform section=limits).',
  })
  list() {
    return this.svc.list();
  }

  @Patch(':key')
  @ApiOperation({
    summary:
      'Обновить значение лимита. Использует AdminSettingsService.set (история + audit + pub/sub).',
  })
  async update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateLimitSchema)) dto: UpdateLimitDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    await this.svc.update({
      key,
      value: dto.value,
      userId: user.id,
      reason: dto.reason ?? null,
    });
    return { ok: true };
  }
}
