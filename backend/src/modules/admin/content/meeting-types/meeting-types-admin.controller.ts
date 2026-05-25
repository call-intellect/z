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
  CreateMeetingTypeSchema,
  type CreateMeetingTypeDto,
  UpdateMeetingTypeSchema,
  type UpdateMeetingTypeDto,
} from './dto/meeting-types-admin.dto';
import { MeetingTypesAdminService } from './meeting-types-admin.service';

/**
 * Admin-redesign Фаза 5 — `MeetingTypesAdminController`.
 *
 * CRUD конфигов типов встреч под `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor`. Все мутации логируются в SuperAdminAccessLog.
 */
@ApiTags('admin-content-meeting-types')
@Controller('api/v1/admin/content/meeting-types')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class MeetingTypesAdminController {
  constructor(
    @Inject(MeetingTypesAdminService)
    private readonly svc: MeetingTypesAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список MeetingTypeConfig, отсортирован по sortOrder. При пустой БД — bootstrap из enum MeetingType.',
  })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Создать новую конфигурацию типа встречи.' })
  create(
    @Body(new ZodValidationPipe(CreateMeetingTypeSchema)) dto: CreateMeetingTypeDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.create(dto, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial-обновление MeetingTypeConfig.' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMeetingTypeSchema)) dto: UpdateMeetingTypeDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.update(id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete MeetingTypeConfig (isActive=false).' })
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
