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

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import {
  UpdateSecuritySettingSchema,
  type UpdateSecuritySettingDto,
} from './dto/security-admin.dto';
import { SecurityAdminService } from './security-admin.service';

@ApiTags('admin-platform-security')
@Controller('api/v1/admin/platform/security')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class SecurityAdminController {
  constructor(
    @Inject(SecurityAdminService)
    private readonly svc: SecurityAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Текущие security-настройки: Argon2 параметры, TTL сессий, TTL deep-link.',
  })
  list() {
    return this.svc.list();
  }

  @Patch(':key')
  @ApiOperation({
    summary: 'Обновить security-настройку (severity=high). reason обязателен, ≥10 символов.',
  })
  async update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateSecuritySettingSchema))
    dto: UpdateSecuritySettingDto,
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
      reason: dto.reason,
    });
    return { ok: true };
  }

  @Post('rotate-ip-salt')
  @ApiOperation({
    summary: 'Manual ротация IP_HASH_DAILY_SALT. Пока 501 — ротация выполняется ежедневным cron.',
  })
  rotateIpSalt() {
    return this.svc.rotateIpSalt();
  }
}
