import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  CreateGlobalChannelSchema,
  type CreateGlobalChannelDto,
  UpdateGlobalChannelSchema,
  type UpdateGlobalChannelDto,
} from './dto/global-channels-admin.dto';
import { GlobalChannelsAdminService } from './global-channels-admin.service';

/**
 * Admin-redesign Фаза 5 — `GlobalChannelsAdminController`.
 *
 * CRUD глобальных каналов (`Channel` с tenantId IS NULL). Секреты
 * шифруются через `CryptoService` и никогда не возвращаются в ответе.
 */
@ApiTags('admin-content-global-channels')
@Controller('api/v1/admin/content/global-channels')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class GlobalChannelsAdminController {
  constructor(
    @Inject(GlobalChannelsAdminService)
    private readonly svc: GlobalChannelsAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список глобальных каналов с количеством подписчиков (ChannelBinding). Секреты не возвращаются.',
  })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Создать глобальный канал.' })
  create(
    @Body(new ZodValidationPipe(CreateGlobalChannelSchema)) dto: CreateGlobalChannelDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.create(
      {
        kind: dto.kind,
        direction: dto.direction,
        ...(dto.config !== undefined ? { config: dto.config } : {}),
        ...(dto.secrets !== undefined ? { secrets: dto.secrets } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.maxDataClass !== undefined ? { maxDataClass: dto.maxDataClass } : {}),
      },
      user.id,
    );
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Partial-update глобального канала. Секреты шифруются через CryptoService.',
  })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateGlobalChannelSchema)) dto: UpdateGlobalChannelDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.update(id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Soft-delete: status=global_disabled. Записи не удаляем — ChannelBinding остаются валидными.',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.softDelete(id, user.id);
  }

  private assertUser(
    user: CurrentUserPayload | null | undefined,
  ): asserts user is CurrentUserPayload {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
  }
}
