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

import {
  CreateSystemMessageSchema,
  type CreateSystemMessageDto,
  ListSystemMessagesQuerySchema,
  type ListSystemMessagesQueryDto,
  UpdateSystemMessageSchema,
  type UpdateSystemMessageDto,
} from './dto/system-messages-admin.dto';
import { SystemMessagesAdminService } from './system-messages-admin.service';

/**
 * Admin-redesign Фаза 5 — `SystemMessagesAdminController`.
 *
 * CRUD баннеров / maintenance / alerts. `/active` возвращает только сейчас
 * активные (для будущего public endpoint в Фазе 9 — здесь под admin).
 */
@ApiTags('admin-content-system-messages')
@Controller('api/v1/admin/content/system-messages')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class SystemMessagesAdminController {
  constructor(
    @Inject(SystemMessagesAdminService)
    private readonly svc: SystemMessagesAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Список SystemMessage, отсортирован по createdAt DESC.',
  })
  list(
    @Query(new ZodValidationPipe(ListSystemMessagesQuerySchema))
    q: ListSystemMessagesQueryDto,
  ) {
    return this.svc.list({
      ...(q.type ? { type: q.type } : {}),
      ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
    });
  }

  @Get('active')
  @ApiOperation({
    summary:
      'Сейчас активные сообщения (isActive=true И startsAt<=now И (endsAt IS NULL OR endsAt>now)).',
  })
  active() {
    return this.svc.getActive();
  }

  @Post()
  @ApiOperation({ summary: 'Создать SystemMessage.' })
  create(
    @Body(new ZodValidationPipe(CreateSystemMessageSchema)) dto: CreateSystemMessageDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    this.assertUser(user);
    return this.svc.create(
      {
        type: dto.type,
        severity: dto.severity,
        body: dto.body,
        ...(dto.startsAt !== undefined ? { startsAt: dto.startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: dto.endsAt } : {}),
        ...(dto.targetOrgs !== undefined ? { targetOrgs: dto.targetOrgs } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      user.id,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial-обновление SystemMessage.' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSystemMessageSchema)) dto: UpdateSystemMessageDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Hard-delete SystemMessage (без soft-flag — записи короткоживущие).',
  })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
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
